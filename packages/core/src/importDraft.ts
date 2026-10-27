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
import type { Source, SourceSegment } from "./importSource.js";
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
  const blocks: DraftBlock[] = options.sources
    .flatMap((s) => s.segments)
    .map((segment, i) => ({
      id: `b${i + 1}`,
      kind: "verse",
      content: { v1: [{ seg: segment.id, start: 0, end: segment.text.length }] },
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
    excluded: [],
    nextBlock: blocks.length + 1,
  };
}

function contextOf(draft: ImportDraft): ContentContext {
  const segments = new Map<string, SourceSegment>();
  for (const source of draft.sources) {
    for (const segment of source.segments) segments.set(segment.id, segment);
  }
  return { segment: (id) => segments.get(id), excluded: new Set(draft.excluded) };
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

/**
 * The Prayer the draft stands for. Blocks with no visible text are left out;
 * missing translations are omitted. Run it through `validate()` before saving.
 */
export function importDraftToPrayer(draft: ImportDraft): Prayer {
  const ctx = contextOf(draft);
  const structure: Block[] = [];
  for (const block of draft.blocks) {
    const translations: Translation[] = [];
    for (const v of draft.variants) {
      const spans = block.content[v.key];
      if (!spans) continue;
      const payload = piecesContent(buildPieces(spans, ctx), lineMode(block.kind));
      if (payload) translations.push({ lang: v.lang, variant: v.variant, ...payload });
    }
    if (translations.length === 0) continue;
    const speaker =
      block.speaker !== undefined && kindAllowsSpeaker(block.kind, draft)
        ? { speaker: block.speaker }
        : {};
    structure.push({ id: block.id, kind: block.kind, ...speaker, translations });
  }

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
  | ({ op: "setNote"; start: number; end: number; note: boolean } & TextRef)
  | { op: "setSpeaker"; block: string; speaker: string | null }
  | ({ op: "removeText"; start: number; end: number } & TextRef)
  | ({ op: "setText"; content: InlineContent | InlineContent[] } & TextRef)
  | { op: "setExcluded"; segments: string[]; excluded: boolean }
  | { op: "pairVariant"; block: string; variant: string; from: string }
  | { op: "unpairVariant"; block: string; variant: string }
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
): ImportDraft {
  const index = blockIndex(draft, ref.block);
  requireVariant(draft, ref.variant);
  const block = draft.blocks[index]!;
  const spans = block.content[ref.variant];
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
      const index = blockIndex(draft, op.block);
      const upper = draft.blocks[index]!;
      const lower = draft.blocks[index + 1];
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
      blocks.splice(index, 2, merged);
      return withBlocks(draft, blocks);
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
      return editPieces(draft, op, (pieces, lines) => setText(pieces, lines, op.content));

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
      return { ...draft, excluded: order.filter((id) => set.has(id)) };
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
