/**
 * Text of one Import draft block in one Variant, as a list of spans into
 * Source segments. Rendering turns spans into the plain text the editor
 * shows; edits work on that plain text and are turned back into spans, so
 * every character still points at its source (or is marked as typed).
 */
import type { SourceSegment } from "./importSource.js";
import { packInline, type InlineContent, type TextRun } from "./textRuns.js";

/**
 * `seg` spans cover `[start, end)` of a segment's text; `text` spans hold
 * typed characters. `join` renders the span directly after the previous one;
 * `brk` forces a line break where the source would run on.
 */
export type DraftSpan =
  | { seg: string; start: number; end: number; note?: true; join?: true; brk?: true }
  | { text: string; note?: true; join?: true; brk?: true };

export type Piece =
  | { t: "ch"; ch: string; seg?: string; off?: number; note: boolean }
  | { t: "sep" }
  | { t: "hidden"; span: DraftSpan };

export type ContentContext = {
  segment: (id: string) => SourceSegment | undefined;
  excluded: ReadonlySet<string>;
};

const RUN_ON_GAP = /^[^\S\r\n]*$/;
const DROPPED = /[​﻿]/;

function isSegSpan(
  span: DraftSpan,
): span is Extract<DraftSpan, { seg: string }> {
  return "seg" in span;
}

/** Whether `b` continues `a` on the same line in the source. */
function runsOn(
  a: DraftSpan | null,
  b: DraftSpan,
  ctx: ContentContext,
): string | null {
  if (!a || !isSegSpan(a) || !isSegSpan(b) || a.seg !== b.seg) return null;
  if (b.start < a.end) return null;
  const gap = ctx.segment(a.seg)?.text.slice(a.end, b.start) ?? null;
  return gap !== null && RUN_ON_GAP.test(gap) ? gap : null;
}

function pushChars(out: Piece[], span: DraftSpan, ctx: ContentContext): void {
  const note = span.note === true;
  if (isSegSpan(span)) {
    const text = ctx.segment(span.seg)?.text ?? "";
    for (let k = span.start; k < Math.min(span.end, text.length); k++) {
      const ch = text[k]!;
      if (ch === "\n" || ch === "\r") out.push({ t: "sep" });
      else if (!DROPPED.test(ch)) out.push({ t: "ch", ch, seg: span.seg, off: k, note });
    }
    return;
  }
  for (const ch of span.text) {
    for (const unit of ch.length > 1 ? ch.split("") : [ch]) {
      if (unit === "\n" || unit === "\r") out.push({ t: "sep" });
      else if (!DROPPED.test(unit)) out.push({ t: "ch", ch: unit, note });
    }
  }
}

/** Spans → pieces: one char per code unit, line breaks as `sep`, lines trimmed. */
export function buildPieces(spans: readonly DraftSpan[], ctx: ContentContext): Piece[] {
  const raw: Piece[] = [];
  let prev: DraftSpan | null = null;
  for (const span of spans) {
    if (isSegSpan(span) && ctx.excluded.has(span.seg)) {
      raw.push({ t: "hidden", span });
      continue;
    }
    if (prev) {
      const gap = span.join || span.brk ? null : runsOn(prev, span, ctx);
      if (span.brk) raw.push({ t: "sep" });
      else if (gap !== null) {
        const seg = (prev as Extract<DraftSpan, { seg: string }>).seg;
        const from = (prev as Extract<DraftSpan, { seg: string }>).end;
        for (let k = 0; k < gap.length; k++) {
          raw.push({ t: "ch", ch: gap[k]!, seg, off: from + k, note: false });
        }
      } else if (!span.join) raw.push({ t: "sep" });
    }
    pushChars(raw, span, ctx);
    prev = span;
  }

  // Trim each line, drop empty lines, keep hidden pieces in place.
  const out: Piece[] = [];
  let hasText = false;
  let line: Piece[] = [];
  const flush = () => {
    const isText = (p: Piece) => p.t === "ch" && !/\s/.test(p.ch);
    const first = line.findIndex(isText);
    let last = -1;
    for (let i = line.length - 1; i >= 0; i--) {
      if (isText(line[i]!)) {
        last = i;
        break;
      }
    }
    if (first !== -1 && hasText) out.push({ t: "sep" });
    for (const [i, p] of line.entries()) {
      if (p.t === "hidden" || (first !== -1 && i >= first && i <= last)) out.push(p);
    }
    if (first !== -1) hasText = true;
    line = [];
  };
  for (const p of raw) {
    if (p.t === "sep") flush();
    else line.push(p);
  }
  flush();
  return out;
}

export function pieceWidth(p: Piece): number {
  return p.t === "hidden" ? 0 : 1;
}

/** Plain text as the editor sees it: verse lines joined by "\n", text kinds by " ". */
export function piecesPlain(pieces: readonly Piece[], lineMode: boolean): string {
  return pieces
    .map((p) => (p.t === "ch" ? p.ch : p.t === "sep" ? (lineMode ? "\n" : " ") : ""))
    .join("");
}

