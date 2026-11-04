/**
 * Library memory (`.orthodox-prayer-toolkit/memory.json`): the user's
 * corrections of the Built-in model's decisions, kept as examples, and
 * plain-text hints. Same origin + same look as an example is a fixed rule
 * before the model runs; similar examples and all hints go into the
 * Decisions as context. External agents read the hints through a Tool.
 */
import {
  draftBlockPlainText,
  draftBlockSegments,
  draftBlockVisible,
  type DraftBlock,
  type ImportDraft,
  type ImportOp,
  type ImportOrigin,
} from "./importDraft.js";
import type { DraftChange } from "./importChanges.js";
import { describeLook, type DecisionBatch } from "./importDecisions.js";
import type { SegmentLook, Source, SourceSegment } from "./importSource.js";
import { speakerDisplayLabel } from "./speakers.js";
import { isKindPreset, kindDisplayLabel, type KindDef, type ValidationError } from "./types.js";
import { isValidKindId } from "./validateStyles.js";

export const MEMORY_FORMAT_VERSION = 1;

/** A rule in plain words, read before every Decision. */
export type MemoryHint = {
  id: string;
  text: string;
  /** Typed by the user, or a suggestion they accepted. */
  from: "user" | "suggestion";
  /** Suggestion key it came from (see {@link hintSuggestions}). */
  key?: string;
  /** ISO date. */
  added: string;
};

/**
 * One correction of the model's role decision: what the paragraph said and
 * looked like, where it came from, the model's answer and the user's.
 * Answers are kind ids or `exclude` (not part of the prayer).
 */
export type MemoryExample = {
  id: string;
  /** The paragraph, one line, at most 240 characters. */
  text: string;
  look: SegmentLook;
  /** Site or file the Source came from ({@link sourceOrigin}); "" when unknown. */
  origin: string;
  wrong: string;
  right: string;
  /** The custom kind `right` names, so a rule can declare it in a new draft. */
  declare?: KindDef;
  added: string;
};

export type LibraryMemory = {
  formatVersion: 1;
  hints: MemoryHint[];
  examples: MemoryExample[];
  /** Suggestion keys the user turned down. */
  dismissed: string[];
};

/** At most this many examples are kept (the oldest go first). */
export const MEMORY_MAX_EXAMPLES = 500;

export const EXCLUDE = "exclude";

export function emptyMemory(): LibraryMemory {
  return { formatVersion: 1, hints: [], examples: [], dismissed: [] };
}

// --- File ---------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnswer(value: unknown): value is string {
  return typeof value === "string" && (value === EXCLUDE || isValidKindId(value));
}

function isLook(value: unknown): value is SegmentLook {
  return (
    isPlainObject(value) &&
    Object.values(value).every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
  );
}

/**
 * Best-effort parse of `memory.json`: keep valid hints and examples, collect
 * errors for the rest. A newer `formatVersion` keeps nothing (and the app
 * must not rewrite the file).
 */
