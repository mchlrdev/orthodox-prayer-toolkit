/**
 * Import draft: a provisional Prayer built from Sources. Its blocks hold
 * spans into Source segments instead of text, so nothing is retyped. All
 * changes go through Import operations ({@link applyImportOp}), which are
 * pure: `(draft, op) → draft`.
 */
import { normalizeFormatVersion } from "./formatVersion.js";
import {
  buildPieces,
  hasVisibleText,
  mapRange,
  pieceWidth,
  piecesContent,
  piecesPlain,
  piecesToSpans,
  spanSegments,
  spansHaveTypedText,
  splitPieces,
  type ContentContext,
  type DraftSpan,
  type Piece,
} from "./importContent.js";
import type { Source, SourceSegment, UncertainRange } from "./importSource.js";
import { kindAllowsSpeaker } from "./kinds.js";
import { isValidSpeakerId } from "./speakers.js";
import { isRunArray, toRuns, type InlineContent } from "./textRuns.js";
import {
  isKindPreset,
  type Block,
  type KindDef,
  type Prayer,
  type SpeakerLabel,
  type Translation,
  type ValidationResult,
} from "./types.js";
import { validate } from "./validate.js";
import { isValidKindId } from "./validateStyles.js";

export type { DraftSpan } from "./importContent.js";

/** Who made a decision in the draft. */
export type ImportActor = "reader" | "model" | "human" | "agent" | "memory";

export type ImportOrigin = {
  by: ImportActor;
  /** Probability of the chosen answer (0–1), for model decisions. */
  confidence?: number;
};

export type DraftVariant = {
  /** Stable key used by block content; survives lang/variant renames. */
  key: string;
  lang: string;
  variant: string;
  title: string;
  license: string;
  source: string;
  rtl?: true;
  speakers?: Record<string, SpeakerLabel>;
};

export type DraftBlock = {
  id: string;
  kind: string;
  speaker?: string;
  /** Spans per Variant key. A missing key = no translation in that Variant. */
  content: Record<string, DraftSpan[]>;
  origin: { kind: ImportOrigin; speaker?: ImportOrigin };
};

export type DraftPrayerMeta = {
  id: string;
  type: string;
  book?: string;
  occasion?: string;
  tone?: number | null;
  description?: string;
};

export type ImportDraft = {
  sources: Source[];
  meta: DraftPrayerMeta;
  variants: DraftVariant[];
  /** Custom kinds declared for the Prayer. */
  kinds: KindDef[];
  blocks: DraftBlock[];
  /** Excluded Source segment ids: their text is hidden, not removed. */
  excluded: string[];
  /**
   * Who excluded a segment, for the Built-in model and Library memory only
   * (the user, an agent and the Reader are not listed). Lets a later
   * "include" count as a correction of the model.
   */
  excludedBy?: Record<string, "model" | "memory">;
  /** Counter for new block ids (`b{n}`). */
  nextBlock: number;
};

export type CreateImportDraftOptions = {
  sources: Source[];
  variant: { lang: string; variant: string } & Partial<
    Pick<DraftVariant, "title" | "license" | "source" | "rtl">
  >;
  meta?: Partial<DraftPrayerMeta>;
};

/**
 * Draft with one Verse block per Source segment in a single Variant — the
 * Reader's result, valid without any model.
 */
export function createImportDraft(options: CreateImportDraftOptions): ImportDraft {
  const ids = new Set<string>();
  for (const source of options.sources) {
    for (const segment of source.segments) {
      if (ids.has(segment.id)) {
        throw new Error(`Duplicate source segment id "${segment.id}"`);
      }
      ids.add(segment.id);
    }
  }
  const { lang, variant, title = "", license = "", source = "", rtl } = options.variant;
  const segments = options.sources.flatMap((s) => s.segments);
  const blocks: DraftBlock[] = segments.map((segment, i) => ({
    id: `b${i + 1}`,
    kind: "verse",
    content: { v1: segmentSpans(segment) },
    origin: { kind: { by: "reader" } },
  }));
  return {
    sources: options.sources,
    meta: { id: "", type: "prayer", ...options.meta },
    variants: [
      { key: "v1", lang, variant, title, license, source, ...(rtl ? { rtl } : {}) },
    ],
    kinds: [],
    blocks,
    excluded: segments.filter((s) => s.furniture).map((s) => s.id),
    nextBlock: blocks.length + 1,
  };
}

