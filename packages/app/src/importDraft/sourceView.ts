import type {
  DraftBlock,
  DraftSpan,
  ImportDraft,
  SegmentLook,
} from "@orthodox-prayer-toolkit/core";

/** What the Source column shows: segment numbers, group marks, source text. */

export type SegmentInfo = { n: number; text: string; group?: string; look: SegmentLook };

/** Segments by id, numbered 1… across all Sources. */
export function segmentIndex(draft: ImportDraft): Map<string, SegmentInfo> {
  const out = new Map<string, SegmentInfo>();
  let n = 0;
  for (const source of draft.sources) {
    for (const seg of source.segments) {
      n += 1;
      out.set(seg.id, { n, text: seg.text, group: seg.group, look: seg.look });
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

/** The Source text a block points at, per segment (first Variant with text). */
export function sourceParts(
  block: DraftBlock,
  segments: ReadonlyMap<string, SegmentInfo>,
): SourcePart[] {
  const spans: DraftSpan[] =
    Object.values(block.content).find((s) => s.some((x) => "seg" in x)) ?? [];
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
    return [{ ...seg, text: seg.text.slice(run.start, run.end).trim() }];
  });
}

/** Short one-line sample of a text for hints. */
export function sample(text: string, max = 28): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
