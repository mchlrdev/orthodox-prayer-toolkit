import {
  assignStyleGroups,
  type SegmentLook,
  type Source,
  type SourceSegment,
} from "@orthodox-prayer-toolkit/core";

/**
 * PDF layout → Source segments, without pdf.js: text items become lines,
 * lines are sorted into columns, columns into paragraphs. A PDF has no line
 * break characters; a line that runs to the column edge continues with a
 * space (or, after a word-breaking hyphen, directly — the hyphen stays in
 * the segment and is marked to drop), a shorter line keeps its break.
 */

export type PdfTextItem = {
  str: string;
  /** Left edge and baseline, points from the page's top-left corner. */
  x: number;
  y: number;
  width: number;
  /** Font size in points. */
  size: number;
  /** Font name without the subset prefix (e.g. "Times-Bold"). */
  font: string;
  bold: boolean;
  italic: boolean;
  /** Ink colour when it is not black (the scan Reader measures it). */
  color?: string;
};

export type PdfPageText = {
  page: number;
  width: number;
  height: number;
  items: PdfTextItem[];
};

export class PdfWithoutTextError extends Error {
  constructor() {
    super(
      "This PDF has no text layer (it is a scan or images). Scans can be imported once image import is available.",
    );
    this.name = "PdfWithoutTextError";
  }
}

type Line = {
  items: PdfTextItem[];
  x0: number;
  x1: number;
  y: number;
  size: number;
  text: string;
  key: string;
  look: SegmentLook;
};

type Para = {
  lines: Line[];
  text: string;
  drop: Array<{ start: number; end: number }>;
  column: number | undefined;
  colLeft: number;
  colRight: number;
};

const FULL = -1;

function styleKey(item: PdfTextItem): string {
  return `${item.font}|${Math.round(item.size * 2) / 2}|${item.bold}|${item.italic}|${item.color ?? ""}`;
}

/** Look of the style most of the line's characters use. */
function dominant(items: PdfTextItem[]): { key: string; item: PdfTextItem } {
  const weight = new Map<string, { n: number; item: PdfTextItem }>();
  for (const it of items) {
    const k = styleKey(it);
    const n = it.str.replace(/\s/g, "").length;
    const cur = weight.get(k);
    if (cur) cur.n += n;
    else weight.set(k, { n, item: it });
  }
  let best: { key: string; item: PdfTextItem } | null = null;
  let bestN = -1;
  for (const [key, { n, item }] of weight) {
    if (n > bestN) {
      best = { key, item };
      bestN = n;
    }
  }
  return best!;
}

function lineText(items: PdfTextItem[]): string {
  let out = "";
  let prevEnd: number | null = null;
  for (const it of items) {
    if (prevEnd !== null) {
      const gap = it.x - prevEnd;
      const needsSpace =
        gap > it.size * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.str);
      if (needsSpace) out += " ";
    }
    out += it.str;
    prevEnd = it.x + it.width;
  }
  return out.replace(/[ \t ]+/g, (m) => (m.includes(" ") ? m : " ")).trim();
}

function makeLine(items: PdfTextItem[]): Line | null {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const text = lineText(sorted);
  if (!text) return null;
  const visible = sorted.filter((i) => i.str.trim() !== "");
  const { key, item } = dominant(visible);
  return {
    items: sorted,
    x0: Math.min(...visible.map((i) => i.x)),
    x1: Math.max(...visible.map((i) => i.x + i.width)),
    y: item.y,
    size: item.size,
    text,
    key,
    look: {
      font: item.font,
      size: `${Math.round(item.size * 2) / 2}pt`,
      weight: item.bold ? "bold" : "normal",
      style: item.italic ? "italic" : "normal",
      ...(item.color ? { color: item.color } : {}),
    },
  };
}