export function sanitizeMemory(data: unknown): { memory: LibraryMemory; errors: ValidationError[] } {
  const memory = emptyMemory();
  if (!isPlainObject(data)) {
    return { memory, errors: [{ path: "/", message: "memory must be an object" }] };
  }
  if (data.formatVersion !== MEMORY_FORMAT_VERSION) {
    const message =
      typeof data.formatVersion === "number" && data.formatVersion > MEMORY_FORMAT_VERSION
        ? `memory.json is from a newer app (format ${data.formatVersion})`
        : "formatVersion must be 1";
    return { memory, errors: [{ path: "/formatVersion", message }] };
  }
  const errors: ValidationError[] = [];
  const ids = new Set<string>();
  const list = (key: string): unknown[] => {
    const value = data[key];
    if (value === undefined) return [];
    if (Array.isArray(value)) return value;
    errors.push({ path: `/${key}`, message: `${key} must be an array` });
    return [];
  };
  for (const [i, raw] of list("hints").entries()) {
    const at = `/hints/${i}`;
    if (
      !isPlainObject(raw) ||
      typeof raw.id !== "string" ||
      ids.has(raw.id) ||
      typeof raw.text !== "string" ||
      raw.text.trim() === "" ||
      (raw.from !== "user" && raw.from !== "suggestion") ||
      (raw.key !== undefined && typeof raw.key !== "string") ||
      typeof raw.added !== "string"
    ) {
      errors.push({ path: at, message: "invalid hint" });
      continue;
    }
    ids.add(raw.id);
    memory.hints.push({
      id: raw.id,
      text: raw.text,
      from: raw.from,
      ...(raw.key !== undefined ? { key: raw.key } : {}),
      added: raw.added,
    });
  }
  for (const [i, raw] of list("examples").entries()) {
    const at = `/examples/${i}`;
    const declare = isPlainObject(raw) ? raw.declare : undefined;
    const declareOk =
      declare === undefined ||
      (isPlainObject(declare) &&
        typeof declare.id === "string" &&
        isValidKindId(declare.id) &&
        !isKindPreset(declare.id) &&
        (declare.speaker === undefined || declare.speaker === true));
    if (
      !isPlainObject(raw) ||
      typeof raw.id !== "string" ||
      ids.has(raw.id) ||
      typeof raw.text !== "string" ||
      !isLook(raw.look) ||
      typeof raw.origin !== "string" ||
      !isAnswer(raw.wrong) ||
      !isAnswer(raw.right) ||
      !declareOk ||
      typeof raw.added !== "string"
    ) {
      errors.push({ path: at, message: "invalid example" });
      continue;
    }
    ids.add(raw.id);
    const def = declare as KindDef | undefined;
    memory.examples.push({
      id: raw.id,
      text: raw.text,
      look: raw.look,
      origin: raw.origin,
      wrong: raw.wrong,
      right: raw.right,
      ...(def ? { declare: def.speaker ? { id: def.id, speaker: true } : { id: def.id } } : {}),
      added: raw.added,
    });
  }
  for (const [i, raw] of list("dismissed").entries()) {
    if (typeof raw === "string") memory.dismissed.push(raw);
    else errors.push({ path: `/dismissed/${i}`, message: "dismissed entries must be strings" });
  }
  return { memory, errors };
}

/** `memory.json` text as the app writes it. */
export function memoryFileText(memory: LibraryMemory): string {
  return `${JSON.stringify(memory, null, 2)}\n`;
}

// --- Editing ------------------------------------------------------------

