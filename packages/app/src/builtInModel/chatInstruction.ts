import {
  KIND_PRESETS,
  SPEAKER_PRESETS,
  actionBatch,
  chatImportOps,
  chatPlanOptions,
  chatPlanRequest,
  chatPlanSchema,
  chatPlanSummary,
  choiceBatch,
  decisionPrompts,
  draftBlockPlainText,
  draftBlockVisible,
  draftChanges,
  editTextOps,
  groupSkips,
  kindDisplayLabel,
  mergeChatPlans,
  plainScope,
  readChatPlan,
  ruleChatPlan,
  ruleTargets,
  scopeBatch,
  sectionNumbers,
  bareNumbers,
  meansAll,
  speakerDisplayLabel,
  targetBatch,
  type ChatAction,
  type ChatPlan,
  type ChatTurn,
  type ChatView,
  type DecisionBatch,
  type DraftChange,
  type ImportDraft,
  type ImportOp,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import { callTool, type ToolHost } from "../agentTools/toolDirectory";
import { segmentIndex } from "../importDraft/sourceView";
import { chatSpeakerName } from "./chatLabels";
import type { DecisionRuntime } from "./decisionRuntime";

/**
 * One instruction from the Chat pane. Fixed rules in Core read what the
 * wording settles (action, speaker, kind, quoted words, "das" = the previous
 * answer's blocks); the Built-in model fills the rest in one answer held to
 * a JSON schema, with the conversation so far; the changes are built in Core
 * and applied as one Tool call (one undo step). Every answer says what it
 * understood, and why blocks were left as they were.
 */

export type ChatContext = {
  view: ChatView;
  /** Blocks the user put in the chat as context (selection chips). */
  blocks: string[];
};

export type ChatOutcome = (
  | { kind: "answer"; text: string }
  /** Import draft changed: what changed per block, and the draft before/after (for Undo). */
  | {
      kind: "import";
      changes: DraftChange[];
      before: ImportDraft;
      after: ImportDraft;
      /** "Speaker Leser in section 12, printed label removed". */
      understood?: string;
      /** Sections left as they were, with the reason. */
      skipped?: Array<{ n: number; reason: string }>;
    }
  /** Prayers in the Library changed (unsaved). */
  | { kind: "prayers"; prayers: number; blocks: number; summary: string }
  /** Nothing done, with the reason. */
  | { kind: "none"; text: string }
) & {
  /** This exchange, for the next instruction's follow-ups. */
  turn?: ChatTurn;
};

const ANSWER_SYSTEM =
  "You help edit Orthodox liturgical texts in a prayer editor. The text is shown as numbered sections with their kind ([left out] = not part of the prayer) and speaker. Answer in one to three sentences, in the language of the user's message. Never invent liturgical text; quote only what is given. Explain liturgical terms briefly from the terms below or common knowledge, even when they are not in the text; say plainly when you are not sure. Translating a passage in the chat is fine (the draft stays as it is). You cannot change anything by answering. In this chat the user can set kinds, speakers, inline annotations, the title, leave sections out, merge neighbouring sections, split a section, fix wording, undo. It cannot add a language (use Add language in the import), change fonts or colours (they are kind styles in Library settings), play audio, set tones, save files or send anything: say so when asked. Terms: (ἐκ γ΄), (γ΄), (3x), „dreimal“, „трижды“ = said three times; ιβ΄ / (12x) = twelve times; μ΄ = forty times. Troparion = short hymn of the day or feast; Kontakion = short hymn summing up the feast; Ikos = stanza after a kontakion; Theotokion = hymn to the Mother of God, often after „Ehre … Jetzt …“; Irmos = model stanza opening each ode of a canon; Ektenie / litany = petitions by the deacon answered „Herr, erbarme Dich“; Prokimenon = verse before a reading; Trisagion = „Heiliger Gott, heiliger Starker, heiliger Unsterblicher“.";

const EDIT_SYSTEM =
  "You change one paragraph of a liturgical text exactly as the instruction says and nothing else. Keep every other word, spelling and punctuation. Reply with the changed paragraph only, no quotes, no explanation.";

async function decide(runtime: DecisionRuntime, batch: DecisionBatch, signal: AbortSignal): Promise<number[][]> {
  const answers: number[][] = [];
  for (const prompt of decisionPrompts(batch, 40)) {
    await runtime.decide(batch, prompt, (i, p) => (answers[i] = p), signal);
  }
  return answers;
}

function best(answer: number[] | undefined): number {
  if (!answer) return -1;
  let b = 0;
  for (let i = 1; i < answer.length; i++) if (answer[i]! > answer[b]!) b = i;
  return b;
}

async function pick(runtime: DecisionRuntime, batch: DecisionBatch, signal: AbortSignal): Promise<string> {
  const [answer] = await decide(runtime, batch, signal);
  return batch.options[best(answer)]?.id ?? batch.options[0]!.id;
}

/** `n`: the number shown for the block; `ns`: every number of its source text (all languages). */
type Target = { block: string; text: string; n: number; ns?: number[]; kind?: string; speaker?: string };

/** Blocks of the open draft or prayer, with the numbers the user sees. */
function importTargets(draft: ImportDraft): Target[] {
  const key = draft.variants[0]!.key;
  const segs = segmentIndex(draft);
  return draft.blocks.flatMap((b) => {
    const first = (b.content[key] ?? []).find((s) => "seg" in s);
    const n = first && "seg" in first ? segs.get(first.seg)?.n : undefined;
    // Excluded blocks too: "take section 7 back in" must find them.
    const text = draftBlockPlainText(draft, b, key) || (first && "seg" in first ? (segs.get(first.seg)?.text ?? "") : "");
    const ns = Object.values(b.content)
      .flat()
      .flatMap((s) => ("seg" in s && segs.get(s.seg) ? [segs.get(s.seg)!.n] : []));
    const visible = draftBlockVisible(draft, b);
    return n === undefined && !visible
      ? []
      : [{ block: b.id, text, n: n ?? ns[0] ?? 0, ns, kind: visible ? b.kind : "left out", speaker: b.speaker }];
  });
}

function prayerTargets(prayer: Prayer): Target[] {
  // Every language of the block, so a quote in any of them finds it.
  return prayer.structure.map((b, i) => ({
    block: b.id,
    text: b.translations.map(plainOf).filter(Boolean).join(" / "),
    n: i + 1,
    kind: b.kind,
    speaker: b.speaker,
  }));
}

function plainOf(t: Prayer["structure"][number]["translations"][number] | undefined): string {
  if (!t) return "";
  const piece = (c: unknown): string =>
    typeof c === "string" ? c : Array.isArray(c) ? c.map((r) => (r as { v: string }).v).join("") : "";
  return "lines" in t && t.lines ? t.lines.map(piece).join("\n") : piece(t.text);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The blocks the wording names (Core's rules), or null when only the model can tell. */
function settledTargets(instruction: string, plan: ChatPlan, context: ChatContext, all: Target[], previous?: ChatTurn): Target[] | null {
  const ids = ruleTargets(
    instruction,
    plan,
    all.map((t) => ({ block: t.block, n: t.n, ns: t.ns, text: t.text, visible: t.kind !== "left out", speaker: t.speaker, kind: t.kind })),
    { chips: context.blocks, previous },
  );
  return ids ? all.filter((t) => ids.includes(t.block)) : null;
}

function kindOptions(custom: string[]) {
  return [...new Set([...KIND_PRESETS, ...custom])].map((id) => ({
    id,
    label: id === "annotation" ? "annotation (instruction, rubric)" : id === "verse" ? "verse (spoken or sung text)" : kindDisplayLabel(id).toLowerCase(),
  }));
}

const SPEAKER_LABELS: Record<string, string> = {
  bishop: "bishop", priest: "priest (Priester)", deacon: "deacon (Diakon)", reader: "reader (Leser)",
  cantor: "cantor (Kantor, Sänger)", choir: "choir (Chor)", people: "people (Volk)", all: "everyone (Alle)",
};

function speakerOptions(custom: string[]) {
  return [...new Set([...SPEAKER_PRESETS, ...custom])].map((id) => ({ id, label: SPEAKER_LABELS[id] ?? id }));
}

/** The model's plan for what the rules left open; empty when the model gives none. */
async function modelPlan(options: {
  instruction: string;
  view: ChatView;
  history: readonly ChatTurn[];
  all: Target[];
  selected: string[];
  known: ChatPlan;
  kinds: string[];
  speakers: string[];
  runtime: DecisionRuntime;
  signal: AbortSignal;
}): Promise<ChatPlan> {
  const { all, runtime, signal } = options;
  const numberOf = (block: string) => all.find((t) => t.block === block)?.n;
  const request = chatPlanRequest({
    instruction: options.instruction,
    view: options.view,
    history: options.history,
    paragraphs: all.map((t) => ({ n: t.n, text: t.text, kind: t.kind, speaker: t.speaker })),
    selected: options.selected.map(numberOf).filter((n): n is number => n !== undefined),
    known: options.known,
    numberOf,
  });
  try {
    const text = await runtime.generate(
      { ...request, maxTokens: 160, json: chatPlanSchema(options.view, options.kinds, options.speakers) },
      () => {},
      signal,
    );
    return readChatPlan(JSON.parse(text), { view: options.view, kinds: options.kinds, speakers: options.speakers });
  } catch {
    return {};
  }
}

/** One line for the conversation history. */
function turnSummary(outcome: ChatOutcome): string {
  switch (outcome.kind) {
    case "answer":
      return outcome.text.replace(/\s+/g, " ").slice(0, 160);
    case "import":
      return outcome.understood ?? "Changed the import";
    case "prayers":
      return outcome.summary;
    case "none":
      return outcome.text;
  }
}

function withTurn(outcome: ChatOutcome, instruction: string, action: ChatAction | null, blocks: string[], plan?: ChatPlan): ChatOutcome {
  const changed = outcome.kind === "import" && outcome.changes.length > 0;
  const { correct: _c, again: _a, explain: _e, readBack: _r, ...kept } = plan ?? {};
  return { ...outcome, turn: { instruction, action, blocks, summary: turnSummary(outcome), plan: plan ? kept : undefined, changed } };
}

export async function runInstruction(options: {
  instruction: string;
  context: ChatContext;
  runtime: DecisionRuntime;
  /** Tool host whose import changes carry origin "model" and whose confirm shows a card in the chat. */
  host: ToolHost;
  signal: AbortSignal;
  onAnswerText?: (chunk: string) => void;
  /** Earlier exchanges of this conversation, oldest first. */
  history?: readonly ChatTurn[];
  /** Undo the last answer that changed the Import draft; false when it cannot (later edits). */
  undoLast?: () => boolean;
}): Promise<ChatOutcome> {
  const { instruction, context, runtime, host, signal } = options;
  const history = options.history ?? [];
  const previous = history.at(-1);
  const draft = context.view === "import" ? host.importDraft() : null;
  const prayer = context.view === "prayer" ? host.selectedPrayer() : null;
  const all = draft ? importTargets(draft) : prayer ? prayerTargets(prayer) : [];
  const target = { importDraft: draft, prayer };
  const speakerName = (id: string) => chatSpeakerName(target, id);

  const customSpeakers = draft
    ? draft.variants.flatMap((v) => Object.keys(v.speakers ?? {}))
    : (prayer?.variants.flatMap((v) => Object.keys(v.speakers ?? {})) ?? []);
  const options_ = chatPlanOptions(draft);
  const kinds = [...new Set([...options_.kinds, ...(prayer?.kinds?.map((k) => k.id) ?? [])])];
  const speakers = [...new Set([...options_.speakers, ...customSpeakers])];

  // 1. What the wording settles.
  const lastChange = [...history].reverse().find((t) => t.changed && t.plan?.action && t.action !== "undo");
  let plan = ruleChatPlan(instruction, context.view, { previous, customSpeakers, lastChange });
  if (plan.cancel) return withTurn({ kind: "answer", text: "Okay, I leave it as it is." }, instruction, "answer", []);
  if (plan.cannot) return withTurn({ kind: "answer", text: plan.cannot }, instruction, "answer", []);

  if (plan.action === "undo") {
    const done = options.undoLast?.() ?? false;
    const changedTurn = [...history].reverse().find((t) => t.changed);
    const text = done
      ? `Undone: ${changedTurn?.summary ?? "the last change"}.`
      : "Nothing to undo here. Use Undo in the toolbar (⌘Z) for your own edits.";
    return withTurn({ kind: "none", text }, instruction, "undo", previous?.blocks ?? []);
  }
  if (plan.explain) {
    const text = previous
      ? previous.changed
        ? `Because you wrote „${previous.instruction}“, I did this: ${previous.summary}. If that is wrong, say what you meant or type “rückgängig”.`
        : `For „${previous.instruction}“ I answered: ${previous.summary}`
      : "I have not changed anything yet.";
    return withTurn({ kind: "answer", text }, instruction, "answer", previous?.blocks ?? []);
  }
  // "Nein, …": the previous answer goes first, then the corrected one.
  const corrected = plan.correct && previous?.changed ? (options.undoLast?.() ?? false) : false;
  const fresh = corrected ? host.importDraft() : draft;
  if (corrected && fresh) all.splice(0, all.length, ...importTargets(fresh));

  let targets = settledTargets(instruction, plan, context, all, previous);
  plan.explicit =
    sectionNumbers(instruction).length > 0 || bareNumbers(instruction).length > 0 || context.blocks.length > 0 || Boolean(plan.quote) || meansAll(instruction);
  if (plan.readBack) {
    const shown = (targets ?? []).slice(0, 3);
    const text = shown.length > 0 ? shown.map((t) => `${t.n}. ${t.text}`).join("\n") : "Which section? Name its number, e.g. “Was steht in Abschnitt 4?”.";
    return withTurn({ kind: "answer", text }, instruction, "answer", shown.map((t) => t.block));
  }

  // 2. The model fills the gaps, in one answer with the conversation.
  const needsKind = plan.action === "setKind" && !plan.kind;
  const needsSpeaker = plan.action === "setSpeaker" && !plan.speaker;
  const needsTargets = !targets && plan.action !== "answer" && context.view !== "library" && !(plan.action === "setTitle" && plan.title);
  if (!plan.action || needsKind || needsSpeaker || needsTargets) {
    const model = await modelPlan({
      instruction,
      view: context.view,
      history,
      all,
      selected: context.blocks,
      known: plan,
      kinds,
      speakers,
      runtime,
      signal,
    });
    // A quote the model made up (not in any section) is dropped.
    if (model.quote && !all.some((t) => norm(t.text).includes(norm(model.quote!)))) delete model.quote;
    plan = mergeChatPlans(plan, model);
    if (!targets && model.sections?.length && plan.action !== "exclude") {
      const hits = all.filter((t) => model.sections!.includes(t.n));
      if (hits.length > 0) targets = hits;
    }
  }
  if (signal.aborted) return { kind: "none", text: "Stopped." };

  // 3. Decisions for whatever is still open (the model gave no usable plan).
  const action: ChatAction = plan.action ?? ((await pick(runtime, actionBatch(context.view, instruction), signal)) as ChatAction);
  plan = { ...plan, action };
  if (action === "setKind" && !plan.kind) {
    plan.kind = await pick(runtime, choiceBatch("Which kind does the instruction name?", kindOptions(kinds), instruction), signal);
  }
  if (action === "setSpeaker" && !plan.speaker) {
    plan.speaker = await pick(runtime, choiceBatch("Which speaker does the instruction name?", speakerOptions(customSpeakers), instruction), signal);
  }

  if (action === "answer") {
    const chips = all.filter((t) => context.blocks.includes(t.block));
    const shown = (chips.length > 0 ? chips : all)
      .map((t) => `${t.n}. [${t.kind ?? "verse"}${t.speaker ? `, ${t.speaker}` : ""}] ${t.text.replace(/\s+/g, " ").slice(0, 200)}`)
      .join("\n")
      .slice(0, 4000);
    const past = history.slice(-4).map((t) => `User: ${t.instruction}\nYou: ${t.summary}`).join("\n");
    const user = `${shown}\n\n${past ? `Conversation so far:\n${past}\n\n` : ""}${instruction}`;
    const text = await runtime.generate({ system: ANSWER_SYSTEM, user }, options.onAnswerText ?? (() => {}), signal);
    return withTurn({ kind: "answer", text }, instruction, action, chips.map((t) => t.block));
  }

  // --- The Library, or the open prayer ---------------------------------
  if (!draft) {
    const library = host.library();
    if (!library) return withTurn({ kind: "none", text: "Open a library first." }, instruction, action, []);
    const scope = !prayer ? "library" : (plainScope(instruction) ?? (await pick(runtime, scopeBatch(instruction), signal)));
    if (action !== "setKind" && action !== "setSpeaker" && action !== "removeSpeaker") {
      return withTurn({ kind: "none", text: "That works in the import view." }, instruction, action, []);
    }
    type Planned = { prayer: Prayer; targets: Target[] };
    const planned: Planned[] = [];
    if (scope === "library") {
      const quote = plan.quote;
      if (!quote) {
        return withTurn(
          {
            kind: "none",
            text: prayer
              ? "For a change in every prayer, put the text in quotes, e.g. „Ehre sei dem Vater …“."
              : "Open a prayer to change its blocks, or put the text in quotes to change it in every prayer.",
          },
          instruction,
          action,
          [],
        );
      }
      for (const entry of library.entries) {
        if (!entry.id) continue;
        const p = entry.id === prayer?.id ? prayer : await host.readPrayer(entry.id);
        if (!p) continue;
        // A block whose text in some language starts with the quote.
        const hits = prayerTargets(p).filter((t) => norm(` / ${t.text}`).includes(`/ ${norm(quote)}`));
        if (hits.length > 0) planned.push({ prayer: p, targets: hits });
      }
    } else {
      planned.push({ prayer: prayer!, targets: targets ?? (await decidedTargets(instruction, all, runtime, signal)) });
    }
    const blocks = planned.reduce((n, p) => n + p.targets.length, 0);
    if (blocks === 0) {
      return withTurn(
        {
          kind: "none",
          text:
            scope === "library" && plan.quote
              ? `No block in the library starts with „${plan.quote}“.`
              : "I could not tell which blocks you mean. Select them or put their text in quotes.",
        },
        instruction,
        action,
        [],
      );
    }
    let patch: { kind?: string; speaker?: string; removeSpeaker?: true };
    let what: string;
    if (action === "setKind") {
      patch = { kind: plan.kind! };
      what = `Kind ${kindDisplayLabel(plan.kind!)}`;
    } else if (action === "setSpeaker") {
      patch = { speaker: plan.speaker! };
      what = `Speaker ${speakerDisplayLabel(plan.speaker!)}`;
    } else {
      patch = { removeSpeaker: true };
      what = "Speaker removed";
    }
    const answer = await callTool(host, "prayers.edit", {
      edits: planned.flatMap((p) => p.targets.map((t) => ({ prayer: p.prayer.id, block: t.block, ...patch }))),
    });
    const ids = planned.flatMap((p) => p.targets.map((t) => t.block));
    if (!answer.ok) {
      const declined = answer.error === "The user declined the change";
      return withTurn({ kind: "none", text: declined ? "Cancelled. Nothing changed." : answer.error }, instruction, action, ids);
    }
    const where = planned.length === 1 ? `${blocks} ${blocks === 1 ? "block" : "blocks"}` : `${blocks} blocks in ${planned.length} prayers`;
    return withTurn(
      {
        kind: "prayers",
        prayers: planned.length,
        blocks,
        summary: `Done: ${what} for ${where}. Unsaved until you save; Undo in the editor reverts it.`,
      },
      instruction,
      action,
      ids,
    );
  }

  // --- The Import draft --------------------------------------------------
  // Leaving out is never guessed: the model's pick of sections to leave out is not applied.
  const guessed = !targets;
  if (guessed && action === "exclude") {
    return withTurn(
      { kind: "none", text: "Which sections should go? Name their numbers or click one. Site menus and footers the import recognised are already left out." },
      instruction,
      action,
      [],
    );
  }
  const chosen = targets ?? (action === "setTitle" && plan.title ? [] : await decidedTargets(instruction, all, runtime, signal));
  const current = host.importDraft() ?? draft;
  const ids = chosen.map((t) => t.block);
  const numbers = [...new Set(chosen.map((t) => t.n))].sort((a, b) => a - b);
  const understood = chatPlanSummary(plan, numbers, speakerName);
  if (chosen.length === 0 && !(action === "setTitle" && plan.title)) {
    const here = /\b(hier|this one|this here|das hier)\b/iu.test(instruction);
    return withTurn(
      {
        kind: "none",
        text: here
          ? `${understood}: click the section you mean in the editor, then send again.`
          : `${understood}: I could not tell which sections you mean. Select them, name their numbers or quote their text.`,
      },
      instruction,
      action,
      [],
    );
  }
  const key = draft.variants[0]!.key;
  let ops: ImportOp[];
  let skipped: Array<{ block: string; reason: string }>;
  if (action === "editText" && plan.replacement === undefined) {
    ops = [];
    skipped = [];
    for (const t of chosen.slice(0, 12)) {
      const text = await runtime.generate(
        { system: EDIT_SYSTEM, user: `Instruction: ${instruction}\n\nParagraph:\n${t.text}`, maxTokens: Math.max(64, t.text.length) },
        () => {},
        signal,
      );
      const edit = text ? editTextOps(current, t.block, key, text) : [];
      if (edit.length === 0) skipped.push({ block: t.block, reason: "the model left the wording as it was" });
      ops.push(...edit);
    }
  } else {
    ({ ops, skipped } = chatImportOps(current, plan, ids, speakerName));
  }
  if (signal.aborted) return { kind: "none", text: "Stopped." };
  const numberOf = (block: string) => chosen.find((t) => t.block === block)?.n ?? 0;
  const reasons = skipped.map((s) => ({ n: numberOf(s.block), reason: s.reason }));
  if (ops.length === 0) {
    if (corrected) {
      return withTurn({ kind: "none", text: `Took back the last change. Now: ${understood}.` }, instruction, action, ids, plan);
    }
    const why = reasons.length > 0 ? groupSkips(reasons) : "there was nothing to do";
    return withTurn({ kind: "none", text: `${understood}. Nothing changed: ${why}.` }, instruction, action, ids, plan);
  }
  const before = host.importDraft()!;
  const answer = await callTool(host, "import.apply", { ops });
  if (!answer.ok) return withTurn({ kind: "none", text: `${understood}. ${answer.error}` }, instruction, action, ids, plan);
  const after = host.importDraft()!;
  return withTurn(
    { kind: "import", changes: draftChanges(before, after), before, after, understood: corrected ? `${understood} (instead of the last change)` : understood, skipped: reasons },
    instruction,
    action,
    ids,
    plan,
  );
}

/** One Decision per block: does the instruction apply to it? */
async function decidedTargets(instruction: string, all: Target[], runtime: DecisionRuntime, signal: AbortSignal): Promise<Target[]> {
  const batch = targetBatch(instruction, all.map((t) => ({ block: t.block, text: t.text })));
  const answers = await decide(runtime, batch, signal);
  return all.filter((_, i) => (answers[i]?.[0] ?? 0) >= 0.5);
}
