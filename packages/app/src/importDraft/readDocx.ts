import {
  assignStyleGroups,
  type SegmentLook,
  type SegmentMark,
  type Source,
  type SourceSegment,
} from "@orthodox-prayer-toolkit/core";

/**
 * Word Reader: a .docx → Source segments. One segment per paragraph of the
 * body (table cells too, with their column); line breaks inside a paragraph
 * are kept. The look is the paragraph style plus the run formatting that
 * covers most of the text; runs that look different become `marks`.
 * Headers, footers, footnotes and deleted (tracked) text are not read.
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export type DocxParts = {
  /** word/document.xml */
  document: string;
  /** word/styles.xml, when the file has one. */
  styles?: string | null;
};

export type ReadDocxOptions = {
  id?: string;
  name?: string;
};

/** Run formatting; `undefined` = not set at this level. */
type RunProps = {
  bold?: boolean;
  italic?: boolean;
  /** Points. */
  size?: number;
  color?: string;
  caps?: boolean;
  underline?: boolean;
  lang?: string;
};

type StyleDef = {
  name: string;
  basedOn?: string;
  align?: string;
  run: RunProps;
};

type Styles = {
  byId: Map<string, StyleDef>;
  defaults: RunProps;
  defaultParagraph?: string;
};

export class DocxWithoutDocumentError extends Error {
  constructor() {
    super("This is not a Word document (word/document.xml is missing)");
  }
}

function children(el: Element, local?: string): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.namespaceURI === W && (!local || c.localName === local)) out.push(c);
  }
  return out;
}

function child(el: Element | null | undefined, local: string): Element | null {
  if (!el) return null;
  return children(el, local)[0] ?? null;
}

function val(el: Element | null): string | null {
  return el ? el.getAttributeNS(W, "val") ?? el.getAttribute("w:val") : null;
}

/** `<w:b/>` is on; `w:val="0|false|off|none"` is off. */
function toggle(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const v = val(el);
  return !(v === "0" || v === "false" || v === "off" || v === "none");
}

function readRunProps(rPr: Element | null): RunProps {
  if (!rPr) return {};
  const props: RunProps = {};
  const bold = toggle(child(rPr, "b"));
  if (bold !== undefined) props.bold = bold;
  const italic = toggle(child(rPr, "i"));
  if (italic !== undefined) props.italic = italic;
  const caps = toggle(child(rPr, "caps")) ?? toggle(child(rPr, "smallCaps"));
  if (caps !== undefined) props.caps = caps;
  const u = child(rPr, "u");
  if (u) props.underline = val(u) !== "none";
  const sz = Number(val(child(rPr, "sz")));
  if (Number.isFinite(sz) && sz > 0) props.size = sz / 2;
  const color = val(child(rPr, "color"));
  if (color && color !== "auto") props.color = `#${color.toLowerCase()}`;
  else if (color === "auto") props.color = "auto";
  const lang = val(child(rPr, "lang"));
  if (lang) props.lang = lang;
  return props;
}

function over(base: RunProps, top: RunProps): RunProps {
  const out: RunProps = { ...base };
  for (const [k, v] of Object.entries(top)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("The Word document is damaged (its XML cannot be read)");
  }
  return doc;
}

function readStyles(xml: string | null | undefined): Styles {
  const styles: Styles = { byId: new Map(), defaults: {} };
  if (!xml) return styles;
  const root = parseXml(xml).documentElement;
  const docDefaults = child(root, "docDefaults");
  // Language of the defaults is the editor's setting, not the text's: left out.
  const { lang: _lang, ...defaults } = readRunProps(child(child(docDefaults, "rPrDefault"), "rPr"));
  styles.defaults = defaults;
  for (const el of children(root, "style")) {
    const id = el.getAttributeNS(W, "styleId") ?? el.getAttribute("w:styleId");
    if (!id) continue;
    const def: StyleDef = {
      name: val(child(el, "name")) ?? id,
      run: readRunProps(child(el, "rPr")),
    };
    const basedOn = val(child(el, "basedOn"));
    if (basedOn) def.basedOn = basedOn;
    const jc = val(child(child(el, "pPr"), "jc"));
    if (jc) def.align = jc;
    styles.byId.set(id, def);
    const type = el.getAttributeNS(W, "type") ?? el.getAttribute("w:type");
    const isDefault = el.getAttributeNS(W, "default") ?? el.getAttribute("w:default");
    if (type === "paragraph" && (isDefault === "1" || isDefault === "true")) {
      styles.defaultParagraph = id;
    }
  }
  return styles;
}

