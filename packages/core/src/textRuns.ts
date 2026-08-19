/** Inline segment: prayer text or liturgical note/rubric. */
export type TextRun = {
  t: "text" | "note";
  v: string;
};

/** Plain string or run list. Prefer string when there are no notes. */
export type InlineContent = string | TextRun[];

function isRun(value: unknown): value is TextRun {
  if (typeof value !== "object" || value === null) return false;
  const r = value as { t?: unknown; v?: unknown };
  return (r.t === "text" || r.t === "note") && typeof r.v === "string";
}

/** True when value is a run array (possibly empty). */
export function isRunArray(value: unknown): value is TextRun[] {
  return Array.isArray(value) && value.every(isRun);
}

export function isInlineContent(value: unknown): value is InlineContent {
  return typeof value === "string" || isRunArray(value);
}

/** Expand stored content to runs (does not normalize). */
export function toRuns(content: InlineContent): TextRun[] {
  if (typeof content === "string") {
    return content.length === 0 ? [] : [{ t: "text", v: content }];
  }
  return content.map((r) => ({ t: r.t, v: r.v }));
}

/** Concatenate all run values. */
export function plainText(content: InlineContent): string {
  return toRuns(content)
    .map((r) => r.v)
    .join("");
}

/**
 * Peel leading/trailing whitespace out of note runs into adjacent text,
 * drop empties / zero-width-only text, merge adjacent same-role runs,
 * and coalesce notes that are only separated by whitespace into one note.
 */
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const stripped = runs.map((run) => ({
    t: run.t,
    v: run.v.replace(/[\u200B\u200C\u200D\uFEFF]/g, ""),
  }));

  const peeled: TextRun[] = [];

  for (const run of stripped) {
    if (run.t === "text") {
      peeled.push({ t: "text", v: run.v });
      continue;
    }

    const leading = run.v.match(/^\s+/)?.[0] ?? "";
    const trailing = run.v.match(/\s+$/)?.[0] ?? "";
    const core = run.v.slice(leading.length, run.v.length - trailing.length);

    if (leading) peeled.push({ t: "text", v: leading });
    if (core) peeled.push({ t: "note", v: core });
    if (trailing) peeled.push({ t: "text", v: trailing });
  }

  const merged: TextRun[] = [];
  for (const run of peeled) {
    if (run.v.length === 0) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.t === run.t) {
      prev.v += run.v;
    } else {
      merged.push({ t: run.t, v: run.v });
    }
  }

  // note + whitespace-only text + note (+ …) → one note (keep the spaces inside)
  const coalesced: TextRun[] = [];
  let i = 0;
  while (i < merged.length) {
    const cur = merged[i]!;
    if (cur.t !== "note") {
      coalesced.push({ t: cur.t, v: cur.v });
      i += 1;
      continue;
    }

    let value = cur.v;
    let j = i + 1;
    while (
      j + 1 < merged.length &&
      merged[j]!.t === "text" &&
      /^\s+$/.test(merged[j]!.v) &&
      merged[j + 1]!.t === "note"
    ) {
      value += merged[j]!.v + merged[j + 1]!.v;
      j += 2;
    }
    coalesced.push({ t: "note", v: value });
    i = j;
  }

  return coalesced;
}

/**
 * Compact for storage: plain string when there are no notes;
 * otherwise a normalized run list. Empty → null.
 */
export function packInline(runs: TextRun[]): InlineContent | null {
  const normalized = normalizeRuns(runs);
  if (normalized.length === 0) return null;
  if (normalized.every((r) => r.t === "text")) {
    return normalized.map((r) => r.v).join("");
  }
  return normalized;
}

function trimRange(
  plain: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let s = Math.max(0, Math.min(start, plain.length));
  let e = Math.max(0, Math.min(end, plain.length));
  if (e < s) [s, e] = [e, s];
  while (s < e && /\s/.test(plain[s]!)) s += 1;
  while (e > s && /\s/.test(plain[e - 1]!)) e -= 1;
  return { start: s, end: e };
}

type Slice = { t: "text" | "note"; v: string; from: number; to: number };

function slicesFromRuns(runs: TextRun[]): Slice[] {
  const out: Slice[] = [];
  let offset = 0;
  for (const run of normalizeRuns(runs)) {
    const from = offset;
    const to = offset + run.v.length;
    out.push({ t: run.t, v: run.v, from, to });
    offset = to;
  }
  return out;
}

/**
 * Mark [start, end) as note (plain-text offsets). Leading/trailing
 * whitespace in the selection stays text. No-op if range is empty/whitespace-only.
 */
export function markRangeAsNote(
  content: InlineContent,
  start: number,
  end: number,
): InlineContent {
  const runs = toRuns(content);
  const plain = plainText(runs);
  const range = trimRange(plain, start, end);
  if (range.start >= range.end) {
    return packInline(runs) ?? "";
  }

  const pieces: TextRun[] = [];
  for (const slice of slicesFromRuns(runs)) {
    const parts: Array<{ t: "text" | "note"; from: number; to: number }> = [];
    const a = slice.from;
    const b = slice.to;
    if (range.start > a) {
      parts.push({
        t: slice.t,
        from: a,
        to: Math.min(range.start, b),
      });
    }
    const noteFrom = Math.max(range.start, a);
    const noteTo = Math.min(range.end, b);
    if (noteFrom < noteTo) {
      parts.push({ t: "note", from: noteFrom, to: noteTo });
    }
    if (range.end < b) {
      parts.push({
        t: slice.t,
        from: Math.max(range.end, a),
        to: b,
      });
    }
    for (const p of parts) {
      if (p.from >= p.to) continue;
      pieces.push({ t: p.t, v: plain.slice(p.from, p.to) });
    }
  }

  return packInline(pieces) ?? "";
}

