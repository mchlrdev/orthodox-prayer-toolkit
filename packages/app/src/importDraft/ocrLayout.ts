import {
  assignStyleGroups,
  type SegmentLook,
  type Source,
  type SourceSegment,
  type UncertainRange,
} from "@orthodox-prayer-toolkit/core";
import { PdfWithoutTextError, segmentPdfPages, type PdfPageText, type PdfTextItem } from "./pdfLayout.ts";

/**
 * Text recognition (Tesseract) → Source segments, without Tesseract: the
 * recognised lines are straightened (a scan is rarely level), sorted into
 * size classes and ink colours, and then joined into paragraphs by the PDF
 * layout (columns, indents, hyphens, page numbers). Coordinates are image
 * pixels, origin top-left.
 */

export type OcrBox = { x0: number; y0: number; x1: number; y1: number };

export type OcrWord = {
  text: string;
  bbox: OcrBox;
  /** 0–100. */
  confidence: number;
};

export type OcrLine = {
  text: string;
  bbox: OcrBox;
  /** Start and end of the baseline. */
  baseline: OcrBox;
  /** Height of the text row (ascender to descender) in pixels; 0 when unknown. */
  rowHeight?: number;
  /** 0–100. */
  confidence: number;
  words: OcrWord[];
  /** Ink colour measured in the image (the darkest pixels of the words), 0–255. */
  ink?: readonly [number, number, number];
};

export type OcrPage = {
  /** 1-based. */
  page: number;
  width: number;
  height: number;
  lines: OcrLine[];
};

export class ImageWithoutTextError extends Error {
  constructor() {
    super("No text was recognised in this image.");
    this.name = "ImageWithoutTextError";
  }
}

/** Words below this confidence (0–100) are marked as uncertain. */
export const UNCERTAIN_BELOW = 60;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!;
};

/** Slope of the text on the page, from the baselines of the longer lines. */
export function pageSlope(page: OcrPage): number {
  const slopes = (minWidth: number) =>
    page.lines
      .map((l) => l.baseline)
      .filter((b) => b.x1 - b.x0 >= minWidth)
      .map((b) => (b.y1 - b.y0) / (b.x1 - b.x0));
  const long = slopes(page.width * 0.3);
  const slope = median(long.length > 0 ? long : slopes(1));
  // Beyond ~6° the recognition itself fails; do not trust such a value.
  return Math.abs(slope) < 0.1 ? slope : 0;
}

/** A row (ascender to descender) is a little less than the font size the layout reasons in. */
const EM_PER_ROW = 1.15;

function rowHeight(line: OcrLine): number {
  if (line.rowHeight && line.rowHeight > 0) return line.rowHeight;
  return median(line.words.map((w) => w.bbox.y1 - w.bbox.y0)) || line.bbox.y1 - line.bbox.y0;
}

/**
 * Size classes: row heights within ~10% of each other are one class; each
 * line gets its class's median, so lines of one size share a style.
 */
function sizeClasses(heights: number[]): number[] {
  const order = heights.map((h, i) => [h, i] as const).sort((a, b) => a[0] - b[0]);
  const classOf = new Array<number>(heights.length);
  let members: number[] = [];
  let last = 0;
  const close = () => {
    const m = median(members.map((i) => heights[i]!));
    for (const i of members) classOf[i] = m;
    members = [];
  };
  for (const [h, i] of order) {
    if (members.length > 0 && h > last * 1.1) close();
    members.push(i);
    last = h;
  }
  if (members.length > 0) close();
  return classOf;
}

/** Ink classes: black (none), grey, red, blue, green. */
export function inkColor(ink: readonly [number, number, number] | undefined): string | undefined {
  if (!ink) return undefined;
  const [r, g, b] = ink;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 40) return min > 110 ? "#808080" : undefined;
  if (r === max) return "#a52a2a";
  if (b === max) return "#1f3f99";
  return "#2e7d32";
}

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", І: "I", Ј: "J", Ѕ: "S",
};
const LATIN_TO_CYRILLIC: Record<string, string> = Object.fromEntries(
  Object.entries(CYRILLIC_TO_LATIN).map(([c, l]) => [l, c]),
);

const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;

/**
 * Look-alike letters in the wrong script: with German and Russian loaded,
 * Tesseract may read the "o" of a German line as a Cyrillic "о". A word's
 * letters from the line's minority script become their twin in the
 * majority script when every one of them has a twin.
 */
export function fixMixedScript(words: string[]): string[] {
  let latin = 0;
  let cyrillic = 0;
  for (const w of words) {
    for (const ch of w) {
      if (LATIN.test(ch)) latin++;
      else if (CYRILLIC.test(ch)) cyrillic++;
    }
  }
  if (latin + cyrillic === 0 || Math.min(latin, cyrillic) === 0) return words;
  const toLatin = latin > cyrillic;
  // A line that is really mixed (a parallel text) is left alone.
  if (Math.max(latin, cyrillic) < (latin + cyrillic) * 0.8) return words;
  const minority = toLatin ? CYRILLIC : LATIN;
  const twins = toLatin ? CYRILLIC_TO_LATIN : LATIN_TO_CYRILLIC;
  return words.map((w) => {
    const chars = [...w];
    const odd = chars.filter((ch) => minority.test(ch));
    if (odd.length === 0 || !odd.every((ch) => twins[ch])) return w;
    return chars.map((ch) => (minority.test(ch) ? twins[ch]! : ch)).join("");
  });
}