/** A style with its `basedOn` chain applied (base first). */
function resolveStyle(styles: Styles, id: string | undefined): { run: RunProps; align?: string; name?: string } {
  const chain: StyleDef[] = [];
  const seen = new Set<string>();
  for (let cur = id; cur && !seen.has(cur); ) {
    seen.add(cur);
    const def = styles.byId.get(cur);
    if (!def) break;
    chain.unshift(def);
    cur = def.basedOn;
  }
  let run: RunProps = {};
  let align: string | undefined;
  for (const def of chain) {
    run = over(run, def.run);
    if (def.align) align = def.align;
  }
  return { run, align, name: chain[chain.length - 1]?.name };
}

function alignName(jc: string | undefined): string | undefined {
  if (!jc) return undefined;
  if (jc === "both" || jc === "distribute") return "justify";
  if (jc === "start") return "left";
  if (jc === "end") return "right";
  return jc;
}

/** Look of a run's text: what the segment and its marks compare. */
function runLook(p: RunProps): SegmentLook {
  const look: SegmentLook = {
    weight: p.bold ? "bold" : "normal",
    style: p.italic ? "italic" : "normal",
  };
  if (p.size !== undefined) look.size = `${p.size}pt`;
  if (p.color && p.color !== "auto" && p.color !== "#000000") look.color = p.color;
  if (p.caps) look.caps = true;
  if (p.underline) look.underline = true;
  return look;
}

function sameLook(a: SegmentLook, b: SegmentLook): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

type Piece = { text: string; look: SegmentLook; lang?: string };

/** Text pieces of a paragraph, in order, with each run's resolved look. */
function paragraphPieces(p: Element, styles: Styles, base: RunProps): Piece[] {
  const pieces: Piece[] = [];
  const run = (r: Element) => {
    const charStyle = val(child(child(r, "rPr"), "rStyle"));
    const props = over(over(base, charStyle ? resolveStyle(styles, charStyle).run : {}), readRunProps(child(r, "rPr")));
    const look = runLook(props);
    let text = "";
    for (const c of children(r)) {
      switch (c.localName) {
        case "t":
          text += c.textContent ?? "";
          break;
        case "tab":
        case "ptab":
          text += "\t";
          break;
        case "br":
        case "cr":
          text += "\n";
          break;
        case "noBreakHyphen":
          text += "‑";
          break;
        // softHyphen, instrText, delText, footnote references: not shown text.
      }
    }
    if (text) pieces.push({ text, look, ...(props.lang ? { lang: props.lang } : {}) });
  };
  const walk = (el: Element) => {
    for (const c of children(el)) {
      if (c.localName === "r") run(c);
      // Runs inside links, insertions, fields, content controls, smart tags.
      else if (!["pPr", "rPr", "del", "moveFrom", "proofErr", "bookmarkStart", "bookmarkEnd"].includes(c.localName)) {
        walk(c);
      }
    }
  };
  walk(p);
  return pieces;
}

/** Tabs to spaces; trim each line; drop empty lines. Keeps `marks` aligned. */
function cleanPieces(pieces: Piece[]): { text: string; chars: Array<SegmentLook> } {
  // Per character so trimming keeps every character's look.
  const chars: Array<{ ch: string; look: SegmentLook }> = [];
  for (const piece of pieces) {
    for (const ch of piece.text) chars.push({ ch: ch === "\t" ? " " : ch, look: piece.look });
  }
  const lines: Array<typeof chars> = [[]];
  for (const c of chars) {
    if (c.ch === "\n") lines.push([]);
    else lines[lines.length - 1]!.push(c);
  }
  const kept: typeof chars = [];
  for (const line of lines) {
    // Collapse runs of spaces, trim both ends.
    const collapsed: typeof chars = [];
    for (const c of line) {
      if (c.ch === " " && (collapsed.length === 0 || collapsed[collapsed.length - 1]!.ch === " ")) continue;
      collapsed.push(c);
    }
    while (collapsed.length > 0 && collapsed[collapsed.length - 1]!.ch === " ") collapsed.pop();
    if (collapsed.length === 0) continue;
    if (kept.length > 0) kept.push({ ch: "\n", look: collapsed[0]!.look });
    kept.push(...collapsed);
  }
  return { text: kept.map((c) => c.ch).join(""), chars: kept.map((c) => c.look) };
}