/** Whole segment, minus the ranges the Reader marked to drop (joined up). */
function segmentSpans(segment: SourceSegment): DraftSpan[] {
  const drops = [...(segment.drop ?? [])]
    .filter((d) => d.start < d.end && d.start >= 0 && d.end <= segment.text.length)
    .sort((a, b) => a.start - b.start);
  const spans: DraftSpan[] = [];
  let at = 0;
  for (const d of drops) {
    if (d.start > at) {
      spans.push(
        spans.length > 0
          ? { seg: segment.id, start: at, end: d.start, join: true }
          : { seg: segment.id, start: at, end: d.start },
      );
    }
    at = Math.max(at, d.end);
  }
  if (at < segment.text.length || spans.length === 0) {
    spans.push(
      spans.length > 0
        ? { seg: segment.id, start: at, end: segment.text.length, join: true }
        : { seg: segment.id, start: at, end: segment.text.length },
    );
  }
  return spans;
}

// Drafts are immutable and per-block helpers ask for the context once per
// block, so building the segment index each time made them O(blocks ×
// segments). Keyed by the sources / excluded arrays themselves.
const contextCache = new WeakMap<
  Source[],
  { excluded: string[]; ctx: ContentContext }
>();

function contextOf(draft: ImportDraft): ContentContext {
  const hit = contextCache.get(draft.sources);
  if (hit && hit.excluded === draft.excluded) return hit.ctx;
  const segments = new Map<string, SourceSegment>();
  for (const source of draft.sources) {
    for (const segment of source.segments) segments.set(segment.id, segment);
  }
  const ctx: ContentContext = {
    segment: (id) => segments.get(id),
    excluded: new Set(draft.excluded),
  };
  contextCache.set(draft.sources, { excluded: draft.excluded, ctx });
  return ctx;
}

function lineMode(kind: string): boolean {
  return kind === "verse";
}

/** Translation payload of a block in one Variant; null when nothing is visible. */
export function draftBlockContent(
  draft: ImportDraft,
  block: DraftBlock,
  variantKey: string,
): { text: InlineContent } | { lines: InlineContent[] } | null {
  const spans = block.content[variantKey];
  if (!spans) return null;
  return piecesContent(buildPieces(spans, contextOf(draft)), lineMode(block.kind));
}

/** Plain text of a block in one Variant, with the offsets Import operations use. */
export function draftBlockPlainText(
  draft: ImportDraft,
  block: DraftBlock,
  variantKey: string,
): string {
  const spans = block.content[variantKey];
  if (!spans) return "";
  return piecesPlain(buildPieces(spans, contextOf(draft)), lineMode(block.kind));
}

/** A word of a block's plain text that text recognition read with low confidence. */
export type DraftUncertainWord = { start: number; end: number; segment: string; confidence?: number };

/**
 * Words in {@link draftBlockPlainText} that come from `uncertain` ranges of
 * their Source segments (scans), in plain-text offsets. Typed text is never
 * uncertain.
 */
export function draftUncertainWords(
  draft: ImportDraft,
  block: DraftBlock,
  variantKey: string,
): DraftUncertainWord[] {
  const spans = block.content[variantKey];
  if (!spans) return [];
  const ctx = contextOf(draft);
  // Per uncertain range: where its characters landed in the plain text.
  const found = new Map<UncertainRange, { segment: string; at: number[]; length: number }>();
  let at = 0;
  for (const p of buildPieces(spans, ctx)) {
    if (p.t === "sep") at += 1;
    if (p.t !== "ch") continue;
    const range =
      p.seg !== undefined && p.off !== undefined
        ? ctx.segment(p.seg)?.uncertain?.find((r) => p.off! >= r.start && p.off! < r.end)
        : undefined;
    if (range) {
      const entry = found.get(range) ?? { segment: p.seg!, at: [], length: 0 };
      entry.at.push(at);
      entry.length += p.ch.length;
      found.set(range, entry);
    }
    at += p.ch.length;
  }
  const out: DraftUncertainWord[] = [];
  for (const [range, { segment, at: positions, length }] of found) {
    // A word the user typed into (or cut) is theirs now.
    const start = positions[0]!;
    if (length !== range.end - range.start || positions.at(-1)! + 1 - start > length) continue;
    out.push({
      start,
      end: start + length,
      segment,
      ...(range.confidence !== undefined ? { confidence: range.confidence } : {}),
    });
  }
  return out.sort((x, y) => x.start - y.start);
}

