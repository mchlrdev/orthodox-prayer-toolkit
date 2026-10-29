import {
  KIND_PRESETS,
  SPEAKER_PRESETS,
  actionBatch,
  choiceBatch,
  decisionPrompts,
  draftBlockPlainText,
  draftBlockVisible,
  draftChanges,
  kindDisplayLabel,
  quotedText,
  plainScope,
  plainAction,
  scopeBatch,
  sectionNumbers,
  speakerDisplayLabel,
  speakerForLabel,
  speakerNamedIn,
  targetBatch,
  type ChatAction,
  type ChatView,
  type DecisionBatch,
  type DraftChange,
  type ImportDraft,
  type ImportOp,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import { callTool, type ToolHost } from "../agentTools/toolDirectory";
import { segmentIndex } from "../importDraft/sourceView";
import type { DecisionRuntime } from "./decisionRuntime";

/**
 * One instruction from the Chat pane, run by the Built-in model through the
 * Tool directory: the model picks the action, then kind or speaker, scope
 * and target blocks by Decisions; the change is one Tool call (one undo
 * step). Questions and translations are answered as text.
 */

export type ChatContext = {
  view: ChatView;
  /** Blocks the user put in the chat as context (selection chips). */
  blocks: string[];
};

export type ChatOutcome =
  | { kind: "answer"; text: string }
  /** Import draft changed: what changed per block, and the draft before/after (for Undo). */
  | { kind: "import"; changes: DraftChange[]; before: ImportDraft; after: ImportDraft }
  /** Prayers in the Library changed (unsaved). */
  | { kind: "prayers"; prayers: number; blocks: number; summary: string }
  /** Nothing done, with the reason. */
  | { kind: "none"; text: string };

const ANSWER_SYSTEM =
  "You help edit Orthodox liturgical texts in a prayer editor. Answer briefly, in the language of the user's message. Never invent liturgical text; quote only what is given.";

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

type Target = { block: string; text: string; n: number };

/** Blocks of the open draft or prayer, with the numbers the user sees. */
function importTargets(draft: ImportDraft): Target[] {
  const key = draft.variants[0]!.key;
  const segs = segmentIndex(draft);
  return draft.blocks.flatMap((b) => {
    const first = (b.content[key] ?? []).find((s) => "seg" in s);
    const n = first && "seg" in first ? segs.get(first.seg)?.n : undefined;
    // Excluded blocks too: "take section 7 back in" must find them.
    const text = draftBlockPlainText(draft, b, key) || (first && "seg" in first ? (segs.get(first.seg)?.text ?? "") : "");
    return n === undefined && !draftBlockVisible(draft, b) ? [] : [{ block: b.id, text, n: n ?? 0 }];
  });
}

function prayerTargets(prayer: Prayer): Target[] {
  // Every language of the block, so a quote in any of them finds it.
  return prayer.structure.map((b, i) => ({
    block: b.id,
    text: b.translations.map(plainOf).filter(Boolean).join(" / "),
    n: i + 1,
  }));
}

function plainOf(t: Prayer["structure"][number]["translations"][number] | undefined): string {
  if (!t) return "";
  const piece = (c: unknown): string =>
    typeof c === "string" ? c : Array.isArray(c) ? c.map((r) => (r as { v: string }).v).join("") : "";
  return "lines" in t && t.lines ? t.lines.map(piece).join("\n") : piece(t.text);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Which blocks the instruction means: chips, numbers, a quote, or one Decision per block. */
async function chooseTargets(
  instruction: string,
  context: ChatContext,
  all: Target[],
  runtime: DecisionRuntime,
  signal: AbortSignal,
): Promise<Target[]> {
  if (context.blocks.length > 0) return all.filter((t) => context.blocks.includes(t.block));
  const numbers = sectionNumbers(instruction);
  if (numbers.length > 0) return all.filter((t) => numbers.includes(t.n));
  const quote = quotedText(instruction);
  if (quote) {
    const q = norm(quote);
    const hits = all.filter((t) => norm(t.text).includes(q));
    if (hits.length > 0) return hits;
  }
  const batch = targetBatch(instruction, all.map((t) => ({ block: t.block, text: t.text })));
  const answers = await decide(runtime, batch, signal);
  return all.filter((_, i) => (answers[i]?.[0] ?? 0) >= 0.5);
}

function kindOptions(custom: string[]) {
  return [...KIND_PRESETS, ...custom].map((id) => ({
    id,
    label: id === "heading" ? "heading" : id === "subheading" ? "subheading" : id === "annotation" ? "annotation (instruction, rubric)" : id === "verse" ? "verse (spoken or sung text)" : kindDisplayLabel(id),
  }));
}

const SPEAKER_LABELS: Record<string, string> = {
  bishop: "bishop", priest: "priest (Priester)", deacon: "deacon (Diakon)", reader: "reader (Leser)",
  cantor: "cantor (Kantor, Sänger)", choir: "choir (Chor)", people: "people (Volk)", all: "everyone (Alle)",
};

async function chooseSpeaker(
  instruction: string,
  custom: string[],
  runtime: DecisionRuntime,
  signal: AbortSignal,
): Promise<string> {
  const quote = quotedText(instruction);
  const known = (quote ? speakerForLabel(quote) : undefined) ?? speakerNamedIn(instruction.replace(quote ?? "", ""));
  if (known) return known;
  const ids = [...SPEAKER_PRESETS, ...custom.filter((c) => !(SPEAKER_PRESETS as readonly string[]).includes(c))];
  return pick(
    runtime,
    choiceBatch("Which speaker does the instruction name?", ids.map((id) => ({ id, label: SPEAKER_LABELS[id] ?? id })), instruction),
    signal,
  );
}

function contextText(targets: Target[], fallback: string): string {
  const text = targets.length > 0 ? targets.map((t) => `${t.n}. ${t.text}`).join("\n") : fallback;
  return text.slice(0, 4000);
}

export async function runInstruction(options: {
  instruction: string;
  context: ChatContext;
  runtime: DecisionRuntime;
  /** Tool host whose import changes carry origin "model" and whose confirm shows a card in the chat. */
  host: ToolHost;
  signal: AbortSignal;
  onAnswerText?: (chunk: string) => void;
}): Promise<ChatOutcome> {
  const { instruction, context, runtime, host, signal } = options;
  const draft = context.view === "import" ? host.importDraft() : null;
  const prayer = context.view === "prayer" ? host.selectedPrayer() : null;
  const action =
    plainAction(instruction) ?? ((await pick(runtime, actionBatch(context.view, instruction), signal)) as ChatAction);

  const all = draft ? importTargets(draft) : prayer ? prayerTargets(prayer) : [];

  if (action === "answer") {
    const chips = all.filter((t) => context.blocks.includes(t.block));
    const user = `${contextText(chips, all.map((t) => `${t.n}. ${t.text}`).join("\n"))}\n\n${instruction}`;
    const text = await runtime.generate({ system: ANSWER_SYSTEM, user }, options.onAnswerText ?? (() => {}), signal);
    return { kind: "answer", text };
  }

  // --- The Library, or the open prayer ---------------------------------
  if (!draft) {
    const library = host.library();
    if (!library) return { kind: "none", text: "Open a library first." };
    const scope = !prayer ? "library" : (plainScope(instruction) ?? (await pick(runtime, scopeBatch(instruction), signal)));
    if (action !== "setKind" && action !== "setSpeaker" && action !== "removeSpeaker") {
      return { kind: "none", text: "That works in the import view." };
    }
    type Planned = { prayer: Prayer; targets: Target[] };
    const planned: Planned[] = [];
    if (scope === "library") {
      const quote = quotedText(instruction);
      if (!quote) {
        return {
          kind: "none",
          text: prayer
            ? "For a change in every prayer, put the text in quotes, e.g. „Ehre sei dem Vater …“."
            : "Open a prayer to change its blocks, or put the text in quotes to change it in every prayer.",
        };
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
      planned.push({ prayer: prayer!, targets: await chooseTargets(instruction, context, all, runtime, signal) });
    }
    const blocks = planned.reduce((n, p) => n + p.targets.length, 0);
    if (blocks === 0) {
      const quote = quotedText(instruction);
      return {
        kind: "none",
        text:
          scope === "library" && quote
            ? `No block in the library starts with „${quote}“.`
            : "I could not tell which blocks you mean. Select them or put their text in quotes.",
      };
    }
    const customKinds = planned.flatMap((p) => p.prayer.kinds?.map((k) => k.id) ?? []);
    const customSpeakers = planned.flatMap((p) => p.prayer.variants.flatMap((v) => Object.keys(v.speakers ?? {})));
    let patch: { kind?: string; speaker?: string; removeSpeaker?: true };
    let what: string;
    if (action === "setKind") {
      const kind = await pick(runtime, choiceBatch("Which kind does the instruction name?", kindOptions(customKinds), instruction), signal);
      patch = { kind };
      what = `Kind ${kindDisplayLabel(kind)}`;
    } else if (action === "setSpeaker") {
      const speaker = await chooseSpeaker(instruction, customSpeakers, runtime, signal);
      patch = { speaker };
      what = `Speaker ${speakerDisplayLabel(speaker)}`;
    } else {
      patch = { removeSpeaker: true };
      what = "Speaker removed";
    }
    const answer = await callTool(host, "prayers.edit", {
      edits: planned.flatMap((p) => p.targets.map((t) => ({ prayer: p.prayer.id, block: t.block, ...patch }))),
    });
    if (!answer.ok) {
      const declined = answer.error === "The user declined the change";
      return { kind: "none", text: declined ? "Cancelled. Nothing changed." : answer.error };
    }
    const where = planned.length === 1 ? `${blocks} ${blocks === 1 ? "block" : "blocks"}` : `${blocks} blocks in ${planned.length} prayers`;
    return {
      kind: "prayers",
      prayers: planned.length,
      blocks,
      summary: `Done: ${what} for ${where}. Unsaved until you save; Undo in the editor reverts it.`,
    };
  }

  // --- The Import draft --------------------------------------------------
  const targets = await chooseTargets(instruction, context, all, runtime, signal);
  if (targets.length === 0) {
    return { kind: "none", text: "I could not tell which sections you mean. Select them, name their numbers or quote their text." };
  }
  const key = draft.variants[0]!.key;
  const ops: ImportOp[] = [];
  const segsOf = (id: string) =>
    (draft.blocks.find((b) => b.id === id)?.content[key] ?? []).flatMap((s) => ("seg" in s ? [s.seg] : []));
  switch (action) {
    case "setKind": {
      const kind = await pick(
        runtime,
        choiceBatch("Which kind does the instruction name?", kindOptions(draft.kinds.map((k) => k.id)), instruction),
        signal,
      );
      for (const t of targets) ops.push({ op: "setKind", target: { block: t.block }, kind });
      break;
    }
    case "setSpeaker": {
      const speaker = await chooseSpeaker(
        instruction,
        draft.variants.flatMap((v) => Object.keys(v.speakers ?? {})),
        runtime,
        signal,
      );
      const variant = draft.variants[0]!;
      let speakers = variant.speakers;
      for (const t of targets) {
        const block = draft.blocks.find((b) => b.id === t.block)!;
        if (block.kind !== "verse" && !draft.kinds.some((k) => k.id === block.kind && k.speaker)) {
          ops.push({ op: "setKind", target: { block: t.block }, kind: "verse" });
        }
        // "Priester: …" — the label goes, its name becomes the speaker's name.
        const m = /^([^:\n]{1,40}):\s+/u.exec(t.text);
        if (m && speakerForLabel(m[1]!) === speaker) {
          ops.push({ op: "removeText", block: t.block, variant: key, start: 0, end: m[0].length });
          if (!speakers?.[speaker]) speakers = { ...speakers, [speaker]: { name: m[1]! } };
        }
        ops.push({ op: "setSpeaker", block: t.block, speaker });
      }
      if (speakers !== variant.speakers) ops.push({ op: "setVariantMeta", variant: key, patch: { speakers } });
      break;
    }
    case "removeSpeaker":
      for (const t of targets) ops.push({ op: "setSpeaker", block: t.block, speaker: null });
      break;
    case "exclude":
    case "include":
      ops.push({
        op: "setExcluded",
        segments: [...new Set(targets.flatMap((t) => segsOf(t.block)))],
        excluded: action === "exclude",
      });
      break;
    case "editText":
      for (const t of targets.slice(0, 12)) {
        const text = await runtime.generate(
          { system: EDIT_SYSTEM, user: `Instruction: ${instruction}\n\nParagraph:\n${t.text}`, maxTokens: Math.max(64, t.text.length) },
          () => {},
          signal,
        );
        if (!text || text === t.text) continue;
        const block = draft.blocks.find((b) => b.id === t.block)!;
        ops.push({
          op: "setText",
          block: t.block,
          variant: key,
          content: block.kind === "verse" ? text.split("\n") : text,
        });
      }
      break;
  }
  if (signal.aborted) return { kind: "none", text: "Stopped." };
  if (ops.length === 0) return { kind: "none", text: "Nothing to change." };
  const before = host.importDraft()!;
  const answer = await callTool(host, "import.apply", { ops });
  if (!answer.ok) return { kind: "none", text: answer.error };
  const after = host.importDraft()!;
  return { kind: "import", changes: draftChanges(before, after), before, after };
}
