/**
 * Sources and Source segments: what a Reader hands to the import. A Reader
 * splits a Source into segments without understanding its content; the text
 * of a segment is verbatim and never changed afterwards.
 */

export type SourceFormat = "text" | "html" | "pdf" | "docx" | "image";

/**
 * Appearance of a segment as the Reader saw it (font size, weight, colour,
 * indent, …). Empty when the format has no appearance, e.g. pasted text.
 */
export type SegmentLook = Record<string, string | number | boolean>;

export type SourceSegment = {
  /** Unique within the Import draft. */
  id: string;
  /** Verbatim source text; line breaks inside the segment are kept. */
  text: string;
  /** Offsets of `text` in `Source.text`, when the Source has a flat text. */
  start?: number;
  end?: number;
  look: SegmentLook;
  /** Style group id ({@link assignStyleGroups}); absent when `look` is empty. */
  group?: string;
  /** Language hint from the Reader (column, `lang` attribute). */
  lang?: string;
  /** Where the segment sits on a page, origin top-left: points (PDF) or image pixels (scan). */
  area?: SegmentArea;
  /**
   * Ranges of `text` the Reader suggests leaving out of the block, e.g. a
   * hyphen where a word was broken across lines. The text itself keeps
   * them; the first draft skips them (and the user can see why).
   */
  drop?: Array<{ start: number; end: number }>;
  /** Running head, page number, footer: excluded in the first draft. */
  furniture?: true;
  /**
   * Inline runs of `text` that look different from the segment (a red or
   * bold word inside a paragraph): hints for Note runs. Sorted, disjoint.
   */
  marks?: SegmentMark[];
  /** Text recognition (scans): how sure it was overall, 0–1. */
  confidence?: number;
  /** Text recognition: words of `text` read with low confidence. Sorted, disjoint. */
  uncertain?: UncertainRange[];
};

export type UncertainRange = {
  start: number;
  end: number;
  /** 0–1. */
  confidence?: number;
  /** Where the word sits on the page, in the units of `area`. */
  box?: { x: number; y: number; width: number; height: number };
};

export type SegmentMark = { start: number; end: number; look: SegmentLook };

export type SegmentArea = {
  /** 1-based page number. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Text column on the page (0 = first), when the page has several. */
  column?: number;
};

export type Source = {
  id: string;
  format: SourceFormat;
  /** File name, URL or "Pasted text". */
  name: string;
  /** Full text of a text Source; its segments slice it. */
  text?: string;
  /** A web page's own title and site name (`<title>`, `og:title`, `og:site_name`). */
  page?: { title?: string; siteName?: string };
  segments: SourceSegment[];
};

export type ReadTextOptions = {
  id?: string;
  name?: string;
};

const LINE_BREAK = /\r\n|\r|\n/g;

/**
 * Text Reader: one segment per paragraph (lines separated by blank lines).
 * Lossless: `text.slice(seg.start, seg.end) === seg.text`, and everything
 * between segments is whitespace.
 */
export function readText(text: string, options: ReadTextOptions = {}): Source {
  const id = options.id ?? "s1";
  const lines: Array<{ start: number; end: number }> = [];
  let from = 0;
  for (const match of text.matchAll(LINE_BREAK)) {
    lines.push({ start: from, end: match.index });
    from = match.index + match[0].length;
  }
  lines.push({ start: from, end: text.length });

  const segments: SourceSegment[] = [];
  let para: { start: number; end: number } | null = null;
  const close = () => {
    if (!para) return;
    segments.push({
      id: `${id}-${segments.length + 1}`,
      text: text.slice(para.start, para.end),
      start: para.start,
      end: para.end,
      look: {},
    });
    para = null;
  };

  for (const line of lines) {
    const content = text.slice(line.start, line.end);
    const lead = content.search(/\S/);
    if (lead === -1) {
      close();
      continue;
    }
    const trail = content.length - (content.match(/\s*$/)?.[0].length ?? 0);
    if (para) {
      para.end = line.start + trail;
    } else {
      para = { start: line.start + lead, end: line.start + trail };
    }
  }
  close();

  return {
    id,
    format: "text",
    name: options.name ?? "Pasted text",
    text,
    segments,
  };
}