/** Items on one baseline, cut where a wide gap (a column gutter) opens. */
function pageLines(items: PdfTextItem[]): Line[] {
  const sorted = [...items]
    .filter((i) => i.str !== "")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (row && ref && Math.abs(it.y - ref.y) <= Math.min(it.size, ref.size) * 0.4) row.push(it);
    else rows.push([it]);
  }
  const lines: Line[] = [];
  for (const row of rows) {
    const byX = row.sort((a, b) => a.x - b.x);
    let part: PdfTextItem[] = [];
    let end: number | null = null;
    for (const it of byX) {
      if (end !== null && it.x - end > it.size * 2 && part.some((p) => p.str.trim())) {
        const line = makeLine(part);
        if (line) lines.push(line);
        part = [];
      }
      part.push(it);
      if (it.str.trim()) end = Math.max(end ?? 0, it.x + it.width);
    }
    const line = makeLine(part);
    if (line) lines.push(line);
  }
  return lines;
}

/** x of the gutter between two columns, when enough lines show one. */
function gutter(lines: Line[], pageWidth: number): number | null {
  const mids: number[] = [];
  const byRow = new Map<number, Line[]>();
  for (const l of lines) {
    const k = Math.round(l.y);
    byRow.set(k, [...(byRow.get(k) ?? []), l]);
  }
  for (const row of byRow.values()) {
    if (row.length !== 2) continue;
    const [a, b] = row.sort((p, q) => p.x0 - q.x0) as [Line, Line];
    const mid = (a.x1 + b.x0) / 2;
    if (mid > pageWidth * 0.25 && mid < pageWidth * 0.75) mids.push(mid);
  }
  if (mids.length < 3) return null;
  mids.sort((p, q) => p - q);
  return mids[Math.floor(mids.length / 2)]!;
}

function columnOf(line: Line, g: number | null): number | undefined {
  if (g === null) return undefined;
  if (line.x1 <= g + line.size * 0.5) return 0;
  if (line.x0 >= g - line.size * 0.5) return 1;
  return FULL;
}

/** Reading order: full-width lines cut the page into bands; per band, column by column. */
function readingOrder(lines: Line[], g: number | null): Array<{ line: Line; column: number | undefined }> {
  const tagged = lines
    .map((line) => ({ line, column: columnOf(line, g) }))
    .sort((a, b) => a.line.y - b.line.y);
  if (g === null) return tagged;
  const out: typeof tagged = [];
  let band: typeof tagged = [];
  const flush = () => {
    for (const col of [0, 1]) out.push(...band.filter((t) => t.column === col));
    band = [];
  };
  for (const t of tagged) {
    if (t.column === FULL) {
      flush();
      out.push({ line: t.line, column: undefined });
    } else band.push(t);
  }
  flush();
  return out;
}

const WORD_BREAK = /\p{L}[-­]$/u;

function paragraphs(page: PdfPageText): Para[] {
  const lines = pageLines(page.items);
  const g = gutter(lines, page.width);
  const ordered = readingOrder(lines, g);

  // Column edges from the body lines of each column (page numbers and
  // short headings would push the right edge out).
  const edges = new Map<number | undefined, { left: number; right: number }>();
  for (const body of [true, false]) {
    for (const { line, column } of ordered) {
      if (body && line.text.length < 20) continue;
      if (!body && edges.has(column)) continue;
      const e = edges.get(column);
      if (e) {
        e.left = Math.min(e.left, line.x0);
        e.right = Math.max(e.right, line.x1);
      } else edges.set(column, { left: line.x0, right: line.x1 });
    }
  }

  const paras: Para[] = [];
  let cur: Para | null = null;
  let prev: Line | null = null;
  let prevColumn: number | undefined | null = null;

  for (const { line, column } of ordered) {
    const edge = edges.get(column)!;
    const indented = line.x0 > edge.left + line.size * 0.8;
    const centered =
      Math.abs((line.x0 + line.x1) / 2 - (edge.left + edge.right) / 2) < line.size &&
      line.x0 > edge.left + line.size * 2;
    let startNew = cur === null || prev === null || column !== prevColumn;
    if (!startNew && prev) {
      const gap = line.y - prev.y;
      const prevIndented = prev.x0 > edge.left + prev.size * 0.8;
      startNew =
        line.key !== prev.key ||
        gap > Math.max(line.size, prev.size) * 1.6 ||
        gap < 0 ||
        (indented && !prevIndented && !centered);
    }
    if (startNew || !cur || !prev) {
      cur = {
        lines: [line],
        text: line.text,
        drop: [],
        column,
        colLeft: edge.left,
        colRight: edge.right,
      };
      paras.push(cur);
    } else {
      const wrapped = prev.x1 >= edge.right - prev.size * 3 && !centered;
      if (wrapped && WORD_BREAK.test(cur.text) && /^\p{Ll}/u.test(line.text)) {
        cur.drop.push({ start: cur.text.length - 1, end: cur.text.length });
        cur.text += line.text;
      } else if (wrapped && /[-­]$/.test(cur.text)) {
        cur.text += line.text;
      } else {
        cur.text += (wrapped ? " " : "\n") + line.text;
      }
      cur.lines.push(line);
    }
    prev = line;
    prevColumn = column;
  }
  return paras;
}