/** Source segment ids a block points into, across Variants. */
export function draftBlockSegments(block: DraftBlock): string[] {
  const ids: string[] = [];
  for (const spans of Object.values(block.content)) {
    for (const id of spanSegments(spans)) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** True when a block shows typed text (not from a Source) in a Variant. */
export function draftBlockHasTypedText(block: DraftBlock, variantKey: string): boolean {
  return spansHaveTypedText(block.content[variantKey] ?? []);
}

function isVisible(ctx: ContentContext, block: DraftBlock): boolean {
  return Object.values(block.content).some((spans) => hasVisibleText(buildPieces(spans, ctx)));
}

/** True when the block shows text in some Variant (it is part of the Prayer). */
export function draftBlockVisible(draft: ImportDraft, block: DraftBlock): boolean {
  return isVisible(contextOf(draft), block);
}

function groupOf(ctx: ContentContext, block: DraftBlock): string | undefined {
  for (const id of draftBlockSegments(block)) {
    if (ctx.excluded.has(id)) continue;
    return ctx.segment(id)?.group;
  }
  return undefined;
}

/** Style group of the block's first visible segment, if any. */
export function draftBlockGroup(draft: ImportDraft, block: DraftBlock): string | undefined {
  return groupOf(contextOf(draft), block);
}

/** Visible blocks whose style group is `group` — what a group `setKind` changes. */
export function draftBlocksInGroup(draft: ImportDraft, group: string): DraftBlock[] {
  const ctx = contextOf(draft);
  return draft.blocks.filter((b) => isVisible(ctx, b) && groupOf(ctx, b) === group);
}

/**
 * Text column of a segment, 0-based: a PDF column (`area.column`) or a
 * table column (`look.column`, 1-based from the Reader). Undefined when the
 * Source has no columns.
 */
export function segmentColumn(segment: SourceSegment): number | undefined {
  if (segment.area?.column !== undefined) return segment.area.column;
  const col = segment.look.column;
  return typeof col === "number" && col >= 1 ? col - 1 : undefined;
}

/** Blocks whose text in `variantKey` comes only from segments in `column`. */
export function draftBlocksInColumn(
  draft: ImportDraft,
  column: number,
  variantKey: string,
): DraftBlock[] {
  const ctx = contextOf(draft);
  return draft.blocks.filter((b) => {
    const spans = b.content[variantKey]?.filter((s) => "seg" in s) ?? [];
    return (
      spans.length > 0 &&
      spans.every((s) => {
        const seg = "seg" in s ? ctx.segment(s.seg) : undefined;
        return seg !== undefined && segmentColumn(seg) === column;
      })
    );
  });
}

/** One draft block as a Prayer Block; null when it has no visible text. */
function draftBlockToBlock(
  draft: ImportDraft,
  ctx: ContentContext,
  block: DraftBlock,
): Block | null {
  const translations: Translation[] = [];
  for (const v of draft.variants) {
    const spans = block.content[v.key];
    if (!spans) continue;
    const payload = piecesContent(buildPieces(spans, ctx), lineMode(block.kind));
    if (payload) translations.push({ lang: v.lang, variant: v.variant, ...payload });
  }
  if (translations.length === 0) return null;
  const speaker =
    block.speaker !== undefined && kindAllowsSpeaker(block.kind, draft)
      ? { speaker: block.speaker }
      : {};
  return { id: block.id, kind: block.kind, ...speaker, translations };
}

function assemblePrayer(draft: ImportDraft, structure: Block[]): Prayer {
  const { id, type, book, occasion, tone, description } = draft.meta;
  const prayer: Prayer = {
    id,
    type,
    ...(book ? { book } : {}),
    ...(occasion ? { occasion } : {}),
    ...(tone !== undefined ? { tone } : {}),
    ...(description ? { description } : {}),
    variants: draft.variants.map(({ key: _key, ...v }) => v),
    ...(draft.kinds.length > 0 ? { kinds: draft.kinds.map((k) => ({ ...k })) } : {}),
    structure,
  };
  return normalizeFormatVersion(prayer);
}

/**
 * The Prayer the draft stands for. Blocks with no visible text are left out;
 * missing translations are omitted. Run it through `validate()` before saving.
 */
export function importDraftToPrayer(draft: ImportDraft): Prayer {
  const ctx = contextOf(draft);
  const structure: Block[] = [];
  for (const block of draft.blocks) {
    const converted = draftBlockToBlock(draft, ctx, block);
    if (converted) structure.push(converted);
  }
  return assemblePrayer(draft, structure);
}

/**
 * `importDraftToPrayer` for a draft that changes one op at a time: draft
 * blocks the op left alone (same object) give the same Block object as last
 * time, so an editor can skip re-rendering them. The cache resets when the
 * sources, exclusions, variants or kinds change. Output equals
 * `importDraftToPrayer(draft)`.
 */
export function createImportPrayerBuilder(): (draft: ImportDraft) => Prayer {
  let keys: readonly unknown[] = [];
  let ctx: ContentContext | null = null;
  let cache = new WeakMap<DraftBlock, Block | null>();
  return (draft) => {
    const next = [draft.sources, draft.excluded, draft.variants, draft.kinds];
    if (!ctx || next.some((k, i) => k !== keys[i])) {
      keys = next;
      ctx = contextOf(draft);
      cache = new WeakMap();
    }
    const structure: Block[] = [];
    for (const block of draft.blocks) {
      let converted = cache.get(block);
      if (converted === undefined) {
        converted = draftBlockToBlock(draft, ctx, block);
        cache.set(block, converted);
      }
      if (converted) structure.push(converted);
    }
    return assemblePrayer(draft, structure);
  };
}

/** `validate()` of {@link importDraftToPrayer}. */
export function validateImportDraft(draft: ImportDraft): ValidationResult {
  return validate(importDraftToPrayer(draft));
}

// --- Import operations ----------------------------------------------------

type BlockRef = { block: string };
type TextRef = BlockRef & { variant: string };

export type ImportOp =
  | { op: "setKind"; target: BlockRef | { group: string }; kind: string }
  | { op: "split"; block: string; variant: string; at: number }
  | { op: "merge"; block: string; keep?: "upper" | "lower" }
  | { op: "deleteBlock"; block: string }
  | ({ op: "setNote"; start: number; end: number; note: boolean } & TextRef)
  | { op: "setSpeaker"; block: string; speaker: string | null }
  | ({ op: "removeText"; start: number; end: number } & TextRef)
  | ({ op: "setText"; content: InlineContent | InlineContent[] } & TextRef)
  | { op: "setExcluded"; segments: string[]; excluded: boolean }
  | { op: "pairVariant"; block: string; variant: string; from: string }
  | { op: "unpairVariant"; block: string; variant: string }
  | {
      op: "addVariant";
      variant: { lang: string; variant: string } & Partial<Omit<DraftVariant, "key" | "lang" | "variant">>;
    }
  | { op: "addSource"; source: Source; variant: string }
  | { op: "assignVariant"; blocks: string[]; from: string; to: string }
  | { op: "pairByOrder"; variant: string }
  | { op: "moveBlock"; block: string; to: number }
  | { op: "declareKind"; kind: KindDef }
  | { op: "setPrayerMeta"; patch: Partial<DraftPrayerMeta> }
  | {
      op: "setVariantMeta";
      variant: string;
      patch: Partial<Omit<DraftVariant, "key">>;
    };

export type ImportOpResult =
  | { ok: true; draft: ImportDraft }
  | { ok: false; error: string };

const HUMAN: ImportOrigin = { by: "human" };

class OpError extends Error {}

function fail(message: string): never {
  throw new OpError(message);
}

function blockIndex(draft: ImportDraft, id: string): number {
  const index = draft.blocks.findIndex((b) => b.id === id);
  if (index === -1) fail(`No block "${id}"`);
  return index;
}

function requireVariant(draft: ImportDraft, key: string): void {
  if (!draft.variants.some((v) => v.key === key)) fail(`No variant "${key}"`);
}

function kindIsAvailable(draft: ImportDraft, kind: string): boolean {
  return isKindPreset(kind) || draft.kinds.some((k) => k.id === kind);
}

/** Key the next `addVariant` gives (`v1`, `v2`, …). */
export function freeVariantKey(draft: ImportDraft): string {
  const taken = new Set(draft.variants.map((v) => v.key));
  let n = draft.variants.length + 1;
  while (taken.has(`v${n}`)) n += 1;
  return `v${n}`;
}

/** A Source id not used in the draft yet (`s1`, `s2`, …), for {@link ImportOp} addSource. */
export function freeSourceId(draft: ImportDraft): string {
  const taken = new Set(draft.sources.map((s) => s.id));
  let n = draft.sources.length + 1;
  while (taken.has(`s${n}`)) n += 1;
  return `s${n}`;
}

function withBlocks(draft: ImportDraft, blocks: DraftBlock[]): ImportDraft {
  return { ...draft, blocks };
}

function replaceBlock(draft: ImportDraft, index: number, block: DraftBlock): ImportDraft {
  const blocks = [...draft.blocks];
  blocks[index] = block;
  return withBlocks(draft, blocks);
}

function setBlockKind(block: DraftBlock, kind: string, draft: ImportDraft, origin: ImportOrigin): DraftBlock {
  const { speaker, origin: prev, ...rest } = block;
  const keepSpeaker = speaker !== undefined && kindAllowsSpeaker(kind, draft);
  return {
    ...rest,
    kind,
    ...(keepSpeaker ? { speaker } : {}),
    origin: { kind: origin, ...(keepSpeaker && prev.speaker ? { speaker: prev.speaker } : {}) },
  };
}

function editPieces(
  draft: ImportDraft,
  ref: TextRef,
  edit: (pieces: Piece[], lineMode: boolean) => Piece[],
  allowMissing = false,
): ImportDraft {
  const index = blockIndex(draft, ref.block);
  requireVariant(draft, ref.variant);
  const block = draft.blocks[index]!;
  const spans = block.content[ref.variant] ?? (allowMissing ? [] : undefined);
  if (!spans) fail(`Block "${ref.block}" has no text in variant "${ref.variant}"`);
  const ctx = contextOf(draft);
  const pieces = edit(buildPieces(spans, ctx), lineMode(block.kind));
  const content = { ...block.content };
  if (pieces.length === 0) delete content[ref.variant];
  else content[ref.variant] = piecesToSpans(pieces, ctx);
  return replaceBlock(draft, index, { ...block, content });
}

function checkRange(pieces: readonly Piece[], start: number, end: number): void {
  const length = pieces.reduce((n, p) => n + pieceWidth(p), 0);
  if (!(start >= 0 && end >= start && end <= length)) {
    fail(`Range ${start}–${end} is outside the text (length ${length})`);
  }
}

function inlineFlags(content: InlineContent | InlineContent[]): { plain: string; notes: boolean[] } {
  const lines =
    typeof content === "string" || isRunArray(content) ? [content] : content;
  let plain = "";
  const notes: boolean[] = [];
  for (const [i, line] of lines.entries()) {
    if (i > 0) {
      plain += "\n";
      notes.push(false);
    }
    for (const run of toRuns(line)) {
      plain += run.v;
      for (let k = 0; k < run.v.length; k++) notes.push(run.t === "note");
    }
  }
  return { plain, notes };
}

function setText(pieces: Piece[], lineMode: boolean, content: InlineContent | InlineContent[]): Piece[] {
  const { plain: next, notes } = inlineFlags(content);
  const prev = piecesPlain(pieces, lineMode);
  let head = 0;
  while (head < prev.length && head < next.length && prev[head] === next[head]) head += 1;
  let tail = 0;
  while (
    tail < prev.length - head &&
    tail < next.length - head &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail += 1;
  }

  const out: Piece[] = [];
  let pos = 0;
  let inserted = false;
  const insert = () => {
    if (inserted) return;
    inserted = true;
    for (const ch of next.slice(head, next.length - tail)) {
      out.push(ch === "\n" ? { t: "sep" } : { t: "ch", ch, note: false });
    }
  };
  for (const p of pieces) {
    const w = pieceWidth(p);
    if (pos >= head && w > 0) insert();
    if (w === 0 || pos < head || pos >= prev.length - tail) out.push(p);
    pos += w;
  }
  insert();

  let at = 0;
  return out.map((p) => {
    const w = pieceWidth(p);
    const note = notes[at] ?? false;
    at += w;
    return p.t === "ch" && p.note !== note ? { ...p, note } : p;
  });
}

function mergeSpans(upper: DraftSpan[] | undefined, lower: DraftSpan[] | undefined): DraftSpan[] | undefined {
  if (!upper) return lower;
  if (!lower) return upper;
  const [first, ...rest] = lower;
  if (!first) return upper;
  const { join: _join, brk: _brk, ...plain } = first;
  return [...upper, plain as DraftSpan, ...rest];
}

function applyOne(draft: ImportDraft, op: ImportOp, origin: ImportOrigin): ImportDraft {
  switch (op.op) {
    case "setKind": {
      if (!kindIsAvailable(draft, op.kind)) fail(`Kind "${op.kind}" is not declared`);
      if ("block" in op.target) {
        const index = blockIndex(draft, op.target.block);
        return replaceBlock(draft, index, setBlockKind(draft.blocks[index]!, op.kind, draft, origin));
      }
      const group = op.target.group;
      const ctx = contextOf(draft);
      let hit = false;
      const blocks = draft.blocks.map((b) => {
        if (groupOf(ctx, b) !== group) return b;
        hit = true;
        return setBlockKind(b, op.kind, draft, origin);
      });
      if (!hit) fail(`No block in style group "${group}"`);
      return withBlocks(draft, blocks);
    }

    case "split": {
      const index = blockIndex(draft, op.block);
      requireVariant(draft, op.variant);
      const block = draft.blocks[index]!;
      const spans = block.content[op.variant];
      if (!spans) fail(`Block "${op.block}" has no text in variant "${op.variant}"`);
      const ctx = contextOf(draft);
      const pieces = buildPieces(spans, ctx);
      checkRange(pieces, op.at, op.at);
      const { before, after } = splitPieces(pieces, op.at);
      if (!hasVisibleText(before) || !hasVisibleText(after)) {
        fail("Split position must have text on both sides");
      }
      const upper: DraftBlock = {
        ...block,
        content: { ...block.content, [op.variant]: piecesToSpans(before, ctx) },
      };
      const lower: DraftBlock = {
        id: `b${draft.nextBlock}`,
        kind: block.kind,
        content: { [op.variant]: piecesToSpans(after, ctx) },
        origin: { kind: block.origin.kind },
      };
      const blocks = [...draft.blocks];
      blocks.splice(index, 1, upper, lower);
      return { ...draft, blocks, nextBlock: draft.nextBlock + 1 };
    }

    case "merge": {
      // With the next block that shows text; hidden blocks in between stay
      // right after the merged one.
      const index = blockIndex(draft, op.block);
      const upper = draft.blocks[index]!;
      const ctx = contextOf(draft);
      let lowerIndex = index + 1;
      while (lowerIndex < draft.blocks.length && !isVisible(ctx, draft.blocks[lowerIndex]!)) {
        lowerIndex += 1;
      }
      const lower = draft.blocks[lowerIndex];
      if (!lower) fail(`Block "${op.block}" is the last block`);
      const keep = op.keep ?? "upper";
      const survivor = keep === "upper" ? upper : lower;
      const other = keep === "upper" ? lower : upper;
      const content: Record<string, DraftSpan[]> = {};
      for (const v of draft.variants) {
        const merged = mergeSpans(upper.content[v.key], lower.content[v.key]);
        if (merged) content[v.key] = merged;
      }
      // Like the editor: a speaker-less survivor takes the other's speaker
      // when both share a kind, so split-then-merge round-trips.
      const speaker =
        survivor.speaker ?? (other.kind === survivor.kind ? other.speaker : undefined);
      const speakerOrigin =
        survivor.speaker !== undefined ? survivor.origin.speaker : other.origin.speaker;
      const { speaker: _s, ...base } = survivor;
      const merged: DraftBlock = {
        ...base,
        ...(speaker !== undefined ? { speaker } : {}),
        content,
        origin: {
          kind: survivor.origin.kind,
          ...(speaker !== undefined && speakerOrigin ? { speaker: speakerOrigin } : {}),
        },
      };
      const blocks = [...draft.blocks];
      const hidden = blocks.slice(index + 1, lowerIndex);
      blocks.splice(index, lowerIndex - index + 1, merged, ...hidden);
      return withBlocks(draft, blocks);
    }

    case "deleteBlock": {
      // Segments only this block uses are excluded (restorable); its share of
      // segments other blocks also use, and typed text, is dropped.
      const index = blockIndex(draft, op.block);
      const block = draft.blocks[index]!;
      const others = new Set(
        draft.blocks.filter((_, i) => i !== index).flatMap((b) => draftBlockSegments(b)),
      );
      const own = draftBlockSegments(block).filter((id) => !others.has(id));
      const content: Record<string, DraftSpan[]> = {};
      for (const [key, spans] of Object.entries(block.content)) {
        const kept = spans.filter((s) => "seg" in s && own.includes(s.seg));
        if (kept.length > 0) content[key] = kept;
      }
      const blocks = [...draft.blocks];
      if (Object.keys(content).length === 0) blocks.splice(index, 1);
      else blocks[index] = { ...block, content };
      const set = new Set([...draft.excluded, ...own]);
      const order = draft.sources.flatMap((s) => s.segments.map((seg) => seg.id));
      return { ...draft, blocks, excluded: order.filter((id) => set.has(id)) };
    }

    case "setNote":
      return editPieces(draft, op, (pieces) => {
        checkRange(pieces, op.start, op.end);
        return mapRange(pieces, op.start, op.end, (p) =>
          p.t === "ch" ? { ...p, note: op.note } : p,
        );
      });

    case "removeText":
      return editPieces(draft, op, (pieces) => {
        checkRange(pieces, op.start, op.end);
        return mapRange(pieces, op.start, op.end, () => null);
      });

    case "setText":
      // Typing into an empty translation cell starts typed text there.
      return editPieces(draft, op, (pieces, lines) => setText(pieces, lines, op.content), true);

    case "setSpeaker": {
      const index = blockIndex(draft, op.block);
      const block = draft.blocks[index]!;
      if (op.speaker === null) {
        const { speaker: _s, origin: o, ...rest } = block;
        return replaceBlock(draft, index, { ...rest, origin: { kind: o.kind } });
      }
      if (!isValidSpeakerId(op.speaker)) fail(`Invalid speaker id "${op.speaker}"`);
      if (!kindAllowsSpeaker(block.kind, draft)) {
        fail(`Kind "${block.kind}" does not take a speaker`);
      }
      return replaceBlock(draft, index, {
        ...block,
        speaker: op.speaker,
        origin: { kind: block.origin.kind, speaker: origin },
      });
    }

    case "setExcluded": {
      const ctx = contextOf(draft);
      for (const id of op.segments) {
        if (!ctx.segment(id)) fail(`No source segment "${id}"`);
      }
      const set = new Set(draft.excluded);
      for (const id of op.segments) {
        if (op.excluded) set.add(id);
        else set.delete(id);
      }
      const order = draft.sources.flatMap((s) => s.segments.map((seg) => seg.id));
      const by = { ...draft.excludedBy };
      for (const id of op.segments) {
        if (op.excluded && (origin.by === "model" || origin.by === "memory")) by[id] = origin.by;
        else delete by[id];
      }
      const { excludedBy: _by, ...rest } = draft;
      return {
        ...rest,
        excluded: order.filter((id) => set.has(id)),
        ...(Object.keys(by).length > 0 ? { excludedBy: by } : {}),
      };
    }

    case "pairVariant": {
      requireVariant(draft, op.variant);
      const index = blockIndex(draft, op.block);
      const fromIndex = blockIndex(draft, op.from);
      if (index === fromIndex) fail("Cannot pair a block with itself");
      const target = draft.blocks[index]!;
      const from = draft.blocks[fromIndex]!;
      if (target.content[op.variant]) {
        fail(`Block "${op.block}" already has text in variant "${op.variant}"`);
      }
      const spans = from.content[op.variant];
      if (!spans) fail(`Block "${op.from}" has no text in variant "${op.variant}"`);
      const { [op.variant]: _moved, ...left } = from.content;
      const blocks = [...draft.blocks];
      blocks[index] = { ...target, content: { ...target.content, [op.variant]: spans } };
      if (Object.keys(left).length === 0) blocks.splice(fromIndex, 1);
      else blocks[fromIndex] = { ...from, content: left };
      return withBlocks(draft, blocks);
    }

    case "unpairVariant": {
      requireVariant(draft, op.variant);
      const index = blockIndex(draft, op.block);
      const block = draft.blocks[index]!;
      const spans = block.content[op.variant];
      if (!spans) fail(`Block "${op.block}" has no text in variant "${op.variant}"`);
      const { [op.variant]: _moved, ...left } = block.content;
      if (Object.keys(left).length === 0) fail(`Block "${op.block}" has no other variant`);
      const lone: DraftBlock = {
        id: `b${draft.nextBlock}`,
        kind: block.kind,
        ...(block.speaker !== undefined ? { speaker: block.speaker } : {}),
        content: { [op.variant]: spans },
        origin: block.origin,
      };
      const blocks = [...draft.blocks];
      blocks.splice(index, 1, { ...block, content: left }, lone);
      return { ...draft, blocks, nextBlock: draft.nextBlock + 1 };
    }

    case "addVariant": {
      const { lang, variant, title = "", license = "", source = "", rtl, speakers } = op.variant;
      if (!lang.trim() || !variant.trim()) fail("A Variant needs a language and an edition");
      if (draft.variants.some((v) => v.lang === lang && v.variant === variant)) {
        fail(`Variant ${lang} / ${variant} already exists`);
      }
      const added: DraftVariant = {
        key: freeVariantKey(draft),
        lang,
        variant,
        title,
        license,
        source,
        ...(rtl ? { rtl } : {}),
        ...(speakers && Object.keys(speakers).length > 0 ? { speakers } : {}),
      };
      return { ...draft, variants: [...draft.variants, added] };
    }

    case "addSource": {
      requireVariant(draft, op.variant);
      if (draft.sources.some((s) => s.id === op.source.id)) {
        fail(`Source "${op.source.id}" is already in the draft`);
      }
      const known = new Set(draft.sources.flatMap((s) => s.segments.map((seg) => seg.id)));
      for (const seg of op.source.segments) {
        if (known.has(seg.id)) fail(`Duplicate source segment id "${seg.id}"`);
        known.add(seg.id);
      }
      let next = draft.nextBlock;
      const added: DraftBlock[] = op.source.segments.map((segment) => ({
        id: `b${next++}`,
        kind: "verse",
        content: { [op.variant]: segmentSpans(segment) },
        origin: { kind: { by: "reader" } },
      }));
      return {
        ...draft,
        sources: [...draft.sources, op.source],
        blocks: [...draft.blocks, ...added],
        excluded: [
          ...draft.excluded,
          ...op.source.segments.filter((s) => s.furniture).map((s) => s.id),
        ],
        nextBlock: next,
      };
    }

    case "assignVariant": {
      requireVariant(draft, op.from);
      requireVariant(draft, op.to);
      if (op.from === op.to) fail("Source and target Variant are the same");
      const ids = new Set(op.blocks);
      const blocks = draft.blocks.map((b) => {
        if (!ids.has(b.id)) return b;
        ids.delete(b.id);
        const spans = b.content[op.from];
        if (!spans) fail(`Block "${b.id}" has no text in variant "${op.from}"`);
        if (b.content[op.to]) fail(`Block "${b.id}" already has text in variant "${op.to}"`);
        const { [op.from]: _moved, ...rest } = b.content;
        return { ...b, content: { ...rest, [op.to]: spans } };
      });
      if (ids.size > 0) fail(`No block "${[...ids][0]}"`);
      return withBlocks(draft, blocks);
    }

    case "pairByOrder": {
      requireVariant(draft, op.variant);
      // Blocks with only this Variant, in order, go to the blocks without it.
      // Left-out blocks on either side take no part, so the rows stay aligned.
      const ctx = contextOf(draft);
      const lone = draft.blocks.filter(
        (b) =>
          b.content[op.variant] && Object.keys(b.content).length === 1 && isVisible(ctx, b),
      );
      const open = draft.blocks.filter((b) => !b.content[op.variant] && isVisible(ctx, b));
      const pairs = new Map<string, DraftBlock>();
      lone.slice(0, open.length).forEach((b, i) => pairs.set(open[i]!.id, b));
      const moved = new Set([...pairs.values()].map((b) => b.id));
      const blocks = draft.blocks.flatMap((b) => {
        if (moved.has(b.id)) return [];
        const from = pairs.get(b.id);
        if (!from) return [b];
        return [{ ...b, content: { ...b.content, [op.variant]: from.content[op.variant]! } }];
      });
      return withBlocks(draft, blocks);
    }

    case "moveBlock": {
      const index = blockIndex(draft, op.block);
      if (!Number.isInteger(op.to) || op.to < 0 || op.to >= draft.blocks.length) {
        fail(`Position ${op.to} is outside the draft`);
      }
      const blocks = [...draft.blocks];
      const [moved] = blocks.splice(index, 1);
      blocks.splice(op.to, 0, moved!);
      return withBlocks(draft, blocks);
    }

    case "declareKind": {
      const { id, speaker } = op.kind;
      if (isKindPreset(id)) fail(`"${id}" is a preset kind`);
      if (!isValidKindId(id)) fail(`Invalid kind id "${id}"`);
      const def: KindDef = speaker ? { id, speaker: true } : { id };
      const exists = draft.kinds.some((k) => k.id === id);
      const kinds = exists
        ? draft.kinds.map((k) => (k.id === id ? def : k))
        : [...draft.kinds, def];
      const next = { ...draft, kinds };
      // Clearing the speaker flag drops the speakers of that kind's blocks.
      return withBlocks(
        next,
        next.blocks.map((b) =>
          b.speaker !== undefined && b.kind === id && !kindAllowsSpeaker(id, next)
            ? setBlockKind(b, id, next, b.origin.kind)
            : b,
        ),
      );
    }

    case "setPrayerMeta": {
      const meta: DraftPrayerMeta = { ...draft.meta };
      for (const [key, value] of Object.entries(op.patch) as Array<
        [keyof DraftPrayerMeta, DraftPrayerMeta[keyof DraftPrayerMeta]]
      >) {
        const record = meta as Record<string, unknown>;
        if (value !== undefined && value !== "") record[key] = value;
        else if (key === "id" || key === "type") record[key] = "";
        else delete record[key];
      }
      return { ...draft, meta };
    }

    case "setVariantMeta": {
      requireVariant(draft, op.variant);
      const variants = draft.variants.map((v) => {
        if (v.key !== op.variant) return v;
        const next: DraftVariant = { ...v };
        for (const [key, value] of Object.entries(op.patch)) {
          if (key === "rtl") {
            if (value) next.rtl = true;
            else delete next.rtl;
          } else if (key === "speakers") {
            if (value && Object.keys(value as object).length > 0) {
              next.speakers = value as Record<string, SpeakerLabel>;
            } else delete next.speakers;
          } else if (key !== "key") {
            (next as Record<string, unknown>)[key] = value ?? "";
          }
        }
        return next;
      });
      const changed = variants.find((v) => v.key === op.variant)!;
      if (
        variants.some(
          (v) => v.key !== op.variant && v.lang === changed.lang && v.variant === changed.variant,
        )
      ) {
        fail(`Variant ${changed.lang} / ${changed.variant} already exists`);
      }
      return { ...draft, variants };
    }
  }
}

/** Apply one Import operation. `origin` records who decided (default: human). */
export function applyImportOp(
  draft: ImportDraft,
  op: ImportOp,
  origin: ImportOrigin = HUMAN,
): ImportOpResult {
  return applyImportOps(draft, [op], origin);
}

/** Apply operations in order as one step; nothing changes if one fails. */
export function applyImportOps(
  draft: ImportDraft,
  ops: readonly ImportOp[],
  origin: ImportOrigin = HUMAN,
): ImportOpResult {
  let next = draft;
  try {
    for (const op of ops) next = applyOne(next, op, origin);
  } catch (error) {
    if (error instanceof OpError) return { ok: false, error: error.message };
    throw error;
  }
  return { ok: true, draft: next };
}