function lookFingerprint(look: SegmentLook): string | null {
  const keys = Object.keys(look).sort();
  if (keys.length === 0) return null;
  return JSON.stringify(keys.map((k) => [k, look[k]]));
}

/**
 * Put segments with the same look into one style group (`{sourceId}-g{n}`,
 * numbered in order of first appearance). Segments without a look get none.
 */
export function assignStyleGroups(source: Source): Source {
  const groups = new Map<string, string>();
  const segments = source.segments.map((segment) => {
    const { group: _group, ...rest } = segment;
    const print = lookFingerprint(segment.look);
    if (print === null) return rest;
    let group = groups.get(print);
    if (!group) {
      group = `${source.id}-g${groups.size + 1}`;
      groups.set(print, group);
    }
    return { ...rest, group };
  });
  return { ...source, segments };
}

function lookSize(look: SegmentLook): number | null {
  const n = typeof look.size === "string" ? Number.parseFloat(look.size) : typeof look.size === "number" ? look.size : NaN;
  return Number.isFinite(n) ? n : null;
}

const TITLE_PARTS = /\s+[|–—·•:»/-]\s+|\s+-\s+/u;
const fold = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A title to start with. A web page names the prayer in its own title, next
 * to the site's name ("Vaterunser – Orthodoxe Gemeinde"): the heading that
 * matches the page title wins, and the site's name (a banner heading on
 * every page) is never the title. Else the first heading-like segment near
 * the top (an h1–h3, or clearly larger than the body text), else a short
 * first line. Undefined when nothing reads like a title.
 */
export function suggestTitle(source: Source): string | undefined {
  const segments = source.segments.filter((s) => !s.furniture && s.text.trim());
  // A footnote mark is no part of the title ("УТРЕННИЕ МОЛИТВЫ[1]").
  const clean = (text: string) => text.replace(/\s*(\[\d{1,3}\]|[¹²³⁴⁵⁶⁷⁸⁹⁰]+|\*)\s*$/u, "").replace(/\s+/g, " ").trim();
  const short = (text: string) => clean(text).length <= 80;

  const pageTitle = source.page?.title ? clean(source.page.title) : "";
  const parts = pageTitle ? pageTitle.split(TITLE_PARTS).map(clean).filter(Boolean) : [];
  const site = new Set<string>();
  if (source.page?.siteName) site.add(fold(source.page.siteName));
  // "Prayer – Site": the part shared with the site name, or the last part.
  if (parts.length > 1) {
    const known = parts.find((p) => site.has(fold(p)));
    site.add(fold(known ?? parts[parts.length - 1]!));
  }
  const isSite = (text: string) => site.has(fold(text));

  const counts = new Map<number, number>();
  for (const s of segments) {
    const size = lookSize(s.look);
    if (size !== null) counts.set(size, (counts.get(size) ?? 0) + s.text.length);
  }
  let body: number | null = null;
  for (const [size, n] of counts) if (body === null || n > counts.get(body)!) body = size;
  const headingLike = (s: SourceSegment) => {
    if (!short(s.text) || isSite(s.text)) return false;
    const tag = typeof s.look.tag === "string" ? s.look.tag : "";
    const size = lookSize(s.look);
    return /^h[1-3]$/i.test(tag) || (size !== null && body !== null && size >= body * 1.15);
  };

  if (pageTitle) {
    const wanted = parts.filter((p) => !isSite(p)).map(fold);
    const matches = segments.slice(0, 40).filter((s) => short(s.text) && wanted.includes(fold(clean(s.text))));
    // "Common Prayers - Morning Prayers - OCA": the part the page shows as its heading.
    const match = matches.find((s) => /^h[1-3]$/i.test(typeof s.look.tag === "string" ? s.look.tag : "")) ?? matches[0];
    if (match) return clean(match.text);
  }
  const heading = segments.slice(0, 8).find(headingLike);
  if (heading) return clean(heading.text);
  // A short first line of the text itself beats a page title that may only name the site.
  const first = segments.length > 0 ? clean(segments[0]!.text) : "";
  const firstOk = first.length > 0 && first.length <= 60 && !/[.:;,]$/.test(first) && !isSite(first);
  if (firstOk && (parts.length <= 1 || !pageTitle)) return first;
  if (pageTitle) {
    const own = parts.find((p) => !isSite(p));
    if (own && own.length <= 80) return own;
  }
  return firstOk ? first : undefined;
}