/** Look covering most letters; the others become marks. */
function segmentMarks(text: string, chars: SegmentLook[]): { look: SegmentLook; marks: SegmentMark[] } {
  const weights: Array<{ look: SegmentLook; n: number }> = [];
  [...text].forEach((ch, i) => {
    if (/\s/.test(ch)) return;
    const look = chars[i]!;
    const hit = weights.find((w) => sameLook(w.look, look));
    if (hit) hit.n += 1;
    else weights.push({ look, n: 1 });
  });
  const main = weights.reduce((a, b) => (b.n > a.n ? b : a), weights[0]!).look;
  // Offsets in UTF-16 units, like the rest of the span model.
  const marks: SegmentMark[] = [];
  let offset = 0;
  let open: SegmentMark | null = null;
  [...text].forEach((ch, i) => {
    const look = chars[i]!;
    const space = /\s/.test(ch);
    const differs = !sameLook(look, main);
    if (open && !space && !sameLook(open.look, look)) {
      marks.push(open);
      open = null;
    }
    if (!open && differs && !space) open = { start: offset, end: offset, look };
    offset += ch.length;
    if (open && !space) open.end = offset;
  });
  if (open) marks.push(open);
  return { look: main, marks };
}

/** Parse the XML parts of a .docx into a Source. */
export function readDocxXml(parts: DocxParts, options: ReadDocxOptions = {}): Source {
  const id = options.id ?? "s1";
  const styles = readStyles(parts.styles);
  const root = parseXml(parts.document).documentElement;
  const body = child(root, "body");
  const segments: SourceSegment[] = [];

  const paragraph = (p: Element, column?: number) => {
    const pPr = child(p, "pPr");
    const styleId = val(child(pPr, "pStyle")) ?? styles.defaultParagraph;
    const style = resolveStyle(styles, styleId);
    const pieces = paragraphPieces(p, styles, over(styles.defaults, style.run));
    const { text, chars } = cleanPieces(pieces);
    if (!/\S/.test(text)) return;
    const { look: main, marks } = segmentMarks(text, chars);
    const look: SegmentLook = {};
    if (style.name) look.paragraphStyle = style.name;
    Object.assign(look, main);
    const align = alignName(val(child(pPr, "jc")) ?? style.align);
    if (align && align !== "left") look.align = align;
    if (column !== undefined) look.column = column;
    const langs = new Map<string, number>();
    for (const piece of pieces) if (piece.lang) langs.set(piece.lang, (langs.get(piece.lang) ?? 0) + piece.text.length);
    const lang = [...langs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? style.run.lang;
    segments.push({
      id: `${id}-${segments.length + 1}`,
      text,
      look,
      ...(lang ? { lang } : {}),
      ...(marks.length > 0 ? { marks } : {}),
    });
  };

  const block = (el: Element, column?: number) => {
    for (const c of children(el)) {
      if (c.localName === "p") paragraph(c, column);
      else if (c.localName === "tbl") table(c);
      else if (c.localName === "sdt") block(child(c, "sdtContent") ?? c, column);
      else if (c.localName === "customXml" || c.localName === "ins") block(c, column);
    }
  };

  // Row by row; each cell's paragraphs carry the cell's column (1-based).
  const table = (tbl: Element) => {
    for (const tr of children(tbl, "tr")) {
      let column = 0;
      for (const tc of children(tr, "tc")) {
        column += 1;
        block(tc, column);
        const span = Number(val(child(child(tc, "tcPr"), "gridSpan")));
        if (Number.isFinite(span) && span > 1) column += span - 1;
      }
    }
  };

  if (body) block(body);
  return assignStyleGroups({
    id,
    format: "docx",
    name: options.name ?? "Word document",
    segments,
  });
}

/** Unzip a .docx and read it. */
export async function readDocx(data: Uint8Array, options: ReadDocxOptions = {}): Promise<Source> {
  const { default: JSZip } = await import("jszip");
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new DocxWithoutDocumentError();
  }
  const document = await zip.file("word/document.xml")?.async("string");
  if (!document) throw new DocxWithoutDocumentError();
  const styles = (await zip.file("word/styles.xml")?.async("string")) ?? null;
  return readDocxXml({ document, styles }, options);
}
