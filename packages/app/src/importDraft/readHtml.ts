import {
  assignStyleGroups,
  type SegmentLook,
  type Source,
  type SourceSegment,
} from "@orthodox-prayer-toolkit/core";

/**
 * HTML Reader: a page → Source segments with their look. One segment per
 * block element's own text (paragraph, heading, list item, table cell …);
 * `<br>` keeps a line break inside the segment. Every visible character
 * ends up in a segment; whitespace is collapsed the way the browser shows it.
 */

export type ElementInfo = {
  /** Not shown (display:none, script, …): its text is skipped. */
  hidden: boolean;
  /** Starts its own segment (block, list-item, table cell …). */
  block: boolean;
  /** Keeps whitespace and line breaks (pre, pre-wrap …). */
  pre: boolean;
  /** Text styling of the element (weight, style, size, colour, align). */
  look: SegmentLook;
};

export type ElementInfoFn = (el: Element) => ElementInfo;

export type ReadHtmlOptions = {
  id?: string;
  name?: string;
  /** The page's title and site name; read from the document when left out. */
  page?: Source["page"];
};

/** `<title>`, `og:title` and `og:site_name` of a page (before sanitizing drops the head). */
export function pageInfo(doc: Document): NonNullable<Source["page"]> {
  const meta = (name: string) =>
    doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute("content")?.trim() || undefined;
  const title = doc.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim() || meta("og:title") || meta("twitter:title");
  const siteName = meta("og:site_name") || meta("application-name");
  return { ...(title ? { title } : {}), ...(siteName ? { siteName } : {}) };
}

const NEVER_SHOWN = new Set([
  "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEAD", "TITLE", "META", "LINK",
  "BASE", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED", "SVG", "CANVAS",
  "VIDEO", "AUDIO", "IMG", "PICTURE", "SOURCE", "TRACK", "INPUT", "SELECT",
  "TEXTAREA", "OPTION", "DATALIST",
]);

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BODY", "CAPTION", "CENTER",
  "DD", "DETAILS", "DIALOG", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION",
  "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER",
  "HGROUP", "HR", "LEGEND", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
  "SUMMARY", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

const UNSAFE_ELEMENTS =
  "script, iframe, frame, frameset, object, embed, link, base, meta, noscript, " +
  "img, picture, video, audio, source, track, svg, canvas, input, select, textarea, form";

