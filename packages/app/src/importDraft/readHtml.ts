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
};

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

  let buf = "";
  let textEl: Element | null = null;
  let block: Element = doc.body ?? doc.documentElement;

  const flush = () => {
    const text = cleanSegmentText(buf);
    if (text && textEl) {
      const lang = textEl.closest("[lang]")?.getAttribute("lang")?.trim();
      segments.push({
        id: `${id}-${segments.length + 1}`,
        text,
        look: { ...containerLook(block), ...infoOf(textEl).look },
        ...(lang ? { lang } : {}),
      });
    }
    buf = "";
    textEl = null;
  };

  const visit = (node: Node, pre: boolean) => {
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? "";
      buf += pre ? value : value.replace(/[ \t\n\r\f]+/g, " ");
      if (!textEl && /\S/.test(value)) textEl = node.parentElement;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.tagName === "BR") {
      buf += "\n";
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

  return assignStyleGroups({
    id,
    format: "html",
    name: options.name ?? "Web page",
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