function nextId(memory: LibraryMemory, prefix: "h" | "e"): string {
  let max = 0;
  for (const entry of [...memory.hints, ...memory.examples]) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(entry.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function addMemoryHint(
  memory: LibraryMemory,
  hint: { text: string; from: MemoryHint["from"]; key?: string },
  now: string,
): LibraryMemory {
  const text = hint.text.trim();
  if (!text || memory.hints.some((h) => h.text === text)) return memory;
  const added: MemoryHint = {
    id: nextId(memory, "h"),
    text,
    from: hint.from,
    ...(hint.key ? { key: hint.key } : {}),
    added: now,
  };
  return { ...memory, hints: [...memory.hints, added] };
}

/** Remove a hint or an example by id. */
export function removeMemoryEntry(memory: LibraryMemory, id: string): LibraryMemory {
  return {
    ...memory,
    hints: memory.hints.filter((h) => h.id !== id),
    examples: memory.examples.filter((e) => e.id !== id),
  };
}

export function dismissMemorySuggestion(memory: LibraryMemory, key: string): LibraryMemory {
  return memory.dismissed.includes(key) ? memory : { ...memory, dismissed: [...memory.dismissed, key] };
}

// --- Where a paragraph comes from ---------------------------------------

const FILE_EXT = /\.(html?|pdf|docx?|txt|rtf|odt|png|jpe?g|tiff?|heic|webp)$/i;
const HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

/**
 * The site or file a Source came from: the host of a web page
 * ("orthodoxe-gebete.de"), else a file name; `fallback` (the Variant's
 * `source`) when the Source has a generic name like "Pasted text".
 */
export function sourceOrigin(source: Pick<Source, "name">, fallback = ""): string {
  const fromName = (name: string): string => {
    const trimmed = name.trim();
    const host = trimmed.split("/")[0]!.replace(/^www\./i, "").toLowerCase();
    if (trimmed.includes("/") && HOST.test(host)) return host;
    if (FILE_EXT.test(trimmed)) return trimmed;
    if (HOST.test(host)) return host;
    return "";
  };
  return fromName(source.name) || fromName(fallback);
}

type Located = { segment: SourceSegment; origin: string };

function locate(draft: ImportDraft, block: DraftBlock): Located | null {
  const fallback = draft.variants[0]?.source ?? "";
  for (const id of draftBlockSegments(block)) {
    for (const source of draft.sources) {
      const segment = source.segments.find((s) => s.id === id);
      if (segment) return { segment, origin: sourceOrigin(source, fallback) };
    }
  }
  return null;
}

function oneLine(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function rgbOf(value: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(value.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function colorName(value: string): string | null {
  const c = rgbOf(value);
  if (!c) return value;
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 24) return max < 70 ? null : max > 235 ? "white" : "grey";
  if (r === max) return g > 150 && b < 120 ? "orange" : "red";
  if (g === max) return "green";
  return "blue";
}

/**
 * What stands out in a look, for people: "grey, italic", "bold, heading 2",
 * "small". Leaves out what every paragraph has (normal weight, black, …).
 */
export function lookSummary(look: SegmentLook): string {
  const parts: string[] = [];
  const color = typeof look.color === "string" ? colorName(look.color) : null;
  if (color) parts.push(color);
  const weight = look.weight;
  if (look.bold === true || weight === "bold" || (typeof weight === "number" && weight >= 600) || (typeof weight === "string" && Number(weight) >= 600)) {
    parts.push("bold");
  }
  if (look.italic === true || look.style === "italic") parts.push("italic");
  const tag = typeof look.tag === "string" ? /^h([1-6])$/i.exec(look.tag) : null;
  if (tag) parts.push(`heading ${tag[1]}`);
  else if (typeof look.style === "string" && look.style !== "italic" && look.style !== "normal") parts.push(look.style);
  const size = typeof look.size === "number" ? look.size : parseFloat(String(look.size ?? ""));
  if (Number.isFinite(size) && size > 0 && size < (typeof look.size === "number" ? 10 : 13)) parts.push("small");
  if (look.align === "center") parts.push("centered");
  return parts.join(", ");
}

/** Appearance as a stable key: "column" and empty values left out. */
export function lookKey(look: SegmentLook): string {
  return Object.keys(look)
    .filter((k) => k !== "column" && look[k] !== false && look[k] !== "")
    .sort()
    .map((k) => `${k}=${String(look[k])}`)
    .join(";");
}

/**
 * What makes an example a fixed rule: the same origin, and the same look
 * (or, for text without a look, the same words). Null without an origin.
 */
function ruleKey(origin: string, look: SegmentLook, text: string): string | null {
  if (!origin) return null;
  const key = lookKey(look);
  return key ? `${origin}\0look\0${key}` : `${origin}\0text\0${text.toLowerCase()}`;
}

function exampleKey(e: Pick<MemoryExample, "origin" | "look" | "text">): string | null {
  return ruleKey(e.origin, e.look, e.text);
}

// --- Corrections ----------------------------------------------------------

/** A correction seen in the open Import draft, before it is saved. */
export type MemoryCorrection = Omit<MemoryExample, "id" | "added"> & { block: string };

/** Decided by the model, the memory or one of the reader's fixed rules (those carry a confidence). */
const byMachine = (o: ImportOrigin | undefined) =>
  o?.by === "model" || o?.by === "memory" || (o?.by === "reader" && o.confidence !== undefined);

function hiddenByMachine(draft: ImportDraft, block: DraftBlock): boolean {
  const segs = draftBlockSegments(block);
  return segs.length > 0 && segs.every((id) => draft.excludedBy?.[id] !== undefined);
}

/**
 * The user's corrections of model (or memory) decisions between two states
 * of a draft: a changed kind, an exclusion, or including again what the
 * model left out. Call it for the user's own edits only.
 */
export function draftCorrections(before: ImportDraft, after: ImportDraft): MemoryCorrection[] {
  const old = new Map(before.blocks.map((b) => [b.id, b]));
  const out: MemoryCorrection[] = [];
  for (const block of after.blocks) {
    const prev = old.get(block.id);
    if (!prev) continue;
    const wasVisible = draftBlockVisible(before, prev);
    const visible = draftBlockVisible(after, block);
    let wrong: string | null = null;
    let right: string | null = null;
    if (wasVisible && !visible && byMachine(prev.origin.kind)) {
      [wrong, right] = [prev.kind, EXCLUDE];
    } else if (!wasVisible && visible && hiddenByMachine(before, prev)) {
      [wrong, right] = [EXCLUDE, block.kind];
    } else if (wasVisible && visible && prev.kind !== block.kind && byMachine(prev.origin.kind)) {
      [wrong, right] = [prev.kind, block.kind];
    }
    if (wrong === null || right === null) continue;
    const at = locate(after, block);
    if (!at) continue;
    const declare = right !== EXCLUDE && !isKindPreset(right) ? after.kinds.find((k) => k.id === right) : undefined;
    out.push({
      block: block.id,
      text: oneLine(at.segment.text),
      look: at.segment.look,
      origin: at.origin,
      wrong,
      right,
      ...(declare ? { declare } : {}),
    });
  }
  return out;
}

/**
 * Add new corrections to those collected for the open draft: a block
 * corrected again keeps the model's first answer; back to that answer
 * drops the correction.
 */
export function mergeCorrections(
  pending: readonly MemoryCorrection[],
  next: readonly MemoryCorrection[],
): MemoryCorrection[] {
  const byBlock = new Map(pending.map((c) => [c.block, c]));
  for (const c of next) {
    const prev = byBlock.get(c.block);
    const merged = prev ? { ...c, wrong: prev.wrong } : c;
    if (merged.wrong === merged.right) byBlock.delete(c.block);
    else byBlock.set(c.block, merged);
  }
  return [...byBlock.values()];
}

function stillHolds(draft: ImportDraft, c: MemoryCorrection): boolean {
  const block = draft.blocks.find((b) => b.id === c.block);
  if (!block) return false;
  const visible = draftBlockVisible(draft, block);
  return c.right === EXCLUDE ? !visible : visible && block.kind === c.right;
}

/**
 * When the draft is saved: keep the corrections that still hold as
 * examples. A newer example with the same rule key replaces the older one.
 */
export function learnCorrections(
  memory: LibraryMemory,
  draft: ImportDraft,
  pending: readonly MemoryCorrection[],
  now: string,
): LibraryMemory {
  const keep = pending.filter((c) => stillHolds(draft, c));
  if (keep.length === 0) return memory;
  let next = memory;
  for (const { block: _b, ...c } of keep) {
    const key = exampleKey(c);
    const examples = next.examples.filter((e) =>
      key ? exampleKey(e) !== key : e.text !== c.text || e.origin !== c.origin,
    );
    examples.push({ id: nextId(next, "e"), ...c, added: now });
    next = { ...next, examples };
  }
  return next.examples.length > MEMORY_MAX_EXAMPLES
    ? { ...next, examples: next.examples.slice(-MEMORY_MAX_EXAMPLES) }
    : next;
}

// --- Rules and context ----------------------------------------------------

export const MEMORY_ORIGIN: ImportOrigin = { by: "memory" };

/** Operations a fixed rule applies to one block. */
export type MemoryRuleStep = { block: string; example: MemoryExample; ops: ImportOp[] };

/**
 * Fixed rules for a fresh draft: blocks whose origin and look match an
 * example get the user's answer (origin "memory") before the model runs.
 * Blocks the user or an agent decided keep their decision.
 */
export function memoryRuleSteps(draft: ImportDraft, memory: LibraryMemory): MemoryRuleStep[] {
  const rules = new Map<string, MemoryExample>();
  for (const e of memory.examples) {
    const key = exampleKey(e);
    if (key) rules.set(key, e);
  }
  if (rules.size === 0) return [];
  const steps: MemoryRuleStep[] = [];
  const declared = new Set(draft.kinds.map((k) => k.id));
  for (const block of draft.blocks) {
    const by = block.origin.kind.by;
    if (by !== "reader" && by !== "model") continue;
    const at = locate(draft, block);
    if (!at) continue;
    const key = ruleKey(at.origin, at.segment.look, oneLine(at.segment.text));
    const example = key ? rules.get(key) : undefined;
    if (!example) continue;
    const segs = [...new Set(draftBlockSegments(block))];
    const visible = draftBlockVisible(draft, block);
    const ops: ImportOp[] = [];
    if (example.right === EXCLUDE) {
      if (visible) ops.push({ op: "setExcluded", segments: segs, excluded: true });
    } else {
      const kind = example.right;
      if (!isKindPreset(kind) && !declared.has(kind)) {
        if (!example.declare) continue;
        ops.push({ op: "declareKind", kind: example.declare });
        declared.add(kind);
      }
      if (!visible) ops.push({ op: "setExcluded", segments: segs, excluded: false });
      ops.push({ op: "setKind", target: { block: block.id }, kind });
    }
    if (ops.length > 0) steps.push({ block: block.id, example, ops });
  }
  return steps;
}

/** The origin of the draft's main Source (for choosing similar examples). */
export function draftOrigin(draft: ImportDraft): string {
  const source = draft.sources[0];
  return source ? sourceOrigin(source, draft.variants[0]?.source ?? "") : "";
}

/**
 * A Decision with the memory as context: every hint, and for role questions
 * up to `max` examples (same origin first, then the newest) whose answer is
 * one of the options. Returns `batch` when there is nothing to add.
 */
export function withMemory(
  batch: DecisionBatch,
  memory: LibraryMemory,
  origin: string,
  max = 6,
): DecisionBatch {
  const hints = memory.hints.map((h) => h.text);
  let examples = batch.examples;
  if (batch.kind === "role") {
    const options = new Set(batch.options.map((o) => o.id));
    // The examples most like the paragraphs asked about (shared words, same look), same site first.
    const words = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}\d]+/u).filter((w) => w.length > 3));
    const asked = batch.items.map((it) => words(it.text));
    const overlap = (t: string) => {
      const w = words(t);
      let best = 0;
      for (const a of asked) {
        let n = 0;
        for (const x of w) if (a.has(x)) n += 1;
        best = Math.max(best, w.size > 0 ? n / w.size : 0);
      }
      return best;
    };
    const picked = memory.examples
      .map((e, i) => ({ e, score: (e.origin === origin && origin ? 1000 : 0) + overlap(e.text) * 100 + i / 1000 }))
      .filter(({ e }) => options.has(e.right))
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map(({ e }): [string, string] => {
        const look = describeLook(e.look);
        return [look ? `(${look}) ${e.text}` : e.text, e.right];
      });
    if (picked.length > 0) examples = [...(batch.examples ?? []), ...picked];
  }
  if (hints.length === 0 && examples === batch.examples) return batch;
  return { ...batch, examples, ...(hints.length > 0 ? { hints } : {}) };
}