/**
 * Turn note characters in [start, end) back into text.
 * Whitespace trimming matches markRangeAsNote.
 */
export function unmarkRange(
  content: InlineContent,
  start: number,
  end: number,
): InlineContent {
  const runs = toRuns(content);
  const plain = plainText(runs);
  const range = trimRange(plain, start, end);
  if (range.start >= range.end) {
    return packInline(runs) ?? "";
  }

  const pieces: TextRun[] = [];
  for (const slice of slicesFromRuns(runs)) {
    const a = slice.from;
    const b = slice.to;
    const overlaps = range.start < b && range.end > a;
    if (!overlaps) {
      pieces.push({ t: slice.t, v: slice.v });
      continue;
    }
    if (range.start > a) {
      pieces.push({ t: slice.t, v: plain.slice(a, range.start) });
    }
    const midFrom = Math.max(range.start, a);
    const midTo = Math.min(range.end, b);
    if (midFrom < midTo) {
      pieces.push({ t: "text", v: plain.slice(midFrom, midTo) });
    }
    if (range.end < b) {
      pieces.push({ t: slice.t, v: plain.slice(range.end, b) });
    }
  }

  return packInline(pieces) ?? "";
}

/** If the range overlaps any note run, unmark those whole runs; else mark the range. */
export function toggleNoteRange(
  content: InlineContent,
  start: number,
  end: number,
): InlineContent {
  const runs = normalizeRuns(toRuns(content));
  const plain = plainText(runs);
  const range = trimRange(plain, start, end);
  if (range.start >= range.end) {
    return packInline(runs) ?? "";
  }

  const slices = slicesFromRuns(runs);
  const overlappingNotes = new Set<number>();
  for (const [i, slice] of slices.entries()) {
    if (
      slice.t === "note" &&
      range.start < slice.to &&
      range.end > slice.from
    ) {
      overlappingNotes.add(i);
    }
  }

  if (overlappingNotes.size > 0) {
    const next = runs.map((r, i) =>
      overlappingNotes.has(i) ? ({ t: "text" as const, v: r.v }) : r,
    );
    return packInline(next) ?? "";
  }

  return markRangeAsNote(content, range.start, range.end);
}

/**
 * Split at a plain-text caret, or drop [start, end) when `end` is given.
 * Offsets clamp to the content. Empty sides pack to null.
 */
export function splitInline(
  content: InlineContent,
  start: number,
  end: number = start,
): { before: InlineContent | null; after: InlineContent | null } {
  const runs = toRuns(content);
  const plain = plainText(runs);
  let from = Math.max(0, Math.min(start, plain.length));
  let to = Math.max(0, Math.min(end, plain.length));
  if (to < from) [from, to] = [to, from];

  const beforeRuns: TextRun[] = [];
  const afterRuns: TextRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const next = pos + run.v.length;
    if (pos < from) {
      const slice = run.v.slice(0, Math.min(from, next) - pos);
      if (slice.length > 0) beforeRuns.push({ t: run.t, v: slice });
    }
    if (next > to) {
      const slice = run.v.slice(Math.max(to, pos) - pos);
      if (slice.length > 0) afterRuns.push({ t: run.t, v: slice });
    }
    pos = next;
  }

  return {
    before: packInline(beforeRuns),
    after: packInline(afterRuns),
  };
}

/**
 * Replace plain-text [start, end) with `replacement`, preserving run roles
 * outside the range. Replacement inherits the role when the range lies entirely
 * within one run; otherwise it is inserted as text.
 */
export function replaceRangeInInline(
  content: InlineContent,
  start: number,
  end: number,
  replacement: string,
): InlineContent {
  const runs = normalizeRuns(toRuns(content));
  const plain = plainText(runs);
  let from = Math.max(0, Math.min(start, plain.length));
  let to = Math.max(0, Math.min(end, plain.length));
  if (to < from) [from, to] = [to, from];

  if (from === to && replacement.length === 0) {
    return packInline(runs) ?? "";
  }

  let replaceRole: "text" | "note" = "text";
  let pos = 0;
  for (const run of runs) {
    const next = pos + run.v.length;
    if (from >= pos && to <= next) {
      replaceRole = run.t;
      break;
    }
    pos = next;
  }

  const { before, after } = splitInline(content, from, to);
  const pieces: TextRun[] = [...toRuns(before ?? "")];
  if (replacement.length > 0) {
    pieces.push({ t: replaceRole, v: replacement });
  }
  pieces.push(...toRuns(after ?? ""));
  return packInline(pieces) ?? "";
}

/** Convert the note run at `runIndex` to text and repack. */
export function unmarkNoteAt(
  content: InlineContent,
  runIndex: number,
): InlineContent {
  const runs = normalizeRuns(toRuns(content));
  if (runIndex < 0 || runIndex >= runs.length) {
    return packInline(runs) ?? "";
  }
  if (runs[runIndex]!.t !== "note") {
    return packInline(runs) ?? "";
  }
  const next = runs.map((r, i) =>
    i === runIndex ? ({ t: "text" as const, v: r.v }) : r,
  );
  return packInline(next) ?? "";
}
