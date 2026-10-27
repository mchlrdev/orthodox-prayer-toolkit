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
  /** Where the segment sits on a page (PDF, scan): points, origin top-left. */
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