export function hasVisibleText(pieces: readonly Piece[]): boolean {
  return pieces.some((p) => p.t === "ch");
}

function runsOf(pieces: readonly Piece[]): TextRun[] {
  const runs: TextRun[] = [];
  for (const p of pieces) {
    if (p.t !== "ch") continue;
    const t = p.note ? "note" : "text";
    const last = runs[runs.length - 1];
    if (last && last.t === t) last.v += p.ch;
    else runs.push({ t, v: p.ch });
  }
  return runs;
}

/** Translation payload: `lines` for verse, `text` otherwise; null when empty. */
export function piecesContent(
  pieces: readonly Piece[],
  lineMode: boolean,
): { text: InlineContent } | { lines: InlineContent[] } | null {
  if (!lineMode) {
    const runs: TextRun[] = [];
    for (const p of pieces) {
      if (p.t === "sep") runs.push({ t: "text", v: " " });
      else if (p.t === "ch") runs.push({ t: p.note ? "note" : "text", v: p.ch });
    }
    const text = packInline(runs);
    return text === null ? null : { text };
  }
  const lines: InlineContent[] = [];
  let current: Piece[] = [];
  const close = () => {
    const packed = packInline(runsOf(current));
    if (packed !== null) lines.push(packed);
    current = [];
  };
  for (const p of pieces) {
    if (p.t === "sep") close();
    else current.push(p);
  }
  close();
  return lines.length === 0 ? null : { lines };
}

/** Pieces → spans, so that `buildPieces` renders the same text again. */
export function piecesToSpans(pieces: readonly Piece[], ctx: ContentContext): DraftSpan[] {
  const spans: DraftSpan[] = [];
  // Index in `spans` of the span being extended / the last visible one.
  let open = -1;
  let lastVisible = -1;
  let sawSep = false;

  for (const p of pieces) {
    if (p.t === "hidden") {
      open = -1;
      spans.push(p.span);
      continue;
    }
    if (p.t === "sep") {
      open = -1;
      sawSep = true;
      continue;
    }
    const cur = open === -1 ? null : spans[open]!;
    if (cur && (cur.note === true) === p.note) {
      if (isSegSpan(cur) && p.seg === cur.seg && p.off === cur.end) {
        cur.end += 1;
        continue;
      }
      if (!isSegSpan(cur) && p.seg === undefined) {
        cur.text += p.ch;
        continue;
      }
    }
    const next: DraftSpan =
      p.seg !== undefined
        ? { seg: p.seg, start: p.off!, end: p.off! + 1 }
        : { text: p.ch };
    if (p.note) next.note = true;
    const prev = lastVisible === -1 ? null : spans[lastVisible]!;
    if (prev) {
      if (sawSep) {
        if (runsOn(prev, next, ctx) !== null) next.brk = true;
      } else {
        const adjacent =
          isSegSpan(prev) &&
          isSegSpan(next) &&
          prev.seg === next.seg &&
          prev.end === next.start;
        if (!adjacent) next.join = true;
      }
    }
    spans.push(next);
    open = lastVisible = spans.length - 1;
    sawSep = false;
  }
  return spans;
}

/**
 * Pieces before and after a plain-text offset. Zero-width (hidden) pieces at
 * the offset stay before it.
 */
export function splitPieces(
  pieces: readonly Piece[],
  at: number,
): { before: Piece[]; after: Piece[] } {
  const before: Piece[] = [];
  const after: Piece[] = [];
  let pos = 0;
  for (const p of pieces) {
    const w = pieceWidth(p);
    if (pos + w <= at && after.length === 0) before.push(p);
    else after.push(p);
    pos += w;
  }
  return { before, after };
}

/** Map visible pieces in `[start, end)`; hidden pieces pass through. */
export function mapRange(
  pieces: readonly Piece[],
  start: number,
  end: number,
  fn: (p: Exclude<Piece, { t: "hidden" }>) => Piece | null,
): Piece[] {
  const out: Piece[] = [];
  let pos = 0;
  for (const p of pieces) {
    const w = pieceWidth(p);
    if (p.t !== "hidden" && pos >= start && pos < end) {
      const next = fn(p);
      if (next) out.push(next);
    } else {
      out.push(p);
    }
    pos += w;
  }
  return out;
}

/** Segment ids a span list points into (in order, without repeats). */
export function spanSegments(spans: readonly DraftSpan[]): string[] {
  const ids: string[] = [];
  for (const span of spans) {
    if (isSegSpan(span) && !ids.includes(span.seg)) ids.push(span.seg);
  }
  return ids;
}

/** True when any span holds typed (not source) text. */
export function spansHaveTypedText(spans: readonly DraftSpan[]): boolean {
  return spans.some((s) => !isSegSpan(s) && s.text.length > 0);
}
