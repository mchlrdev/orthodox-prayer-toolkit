/**
 * Decisions: the questions the Built-in model answers for the first draft.
 * Each question has a fixed set of options; the model's answer is the
 * probability of each option (read from one evaluation, no free text). This
 * module owns the questions as data, the prompt text and how answers become
 * Import operations. Rules follow the `encode-prayer` skill.
 */
import {
  draftBlockPlainText,
  draftBlockVisible,
  type DraftBlock,
  type ImportDraft,
  type ImportOp,
  type ImportOrigin,
} from "./importDraft.js";
import type { SegmentLook } from "./importSource.js";
import { isValidSpeakerId, SPEAKER_PRESETS } from "./speakers.js";

export type DecisionKind = "role" | "prefix" | "speaker" | "pair";

export type DecisionOption = { id: string; label: string };

/** One thing to decide about one block. */
export type DecisionItem = {
  block: string;
  /** What the model reads for this item (one line). */
  text: string;
  /** For `prefix`: the label before the colon and where the words start. */
  prefix?: { label: string; end: number; next: number };
};

/** One question asked about many blocks in a row (the model reads them all once). */
export type DecisionBatch = {
  kind: DecisionKind;
  /** Variant key the item texts come from. */
  variant: string;
  question: string;
  options: DecisionOption[];
  /** Worked examples shown before the items: text → option id. */
  examples?: Array<[string, string]>;
  items: DecisionItem[];
};

/** Answer for one item: probability per option, in option order (sums to 1). */
export type DecisionAnswer = number[];

/** Below this probability a model decision is shown as uncertain. */
export const UNCERTAIN_BELOW = 0.7;

const LETTERS = "ABCDEFGHIJKLMNOP";

const ROLE_OPTIONS: DecisionOption[] = [
  { id: "heading", label: "heading: names the item that follows (“Ostertroparion im 5. Ton”, “Psalm 50”)" },
  { id: "subheading", label: "subheading: a second heading level below a heading" },
  { id: "annotation", label: "annotation: an instruction with no spoken words of its own (“Dann dreimal:”, “Stehend.”)" },
  { id: "verse", label: "verse: words that are said or sung, including doxologies, Amen and “Herr, erbarme Dich!”" },
  { id: "exclude", label: "not part of the prayer: site navigation, page numbers, copyright, “print this page”" },
];

const SPEAKER_NAMES: Record<string, string> = {
  bishop: "the bishop",
  priest: "the priest",
  deacon: "the deacon",
  reader: "the reader",
  cantor: "the cantor",
  choir: "the choir",
  people: "the people",
  all: "everyone",
};

const PREFIX_OPTIONS: DecisionOption[] = [
  { id: "heading", label: "a hymn or genre label naming what follows (Troparion, Kontakion, Psalm)" },
  { id: "note", label: "an instruction how or how often to say it (Dann vierzigmal, Stehend)" },
  { id: "speaker", label: "who speaks (Priester, Diakon, Chor, Volk)" },
  { id: "text", label: "the start of the spoken words themselves" },
];

const SPEAKER_OPTIONS: DecisionOption[] = [
  ...SPEAKER_PRESETS.map((id) => ({ id, label: SPEAKER_NAMES[id]! })),
  { id: "other", label: "someone else" },
];

/** Speaker labels as printed (lower case) → preset id; others go to the model. */
const SPEAKER_LABELS: Record<string, string> = {
  bischof: "bishop", bishop: "bishop", архиерей: "bishop", епископ: "bishop",
  priester: "priest", priest: "priest", иерей: "priest", священник: "priest", ιερεύς: "priest", ἱερεύς: "priest",
  diakon: "deacon", deacon: "deacon", диакон: "deacon", διάκονος: "deacon",
  leser: "reader", lektor: "reader", reader: "reader", чтец: "reader", αναγνώστης: "reader",
  kantor: "cantor", cantor: "cantor", псаломщик: "cantor",
  chor: "choir", choir: "choir", хор: "choir", лик: "choir", χορός: "choir",
  volk: "people", people: "people", gemeinde: "people", люди: "people", λαός: "people",
  alle: "all", all: "all", все: "all", πάντες: "all",
};