function looseKey(text: string): string {
  return text.toLowerCase().replace(/[\divxlc]+/g, "#").replace(/\s+/g, " ").trim();
}

/** Every page → segments, with running heads and page numbers marked. */
export function segmentPdfPages(
  pages: readonly PdfPageText[],
  options: { id?: string; name?: string } = {},
): Source {
  const id = options.id ?? "s1";
  const chars = pages.reduce(
    (n, p) => n + p.items.reduce((m, i) => m + i.str.replace(/\s/g, "").length, 0),
    0,
  );
  if (chars < 10) throw new PdfWithoutTextError();

  type Found = { page: PdfPageText; para: Para; edge: boolean };
  const found: Found[] = [];
  for (const page of pages) {
    for (const para of paragraphs(page)) {
      const top = Math.min(...para.lines.map((l) => l.y - l.size));
      const bottom = Math.max(...para.lines.map((l) => l.y));
      const edge = bottom < page.height * 0.09 || top > page.height * 0.91;
      found.push({ page, para, edge });
    }
  }

  // Running heads: the same text (numbers aside) at a page edge on many pages.
  const edgeCounts = new Map<string, Set<number>>();
  for (const f of found) {
    if (!f.edge) continue;
    const k = looseKey(f.para.text);
    edgeCounts.set(k, (edgeCounts.get(k) ?? new Set()).add(f.page.page));
  }
  const repeatAt = Math.max(2, Math.ceil(pages.length * 0.3));

  const segments: SourceSegment[] = found.map(({ page, para, edge }, i) => {
    const first = para.lines[0]!;
    const x0 = Math.min(...para.lines.map((l) => l.x0));
    const x1 = Math.max(...para.lines.map((l) => l.x1));
    const top = Math.min(...para.lines.map((l) => l.y - l.size * 0.85));
    const bottom = Math.max(...para.lines.map((l) => l.y + l.size * 0.25));
    const look: SegmentLook = { ...first.look };
    const mid = (para.colLeft + para.colRight) / 2;
    const centered = para.lines.every(
      (l) => l.x0 > para.colLeft + l.size * 2 && Math.abs((l.x0 + l.x1) / 2 - mid) < l.size * 2,
    );
    if (centered) {
      look.align = "center";
    } else {
      // Whole-paragraph indent (not the first-line indent), in ems.
      const rest = para.lines.slice(1);
      const blockLeft = rest.length > 0 ? Math.min(...rest.map((l) => l.x0)) : first.x0;
      const indent = Math.round((blockLeft - para.colLeft) / first.size);
      if (indent >= 2) look.indent = indent;
    }
    const furniture =
      edge &&
      (/^[\divxlcIVXLC.\-–\s]+$/.test(para.text) ||
        (edgeCounts.get(looseKey(para.text))?.size ?? 0) >= repeatAt);
    return {
      id: `${id}-${i + 1}`,
      text: para.text,
      look,
      area: {
        page: page.page,
        x: x0,
        y: top,
        width: x1 - x0,
        height: bottom - top,
        ...(para.column !== undefined ? { column: para.column } : {}),
      },
      ...(para.drop.length > 0 ? { drop: para.drop } : {}),
      ...(furniture ? { furniture: true as const } : {}),
    };
  });

  return assignStyleGroups({
    id,
    format: "pdf",
    name: options.name ?? "PDF",
    segments,
  });
}