type Placed = { line: OcrLine; words: string[]; x: number; y: number; size: number; color?: string };

/** Lines straightened (sheared by the page slope around the page centre). */
function placeLines(page: OcrPage, slope: number): Placed[] {
  const lines = page.lines.filter((l) => l.words.some((w) => w.text.trim() !== ""));
  const sizes = sizeClasses(lines.map(rowHeight));
  const cx = page.width / 2;
  return lines.map((line, i) => {
    const b = line.baseline;
    const mid = (line.bbox.x0 + line.bbox.x1) / 2;
    const lineSlope = b.x1 > b.x0 ? (b.y1 - b.y0) / (b.x1 - b.x0) : slope;
    const baseAtMid = b.y0 + lineSlope * (mid - b.x0);
    const color = inkColor(line.ink);
    return {
      line,
      words: fixMixedScript(line.words.map((w) => w.text)),
      x: mid,
      y: baseAtMid - slope * (mid - cx),
      size: sizes[i]! * EM_PER_ROW,
      ...(color ? { color } : {}),
    };
  });
}

function items(placed: Placed[]): PdfTextItem[] {
  return placed.flatMap((p) =>
    p.line.words.map((w, i): PdfTextItem => ({
      str: p.words[i]!,
      x: w.bbox.x0,
      y: p.y,
      width: w.bbox.x1 - w.bbox.x0,
      size: p.size,
      font: "scan",
      bold: false,
      italic: false,
      ...(p.color ? { color: p.color } : {}),
    })),
  );
}

/** Size as people know it: the body text is 16px, other classes scale with it. */
function lookFor(look: SegmentLook, body: number): SegmentLook {
  const { font: _font, weight: _weight, style: _style, size, ...rest } = look;
  const px = parseFloat(String(size));
  return Number.isFinite(px) && body > 0 ? { ...rest, size: `${Math.round((16 * px) / body)}px` } : rest;
}

/** Ranges of the words read below {@link UNCERTAIN_BELOW}, found in order in `text`. */
function uncertainRanges(text: string, lines: Placed[]): UncertainRange[] {
  const out: UncertainRange[] = [];
  let from = 0;
  for (const p of lines) {
    p.line.words.forEach((w, i) => {
      const word = p.words[i]!.trim();
      if (!word) return;
      const at = text.indexOf(word, from);
      if (at === -1) return;
      from = at + word.length;
      if (w.confidence < UNCERTAIN_BELOW) {
        out.push({
          start: at,
          end: at + word.length,
          confidence: Math.round(w.confidence) / 100,
          box: { x: w.bbox.x0, y: w.bbox.y0, width: w.bbox.x1 - w.bbox.x0, height: w.bbox.y1 - w.bbox.y0 },
        });
      }
    });
  }
  return out;
}

/**
 * Scan Reader: recognised pages → Source segments with `area` (image
 * pixels), `confidence` and `uncertain` words. Same-sized lines in the same
 * ink form style groups; the body size reads as 16px.
 */
export function segmentOcrPages(
  pages: readonly OcrPage[],
  options: { id?: string; name?: string } = {},
): Source {
  const id = options.id ?? "s1";
  const placedPages = pages.map((page) => {
    const slope = pageSlope(page);
    return { page, slope, placed: placeLines(page, slope) };
  });

  const asPdf: PdfPageText[] = placedPages.map(({ page, placed }) => ({
    page: page.page,
    width: page.width,
    height: page.height,
    items: items(placed),
  }));
  let laid: Source;
  try {
    laid = segmentPdfPages(asPdf, { id, name: options.name ?? "Scan" });
  } catch (error) {
    if (error instanceof PdfWithoutTextError) throw new ImageWithoutTextError();
    throw error;
  }

  // Body size: the class most letters are set in.
  const letters = new Map<number, number>();
  for (const { placed } of placedPages) {
    for (const p of placed) letters.set(p.size, (letters.get(p.size) ?? 0) + p.line.text.length);
  }
  const body = [...letters].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;

  const segments = laid.segments.map((segment): SourceSegment => {
    const area = segment.area!;
    const at = placedPages.find((p) => p.page.page === area.page)!;
    const inside = at.placed.filter(
      (p) => p.x >= area.x && p.x <= area.x + area.width && p.y >= area.y && p.y <= area.y + area.height + p.size,
    );
    const chars = inside.reduce((n, p) => n + p.line.text.length, 0);
    const confidence =
      chars > 0 ? inside.reduce((n, p) => n + p.line.confidence * p.line.text.length, 0) / chars / 100 : 0;
    const uncertain = uncertainRanges(segment.text, inside);
    // Back to the tilted image: the straightened box, sheared back.
    const cx = at.page.width / 2;
    const a = at.slope * (area.x - cx);
    const b = at.slope * (area.x + area.width - cx);
    const { group: _group, ...rest } = segment;
    return {
      ...rest,
      look: lookFor(segment.look, body),
      area: {
        ...area,
        y: area.y + Math.min(a, b),
        height: area.height + Math.abs(b - a),
      },
      confidence: Math.round(confidence * 100) / 100,
      ...(uncertain.length > 0 ? { uncertain } : {}),
    };
  });

  return assignStyleGroups({ ...laid, format: "image", segments });
}