// --- Suggestions ----------------------------------------------------------

/** How an answer reads in a hint: "annotations", "not part of the prayer". */
export function answerLabel(answer: string): string {
  return answer === EXCLUDE ? "not part of the prayer" : kindDisplayLabel(answer);
}

function quote(text: string, max = 40): string {
  // Single quotes: the hint itself is shown in double quotes.
  return `‘${oneLine(text, max)}’`;
}

export type MemorySuggestion = { key: string; text: string; count: number };

/** Corrections of the same kind this often make a hint suggestion. */
export const SUGGEST_AFTER = 3;

/**
 * Hint suggestions from repeated corrections (the same wrong → right at
 * least {@link SUGGEST_AFTER} times), unless dismissed or already a hint.
 */
export function hintSuggestions(memory: LibraryMemory): MemorySuggestion[] {
  const groups = new Map<string, MemoryExample[]>();
  for (const e of memory.examples) {
    const key = `role:${e.wrong}>${e.right}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const taken = new Set([...memory.dismissed, ...memory.hints.flatMap((h) => (h.key ? [h.key] : []))]);
  const out: MemorySuggestion[] = [];
  for (const [key, list] of groups) {
    const texts = [...new Set(list.map((e) => e.text))];
    if (texts.length < SUGGEST_AFTER || taken.has(key)) continue;
    const { wrong, right } = list[0]!;
    const not = wrong === EXCLUDE ? "left out" : answerLabel(wrong);
    out.push({
      key,
      text: `Lines like ${quote(texts[texts.length - 1]!)} and ${quote(texts[texts.length - 2]!)} are ${answerLabel(right)}, not ${not}.`,
      count: list.length,
    });
  }
  return out;
}

/**
 * A hint suggestion for one Chat pane answer in an Import draft, from what
 * it changed: a "Label:" prefix made the speaker, lines left out, or lines
 * given one kind. Null when the answer suggests no rule.
 */
export function hintForChanges(
  before: ImportDraft,
  changes: readonly DraftChange[],
): MemorySuggestion | null {
  const main = before.variants[0]?.key;
  if (!main) return null;
  const text = (block: string) => {
    const b = before.blocks.find((x) => x.id === block);
    return b ? draftBlockPlainText(before, b, main) : "";
  };
  for (const c of changes) {
    if (c.what !== "speaker" || !c.to) continue;
    const label = /^([^:\n]{1,40}):\s/u.exec(text(c.block))?.[1];
    if (label) {
      return {
        key: `chat:prefix:${c.to}`,
        text: `A prefix like ‘${label}:’ names the speaker (${speakerDisplayLabel(c.to)}).`,
        count: 1,
      };
    }
  }
  const excluded = changes.filter((c) => c.what === "excluded");
  if (excluded.length > 0) {
    return {
      key: "chat:exclude",
      text: `Lines like ${quote(text(excluded[0]!.block))} are not part of the prayer.`,
      count: excluded.length,
    };
  }
  const kinds = changes.flatMap((c) => (c.what === "kind" ? [c] : []));
  if (kinds.length > 0 && kinds.every((c) => c.to === kinds[0]!.to)) {
    return {
      key: `chat:kind:${kinds[0]!.to}`,
      text: `Lines like ${quote(text(kinds[0]!.block))} are ${answerLabel(kinds[0]!.to)}.`,
      count: kinds.length,
    };
  }
  return null;
}