/** Drop everything that could run, load or submit; keep text and inline styles. */
export function sanitizeHtml(doc: Document): void {
  for (const el of [...doc.querySelectorAll(UNSAFE_ELEMENTS)]) {
    // A form's text stays; only its element goes.
    if (el.tagName === "FORM") el.replaceWith(...el.childNodes);
    else el.remove();
  }
  for (const el of [...doc.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "src" ||
        name === "srcset" ||
        name === "action" ||
        name === "formaction" ||
        name === "href" ||
        name === "xlink:href" ||
        name === "srcdoc"
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

function styleValue(el: Element, prop: string): string | null {
  const style = el.getAttribute("style");
  if (!style) return null;
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i").exec(style);
  return m?.[1]?.trim().toLowerCase() ?? null;
}

/**
 * Look without layout: from tags (b, i, h1 …) and inline styles on the
 * element and its ancestors. For tests and as a fallback.
 */
export const staticElementInfo: ElementInfoFn = (el) => {
  const display = styleValue(el, "display");
  const hidden =
    NEVER_SHOWN.has(el.tagName) || el.hasAttribute("hidden") || display === "none";
  const block = display
    ? !display.startsWith("inline") && display !== "contents"
    : BLOCK_TAGS.has(el.tagName);
  const ws = styleValue(el, "white-space");
  const pre = el.tagName === "PRE" || (ws !== null && ws.startsWith("pre"));

  let weight = "normal";
  let style = "normal";
  let size: string | null = null;
  let color: string | null = null;
  let align: string | null = null;
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const tag = cur.tagName;
    if (weight === "normal") {
      const w = styleValue(cur, "font-weight");
      if (w) weight = w === "bold" || Number(w) >= 600 ? "bold" : "normal";
      else if (/^(B|STRONG|H[1-6]|TH)$/.test(tag)) weight = "bold";
    }
    if (style === "normal") {
      const s = styleValue(cur, "font-style");
      if (s) style = s;
      else if (/^(I|EM|CITE|VAR)$/.test(tag)) style = "italic";
    }
    size ??= styleValue(cur, "font-size") ?? (/^H[1-6]$/.test(tag) ? tag.toLowerCase() : null);
    color ??= styleValue(cur, "color");
    align ??= styleValue(cur, "text-align") ?? cur.getAttribute("align");
  }
  const look: SegmentLook = { weight, style };
  if (size) look.size = size;
  if (color) look.color = color;
  if (align) look.align = align;
  return { hidden, block, pre, look };
};

/** Look from the browser's computed styles (the page laid out in a frame). */
export function computedElementInfo(win: Window): ElementInfoFn {
  return (el) => {
    const cs = win.getComputedStyle(el);
    const display = cs.display;
    const hidden =
      NEVER_SHOWN.has(el.tagName) || display === "none" || cs.visibility === "hidden";
    const block = !display.startsWith("inline") && display !== "contents";
    const pre = cs.whiteSpace.startsWith("pre") || cs.whiteSpace === "break-spaces";
    const look: SegmentLook = {
      weight: Number(cs.fontWeight) >= 600 || cs.fontWeight === "bold" ? "bold" : "normal",
      style: cs.fontStyle,
      size: cs.fontSize,
      color: cs.color,
      align: cs.textAlign,
    };
    return { hidden, block, pre, look };
  };
}

/** Collapse whitespace per line, trim lines, drop empty ones. */
function cleanSegmentText(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/[ \t\r\f]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

function containerLook(el: Element): SegmentLook {
  const look: SegmentLook = { tag: el.tagName.toLowerCase() };
  const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).sort().join(" ");
  if (cls) look.class = cls;
  return look;
}

const CHROME_TAGS = new Set(["NAV", "HEADER", "FOOTER", "ASIDE", "FORM", "MENU"]);
const CHROME_ROLES = /^(navigation|banner|contentinfo|search|menu|menubar|complementary)$/i;
const CHROME_NAMES = /(^|[\s_-])(nav|navbar|navigation|menu|mainmenu|submenu|menue|footer|sidebar|breadcrumbs?|cookies?|consent|site-?header|header|topbar|widget|widgets|share|social|skip-?link)([\s_-]|$)/i;
const CONTENT_NAMES = /(^|[\s_-])(content|entry|post|article|main|text|prayer)([\s_-]|$)/i;

/**
 * Site chrome, not the page's text: inside nav/header/footer/aside/form, a
 * landmark role, or a container named like a menu, footer or sidebar —
 * unless a main/article (or a container named "content") comes first on the
 * way up. A link inside a list item is a menu entry.
 */
function chromeOf(el: Element): boolean {
  let linkInList = false;
  let inLink = false;
  for (let e: Element | null = el; e && e.tagName !== "BODY"; e = e.parentElement) {
    if (e.tagName === "MAIN" || e.tagName === "ARTICLE" || /^main$/i.test(e.getAttribute("role") ?? "")) return false;
    if (e.tagName === "A") inLink = true;
    if (e.tagName === "LI" && inLink) linkInList = true;
    if (CHROME_TAGS.has(e.tagName) || CHROME_ROLES.test(e.getAttribute("role") ?? "")) return true;
    const names = `${e.getAttribute("id") ?? ""} ${e.getAttribute("class") ?? ""}`;
    if (CONTENT_NAMES.test(names) && !CHROME_NAMES.test(names)) return linkInList;
    if (CHROME_NAMES.test(names)) return true;
  }
  return linkInList;
}

/** The page's main text: one main/article holding most of the words. */
function mainOf(doc: Document): Element | null {
  const candidates = [...doc.querySelectorAll("main, article, [role=main]")];
  if (candidates.length !== 1) return null;
  const all = (doc.body?.textContent ?? "").replace(/\s+/g, "").length;
  const own = (candidates[0]!.textContent ?? "").replace(/\s+/g, "").length;
  return all > 0 && own / all >= 0.25 ? candidates[0]! : null;
}

/** Lines a site prints around every page: server warnings, search boxes, menu toggles. */
const CHROME_TEXT =
  /^((notice|warning|deprecated|fatal error|parse error): .+ (in|on line) |(suchen nach|search for|suche)\s*:|(primary|main|haupt)\s*(menu|menü|navigation)$|(skip|jump) to (content|main)|zum inhalt (springen|wechseln)|menü$|menu$|toggle navigation|(read|weiter)lesen|teilen auf|share on|cookie|©|copyright)/iu;

const SENTENCE_END = /[.!?;·»”“"…)\]]$/u;
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
/** A short line without closing punctuation: "Psalm 50", "ΣΤΑΣΙΣ ΠΡΩΤΗ", "1. Ikos". */
const titleLine = (text: string) => {
  const t = flat(text);
  return t.length > 0 && t.length <= 60 && !SENTENCE_END.test(t) && !/[,:]$/.test(t);
};

/**
 * Inside one block element, does a single line break start a new paragraph?
 * Yes when the look changes (a red "1. Kondakion"), around a title line,
 * and between long lines that end a sentence (prose set line by line). Short
 * lines of verse stay together.
 */
function lineBreakStartsParagraph(prev: { text: string; key: string }, line: { text: string; key: string }): boolean {
  if (prev.key !== line.key) return true;
  const a = flat(prev.text);
  const b = flat(line.text);
  if (titleLine(a) && b.length > 60) return true;
  if (titleLine(b) && a.length > 60 && SENTENCE_END.test(a)) return true;
  return SENTENCE_END.test(a) && (a.length > 90 || b.length > 90);
}

/** Walk a (sanitized) document into a Source. */
export function readHtmlDocument(
  doc: Document,
  info: ElementInfoFn = staticElementInfo,
  options: ReadHtmlOptions = {},
): Source {
  const id = options.id ?? "s1";
  const segments: SourceSegment[] = [];
  const cache = new Map<Element, ElementInfo>();
  const infoOf = (el: Element) => {
    let hit = cache.get(el);
    if (!hit) {
      hit = info(el);
      cache.set(el, hit);
    }
    return hit;
  };

  const main = mainOf(doc);
  const chrome = new Map<Element, boolean>();
  const isChrome = (el: Element) => {
    let hit = chrome.get(el);
    if (hit === undefined) {
      hit = main ? !main.contains(el) : chromeOf(el);
      chrome.set(el, hit);
    }
    return hit;
  };

  let block: Element = doc.body ?? doc.documentElement;
  /** Text of the current block element, with the element each piece sits in (null: a line break). */
  let runs: Array<{ text: string; el: Element | null }> = [];

  const lookKey = (el: Element) => {
    const look = infoOf(el).look;
    return JSON.stringify([look.weight, look.style, look.size, look.color]);
  };

  const push = (lines: Array<{ text: string; el: Element }>) => {
    const text = cleanSegmentText(lines.map((l) => l.text).join("\n"));
    const el = lines.find((l) => l.text.trim())?.el;
    if (!text || !el) return;
    const lang = el.closest("[lang]")?.getAttribute("lang")?.trim();
    segments.push({
      id: `${id}-${segments.length + 1}`,
      text,
      look: { ...containerLook(block), ...infoOf(el).look },
      ...(lang ? { lang } : {}),
      // Site chrome starts out excluded (Restore brings it back).
      ...(isChrome(el) || CHROME_TEXT.test(text) ? { furniture: true as const } : {}),
    });
  };

  /**
   * One block element's text → segments: a blank line (two line breaks)
   * starts a new segment, and so does a line set apart by its look (a red
   * "1. Kondakion" between plain lines), as a reader sees paragraphs.
   */
  const flush = () => {
    const lines: Array<{ text: string; el: Element | null; chars: Map<Element, number> }> = [{ text: "", el: null, chars: new Map() }];
    for (const run of runs) {
      if (run.el === null) {
        lines.push({ text: "", el: null, chars: new Map() });
        continue;
      }
      const parts = run.text.split("\n");
      parts.forEach((part, i) => {
        if (i > 0) lines.push({ text: "", el: null, chars: new Map() });
        const line = lines[lines.length - 1]!;
        line.text += part;
        const n = part.replace(/\s+/g, "").length;
        if (n > 0) {
          line.chars.set(run.el!, (line.chars.get(run.el!) ?? 0) + n);
          line.el ??= run.el;
        }
      });
    }
    runs = [];
    // The look a line is mostly set in.
    const keyed = lines.map((l) => {
      let best: Element | null = null;
      for (const [el, n] of l.chars) if (!best || n > l.chars.get(best)!) best = el;
      return { text: l.text, el: l.el, key: best ? lookKey(best) : "" };
    });
    let group: Array<{ text: string; el: Element; key: string }> = [];
    const groups: Array<typeof group> = [];
    for (const line of keyed) {
      if (!line.text.trim() || !line.el) {
        if (group.length) groups.push(group);
        group = [];
      } else group.push({ text: line.text, el: line.el, key: line.key });
    }
    if (group.length) groups.push(group);
    for (const g of groups) {
      let chunk: typeof g = [];
      g.forEach((line, i) => {
        if (chunk.length && lineBreakStartsParagraph(g[i - 1]!, line)) {
          push(chunk);
          chunk = [];
        }
        chunk.push(line);
      });
      if (chunk.length) push(chunk);
    }
  };

  const visit = (node: Node, pre: boolean) => {
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? "";
      const text = pre ? value : value.replace(/[ \t\n\r\f]+/g, " ");
      if (text && node.parentElement) runs.push({ text, el: node.parentElement });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.tagName === "BR") {
      runs.push({ text: "\n", el: null });
      return;
    }
    const meta = infoOf(el);
    if (meta.hidden) return;
    if (!meta.block) {
      for (const child of el.childNodes) visit(child, pre || meta.pre);
      return;
    }
    flush();
    const outer = block;
    block = el;
    for (const child of el.childNodes) visit(child, pre || meta.pre);
    flush();
    block = outer;
  };

  const root = doc.body ?? doc.documentElement;
  visit(root, false);
  flush();

  const page = options.page ?? pageInfo(doc);
  // When nearly everything reads as chrome, the guess is wrong: keep it all.
  const text = (list: SourceSegment[]) => list.reduce((n, seg) => n + seg.text.length, 0);
  if (text(segments.filter((seg) => !seg.furniture)) < Math.max(40, text(segments) * 0.05)) {
    for (const seg of segments) delete seg.furniture;
  }
  return assignStyleGroups({
    id,
    format: "html",
    name: options.name ?? "Web page",
    ...(page.title || page.siteName ? { page } : {}),
    segments,
  });
}

const FRAME_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:";

/**
 * Read HTML with the browser's layout: the sanitized page is laid out in a
 * sandboxed frame (no scripts, no network) and its computed styles become
 * the segments' look. Falls back to {@link staticElementInfo}.
 */
export async function readHtml(html: string, options: ReadHtmlOptions = {}): Promise<Source> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  options = { ...options, page: options.page ?? pageInfo(doc) };
  sanitizeHtml(doc);
  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", FRAME_CSP);
  doc.head.prepend(csp);

  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:900px;height:900px;border:0;pointer-events:none";
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  frame.srcdoc = `<!doctype html>${doc.documentElement.outerHTML}`;
  document.body.append(frame);
  try {
    await loaded;
    const laidOut = frame.contentDocument;
    const win = frame.contentWindow;
    if (!laidOut?.body || !win) return readHtmlDocument(doc, staticElementInfo, options);
    return readHtmlDocument(laidOut, computedElementInfo(win), options);
  } finally {
    frame.remove();
  }
}
