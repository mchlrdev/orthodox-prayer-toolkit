import {
  draftBlockPlainText,
  draftBlocksInColumn,
  segmentColumn,
} from "@orthodox-prayer-toolkit/core";
import type {
  DraftBlock,
  DraftSpan,
  ImportDraft,
  SegmentLook,
  SegmentMark,
} from "@orthodox-prayer-toolkit/core";

/** What the Source column shows: segment numbers, group marks, source text. */

export type SegmentInfo = {
  n: number;
  text: string;
  group?: string;
  look: SegmentLook;
  /** Inline runs that look different (Note run hints), offsets in `text`. */
  marks?: readonly SegmentMark[];
};

/** Segments by id, numbered 1… across all Sources. */
export function segmentIndex(draft: ImportDraft): Map<string, SegmentInfo> {
  const out = new Map<string, SegmentInfo>();
  let n = 0;
  for (const source of draft.sources) {
    for (const seg of source.segments) {
      n += 1;
      out.set(seg.id, { n, text: seg.text, group: seg.group, look: seg.look, marks: seg.marks });
    }
  }
  return out;
}

/** Style group id → A, B, … in order of first appearance. */
export function groupLetters(draft: ImportDraft): Map<string, string> {
  const out = new Map<string, string>();
  for (const source of draft.sources) {
    for (const seg of source.segments) {
      if (!seg.group || out.has(seg.group)) continue;
      const i = out.size;
      out.set(seg.group, (i >= 26 ? String.fromCharCode(65 + Math.floor(i / 26) - 1) : "") +
        String.fromCharCode(65 + (i % 26)));
    }
  }
  return out;
}

export type SourcePart = SegmentInfo;

/** The Source text a block points at, per segment (first Variant with text, or the given one). */
export function sourceParts(
  block: DraftBlock,
  segments: ReadonlyMap<string, SegmentInfo>,
  /** Only this Variant's text (none when the block lacks it). */
  variantKey?: string,
): SourcePart[] {
  const spans: DraftSpan[] =
    (variantKey !== undefined
      ? block.content[variantKey]
      : Object.values(block.content).find((s) => s.some((x) => "seg" in x))) ?? [];
  // One part per run of spans into the same segment: its text from the first
  // span's start to the last span's end, as the Source has it.
  const runs: Array<{ seg: string; start: number; end: number }> = [];
  for (const span of spans) {
    if (!("seg" in span)) continue;
    const last = runs[runs.length - 1];
    if (last && last.seg === span.seg && span.start >= last.end) last.end = span.end;
    else runs.push({ seg: span.seg, start: span.start, end: span.end });
  }
  return runs.flatMap((run) => {
    const seg = segments.get(run.seg);
    if (!seg) return [];
    const raw = seg.text.slice(run.start, run.end);
    const from = run.start + (raw.length - raw.trimStart().length);
    const text = raw.trim();
    const marks = seg.marks
      ?.map((m) => ({
        ...m,
        start: Math.max(0, m.start - from),
        end: Math.min(text.length, m.end - from),
      }))
      .filter((m) => m.end > m.start);
    return [{ ...seg, text, marks: marks?.length ? marks : undefined }];
  });
}

/** Short one-line sample of a text for hints. */
export function sample(text: string, max = 28): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export type TextPiece = { text: string; mark?: SegmentMark };

/** Text cut at its marks, for drawing them. */
export function markedPieces(text: string, marks: readonly SegmentMark[] | undefined): TextPiece[] {
  if (!marks?.length) return [{ text }];
  const out: TextPiece[] = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.start < at) continue;
    if (mark.start > at) out.push({ text: text.slice(at, mark.start) });
    out.push({ text: text.slice(mark.start, mark.end), mark });
    at = mark.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export type ColumnInfo = { column: number; sourceName: string; text: string; count: number };

/**
 * Columns past the first in the first Variant's blocks (a parallel PDF or
 * table): each can become a second language.
 */
export function draftColumns(draft: ImportDraft): ColumnInfo[] {
  const key = draft.variants[0]!.key;
  const out: ColumnInfo[] = [];
  const columns = new Set<number>();
  for (const source of draft.sources) {
    for (const seg of source.segments) {
      const c = segmentColumn(seg);
      if (c !== undefined && c > 0 && !columns.has(c)) {
        columns.add(c);
        out.push({ column: c, sourceName: source.name, text: "", count: 0 });
      }
    }
  }
  for (const info of out) {
    const blocks = draftBlocksInColumn(draft, info.column, key);
    info.count = blocks.length;
    info.text = blocks.map((b) => draftBlockPlainText(draft, b, key)).join("\n");
  }
  return out.filter((c) => c.count > 0).sort((a, b) => a.column - b.column);
}