const PAIR_OPTIONS: DecisionOption[] = [
  { id: "same", label: "the same passage in two languages" },
  { id: "different", label: "different passages" },
];

const RULES = `You sort the paragraphs of an Orthodox liturgical text for a prayer editor.
Classify by role, not by typeface: genre labels and instructions often look alike in print.
Spoken liturgical text is verse: the Gloria Patri ("Ehre sei dem Vater…"), "Jetzt und immerdar… Amen.", "Herr, erbarme Dich!", the Trisagion, Theotokia and hymns. A trailing colon does not make a doxology an instruction.
An instruction that only introduces a named hymn is an annotation.
Greek, Church Slavonic or other languages inside the text are verse like the rest.`;

/** Compact appearance for the model: "bold, 14pt, centered, style Heading 1". */
export function describeLook(look: SegmentLook): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(look)) {
    if (key === "column" || value === false || value === "") continue;
    if (value === true) parts.push(key);
    else if (key === "size" && typeof value === "number") parts.push(`${value}pt`);
    else if (String(value).length <= 24) parts.push(`${key} ${value}`);
  }
  return parts.join(", ");
}

function oneLine(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function blockLook(draft: ImportDraft, block: DraftBlock, variant: string): string {
  const first = block.content[variant]?.find((s) => "seg" in s);
  if (!first || !("seg" in first)) return "";
  for (const source of draft.sources) {
    const seg = source.segments.find((s) => s.id === first.seg);
    if (seg) return describeLook(seg.look);
  }
  return "";
}

/** "Priester:" at the start: a label of up to ~6 words, then the words. */
// A period only after a digit ("im 4. Ton"), never as a sentence end.
const PREFIX_RE = /^([^\s:.!?;](?:[^:.!?;\n]|(?<=\d)\.){0,48}?):\s+(?=\S)/u;

/**
 * The first-draft questions for a fresh Import draft: the role of every
 * visible block, what a "Label:" at the start of a block is, and whether
 * blocks paired by order really are the same passage.
 */
export function firstDraftBatches(draft: ImportDraft): DecisionBatch[] {
  const main = draft.variants[0]!.key;
  const visible = draft.blocks.filter((b) => draftBlockVisible(draft, b) && b.content[main]);
  const role: DecisionBatch = {
    kind: "role",
    variant: main,
    question: "Which role does each paragraph have?",
    options: ROLE_OPTIONS,
    examples: [
      ["Ostertroparion im 5. Ton", "heading"],
      ["Dann dreimal das Ostertroparion:", "annotation"],
      ["Ehre sei dem Vater und dem Sohne und dem Heiligen Geiste:", "verse"],
      ["Impressum · Seite drucken", "exclude"],
    ],
    items: visible.map((b) => {
      const look = blockLook(draft, b, main);
      const text = oneLine(draftBlockPlainText(draft, b, main));
      return { block: b.id, text: look ? `(${look}) ${text}` : text };
    }),
  };
  const prefix: DecisionBatch = {
    kind: "prefix",
    variant: main,
    question: "Each line starts with a quoted label before a colon. What is the label?",
    options: PREFIX_OPTIONS,
    examples: [
      ['"Diakon" → Diakon: Lasset uns beten zum Herrn.', "speaker"],
      ['"Troparion im 4. Ton" → Troparion im 4. Ton: Dein Märtyrer, o Herr …', "heading"],
      ['"Dann dreimal" → Dann dreimal: Herr, erbarme Dich!', "note"],
      ['"Herr" → Herr: erbarme Dich unser.', "text"],
    ],
    items: visible.flatMap((b) => {
      const text = draftBlockPlainText(draft, b, main);
      const m = PREFIX_RE.exec(text);
      if (!m) return [];
      const label = m[1]!;
      return [
        {
          block: b.id,
          text: `"${label}" → ${oneLine(text, 160)}`,
          prefix: { label, end: label.length + 1, next: m[0].length },
        },
      ];
    }),
  };
  const batches = [role];
  if (prefix.items.length > 0) batches.push(prefix);
  const other = draft.variants[1]?.key;
  if (other) {
    const pairs = visible.filter((b) => b.content[other]);
    if (pairs.length > 0) {
      batches.push({
        kind: "pair",
        variant: main,
        question: "Is each pair the same passage in two languages?",
        options: PAIR_OPTIONS,
        items: pairs.map((b) => ({
          block: b.id,
          text: `${oneLine(draftBlockPlainText(draft, b, main), 120)} || ${oneLine(draftBlockPlainText(draft, b, other), 120)}`,
        })),
      });
    }
  }
  return batches;
}

/** The preset a printed speaker label names ("Priester" → priest), if known. */
export function speakerForLabel(label: string): string | undefined {
  return SPEAKER_LABELS[label.trim().toLowerCase()];
}

/**
 * Follow-up for prefix items answered "who speaks" whose label is not a
 * known one: which speaker is it? Null when there is nothing to ask.
 */
export function speakerBatch(prefix: DecisionBatch, items: DecisionItem[]): DecisionBatch | null {
  const ask = items.filter((i) => i.prefix && !speakerForLabel(i.prefix.label));
  if (ask.length === 0) return null;
  return {
    kind: "speaker",
    variant: prefix.variant,
    question: "Who speaks, going by the quoted label?",
    options: SPEAKER_OPTIONS,
    examples: [
      ['"Protodiakon" → Protodiakon: Weisheit!', "deacon"],
      ['"Sänger" → Sänger: Amen.', "cantor"],
    ],
    items: ask,
  };
}

/** Text the model reads; the runtime adds the model's chat format around it. */
export type DecisionPrompt = {
  system: string;
  user: string;
  /** Option letters; the answer for item i is read right after `itemPrefix(i)`. */
  letters: string[];
  /** Index into `batch.items` of the prompt's first item. */
  first: number;
  count: number;
};

/** What the runtime appends before reading item i's answer letter. */
export function decisionItemPrefix(i: number): string {
  return `${i + 1}=`;
}

/** Prompts for a batch, at most `maxItems` items each (keeps the context small). */
export function decisionPrompts(batch: DecisionBatch, maxItems = 60): DecisionPrompt[] {
  const letters = batch.options.map((_, i) => LETTERS[i]!);
  const options = batch.options.map((o, i) => `${letters[i]}) ${o.label}`).join("\n");
  const prompts: DecisionPrompt[] = [];
  for (let first = 0; first < batch.items.length; first += maxItems) {
    const items = batch.items.slice(first, first + maxItems);
    const list = items.map((item, i) => `${i + 1}. ${item.text}`).join("\n");
    const letterOf = (id: string) => letters[batch.options.findIndex((o) => o.id === id)];
    const examples = batch.examples?.length
      ? `Examples:\n${batch.examples.map(([text, id]) => `${text} = ${letterOf(id)}`).join("\n")}\n\n`
      : "";
    prompts.push({
      system: RULES,
      user: `${batch.question}\n${options}\n\n${examples}Items:\n${list}\n\nAnswer one line per item as "number=letter", in order.`,
      letters,
      first,
      count: items.length,
    });
  }
  return prompts;
}

/** Operations for one answer, with the model's confidence as origin. */
export type DecisionStep = {
  block: string;
  kind: DecisionKind;
  /** Chosen option id. */
  choice: string;
  ops: ImportOp[];
  origin: ImportOrigin;
};

function slugId(label: string): string | null {
  const id = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return isValidSpeakerId(id) ? id : null;
}

/**
 * The step for one answer, against the draft as it is now. Null when the
 * answer changes nothing or the block went away. Blocks someone else has
 * decided since the reader (human, agent, memory) keep their decision.
 */
export function decisionStep(
  draft: ImportDraft,
  batch: DecisionBatch,
  item: DecisionItem,
  answer: DecisionAnswer,
): DecisionStep | null {
  const block = draft.blocks.find((b) => b.id === item.block);
  if (!block) return null;
  let best = 0;
  for (let i = 1; i < answer.length; i++) if (answer[i]! > answer[best]!) best = i;
  const choice = batch.options[best]?.id;
  if (!choice) return null;
  const origin: ImportOrigin = { by: "model", confidence: Math.round(answer[best]! * 100) / 100 };
  const step = (ops: ImportOp[]): DecisionStep | null =>
    ops.length > 0 ? { block: block.id, kind: batch.kind, choice, ops, origin } : null;
  const decidedBySomeoneElse = (o: ImportOrigin | undefined) =>
    o !== undefined && o.by !== "reader" && o.by !== "model";
  const v = batch.variant;

  if (batch.kind === "role") {
    if (decidedBySomeoneElse(block.origin.kind)) return null;
    if (choice === "exclude") {
      const segs = (block.content[v] ?? []).flatMap((s) => ("seg" in s ? [s.seg] : []));
      return step(segs.length > 0 ? [{ op: "setExcluded", segments: [...new Set(segs)], excluded: true }] : []);
    }
    return step([{ op: "setKind", target: { block: block.id }, kind: choice }]);
  }

  if (batch.kind === "pair") {
    const other = draft.variants[1]?.key;
    if (choice !== "different" || !other || !block.content[other]) return null;
    return step([{ op: "unpairVariant", block: block.id, variant: other }]);
  }

  // prefix: the text must still start with the label.
  const p = item.prefix;
  if (!p || !draftBlockPlainText(draft, block, v).startsWith(`${p.label}:`)) return null;
  if (choice === "text") return null;
  if (choice === "heading") {
    if (decidedBySomeoneElse(block.origin.kind)) return null;
    const lower = `b${draft.nextBlock}`;
    // "Troparion im 4. Ton: Dein Märtyrer…" → heading without the colon, then verse.
    return step([
      { op: "removeText", block: block.id, variant: v, start: p.end - 1, end: p.next },
      { op: "split", block: block.id, variant: v, at: p.end - 1 },
      { op: "setKind", target: { block: block.id }, kind: "heading" },
      { op: "setKind", target: { block: lower }, kind: "verse" },
    ]);
  }
  if (choice === "note") {
    return step([
      ...(block.kind === "verse" ? [] : [{ op: "setKind" as const, target: { block: block.id }, kind: "verse" }]),
      { op: "setNote", block: block.id, variant: v, start: 0, end: p.end, note: true },
    ]);
  }
  // "speaker" (a known label) or the follow-up's choice of speaker.
  if (decidedBySomeoneElse(block.origin.speaker)) return null;
  const id =
    batch.kind === "prefix"
      ? speakerForLabel(p.label)
      : choice === "other"
        ? slugId(p.label)
        : choice;
  if (!id) return null;
  const variant = draft.variants.find((x) => x.key === v)!;
  const speakers = variant.speakers?.[id] ? variant.speakers : { ...variant.speakers, [id]: { name: p.label } };
  return step([
    ...(block.kind === "verse" ? [] : [{ op: "setKind" as const, target: { block: block.id }, kind: "verse" }]),
    { op: "removeText", block: block.id, variant: v, start: 0, end: p.next },
    { op: "setSpeaker", block: block.id, speaker: id },
    ...(speakers === variant.speakers ? [] : [{ op: "setVariantMeta" as const, variant: v, patch: { speakers } }]),
  ]);
}

/** A block's model decisions below {@link UNCERTAIN_BELOW}, for "uncertain first". */
export function uncertainDecisions(
  block: DraftBlock,
): Array<{ what: "kind" | "speaker"; confidence: number }> {
  const out: Array<{ what: "kind" | "speaker"; confidence: number }> = [];
  for (const what of ["kind", "speaker"] as const) {
    const o = block.origin[what];
    if (o?.by === "model" && o.confidence !== undefined && o.confidence < UNCERTAIN_BELOW) {
      out.push({ what, confidence: o.confidence });
    }
  }
  return out;
}
