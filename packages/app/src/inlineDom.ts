import {
  normalizeRuns,
  packInline,
  plainText,
  toRuns,
  type InlineContent,
  type TextRun,
} from "@orthodox-prayer-toolkit/core";

const NOTE_ATTR = "data-role";
const NOTE_VALUE = "note";

export function isNoteElement(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).getAttribute(NOTE_ATTR) === NOTE_VALUE
  );
}

function appendRuns(parent: HTMLElement, content: InlineContent): void {
  for (const run of normalizeRuns(toRuns(content))) {
    if (run.t === "text") {
      parent.appendChild(document.createTextNode(run.v));
      continue;
    }
    const span = document.createElement("span");
    span.setAttribute(NOTE_ATTR, NOTE_VALUE);
    span.className = "inline-note";
    span.appendChild(document.createTextNode(run.v));
    parent.appendChild(span);
  }
}

/** Render line-mode (joined by \\n) or single text into a contenteditable. */
export function renderEditable(
  el: HTMLElement,
  content: InlineContent | InlineContent[],
  lineMode: boolean,
): void {
  el.replaceChildren();
  if (lineMode) {
    const lines = content as InlineContent[];
    lines.forEach((line, i) => {
      if (i > 0) el.appendChild(document.createTextNode("\n"));
      appendRuns(el, line);
    });
    return;
  }
  appendRuns(el, content as InlineContent);
}

function pushRun(runs: TextRun[], t: "text" | "note", v: string): void {
  if (v.length === 0) return;
  const prev = runs[runs.length - 1];
  if (prev && prev.t === t) {
    prev.v += v;
  } else {
    runs.push({ t, v });
  }
}

function flushLine(lines: InlineContent[], runs: TextRun[]): TextRun[] {
  const packed = packInline(normalizeRuns(runs));
  if (packed !== null) lines.push(packed);
  return [];
}

/**
 * Walk editable DOM → lines (verse) or a single InlineContent.
 * Treats BR and \\n as newlines.
 */
export function serializeEditable(
  el: HTMLElement,
  lineMode: boolean,
): InlineContent | InlineContent[] | null {
  const lines: InlineContent[] = [];
  let runs: TextRun[] = [];

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = (node.textContent ?? "").replace(/\u00a0/g, " ");
      const parts = raw.split("\n");
      parts.forEach((part, i) => {
        if (i > 0) runs = flushLine(lines, runs);
        pushRun(runs, "text", part);
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const elNode = node as HTMLElement;
    const tag = elNode.tagName;

    if (tag === "BR") {
      runs = flushLine(lines, runs);
      return;
    }

    if (isNoteElement(elNode)) {
      const text = (elNode.textContent ?? "").replace(/\u00a0/g, " ");
      const parts = text.split("\n");
      parts.forEach((part, i) => {
        if (i > 0) runs = flushLine(lines, runs);
        pushRun(runs, "note", part);
      });
      return;
    }

    if ((tag === "DIV" || tag === "P") && elNode !== el) {
      if (lines.length > 0 || runs.length > 0) {
        runs = flushLine(lines, runs);
      }
      for (const child of elNode.childNodes) visit(child);
      return;
    }

    for (const child of elNode.childNodes) visit(child);
  };

  for (const child of el.childNodes) visit(child);
  runs = flushLine(lines, runs);

  if (lineMode) {
    return lines.length === 0 ? null : lines;
  }
  if (lines.length === 0) return null;
  if (lines.length === 1) return lines[0]!;
  const joined: TextRun[] = [];
  lines.forEach((line, i) => {
    if (i > 0) pushRun(joined, "text", "\n");
    for (const r of toRuns(line)) pushRun(joined, r.t, r.v);
  });
  return packInline(joined);
}

export function getSelectionOffsets(
  el: HTMLElement,
): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) {
    return null;
  }

  const preStart = range.cloneRange();
  preStart.selectNodeContents(el);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;

  const preEnd = range.cloneRange();
  preEnd.selectNodeContents(el);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const end = preEnd.toString().length;

  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

/** True when the current selection lies entirely inside one note span. */
export function selectionIsSingleNote(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const startEl =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement;
  const endEl =
    range.endContainer.nodeType === Node.ELEMENT_NODE
      ? (range.endContainer as HTMLElement)
      : range.endContainer.parentElement;
  const startNote = startEl?.closest?.(".inline-note") as HTMLElement | null;
  const endNote = endEl?.closest?.(".inline-note") as HTMLElement | null;
  if (!startNote || startNote !== endNote || !el.contains(startNote)) {
    return false;
  }
  return true;
}

/** True when selection start or end is inside a note. */
export function selectionOverlapsNote(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const startEl =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as HTMLElement)
      : range.startContainer.parentElement;
  const endEl =
    range.endContainer.nodeType === Node.ELEMENT_NODE
      ? (range.endContainer as HTMLElement)
      : range.endContainer.parentElement;
  const startNote = startEl?.closest?.(".inline-note");
  const endNote = endEl?.closest?.(".inline-note");
  return Boolean(
    (startNote && el.contains(startNote)) || (endNote && el.contains(endNote)),
  );
}

/** Plain-text offsets of an element inside the editable. */
export function getElementOffsets(
  el: HTMLElement,
  target: HTMLElement,
): { start: number; end: number } {
  const pre = document.createRange();
  pre.selectNodeContents(el);
  let anchored = false;
  for (const child of target.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      pre.setEnd(child, 0);
      anchored = true;
      break;
    }
  }
  if (!anchored) {
    pre.setEnd(target, 0);
  }
  const start = pre.toString().length;
  const end = start + (target.textContent ?? "").length;
  return { start, end };
}

/** Map a plain offset to line index + local offset (\\n separators). */
export function mapOffsetToLine(
  lines: InlineContent[],
  offset: number,
): { lineIndex: number; local: number } {
  let remaining = offset;
  for (let i = 0; i < lines.length; i++) {
    const len = plainText(lines[i]!).length;
    if (remaining <= len) {
      return { lineIndex: i, local: remaining };
    }
    remaining -= len;
    if (i < lines.length - 1) {
      if (remaining === 0) {
        return { lineIndex: i + 1, local: 0 };
      }
      remaining -= 1;
    }
  }
  const last = Math.max(0, lines.length - 1);
  return {
    lineIndex: last,
    local: plainText(lines[last] ?? "").length,
  };
}

function resolveTextNode(
  root: HTMLElement,
  offset: number,
): { node: Text; offset: number } | null {
  let remaining = Math.max(0, offset);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    last = node;
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      return { node, offset: remaining };
    }
    remaining -= len;
    node = walker.nextNode() as Text | null;
  }
  if (last) {
    return { node: last, offset: last.textContent?.length ?? 0 };
  }
  return null;
}

/** Build a DOM range from plain-text offsets inside a contenteditable root. */
export function createRangeFromOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  let from = Math.max(0, start);
  let to = Math.max(0, end);
  if (to < from) [from, to] = [to, from];

  const startPos = resolveTextNode(root, from);
  const endPos = resolveTextNode(root, to);
  if (!startPos || !endPos) return null;

  const range = document.createRange();
  range.setStart(startPos.node, startPos.offset);
  range.setEnd(endPos.node, endPos.offset);
  return range;
}

/** Client rectangles for a plain-text range inside an editable root. */
export function rangeRectsFromOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): DOMRect[] {
  const range = createRangeFromOffsets(root, start, end);
  if (!range) return [];
  return [...range.getClientRects()];
}

export function findNoteRunIndexAtOffset(
  content: InlineContent,
  offset: number,
): number | null {
  const runs = toRuns(content);
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const next = pos + run.v.length;
    if (offset >= pos && offset < next && run.t === "note") return i;
    if (offset === next && run.t === "note" && offset > pos) return i;
    pos = next;
  }
  return null;
}

export function linePlainBounds(lines: InlineContent[]): Array<{
  start: number;
  end: number;
}> {
  const bounds: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = plainText(lines[i]!).length;
    bounds.push({ start: offset, end: offset + len });
    offset += len;
    if (i < lines.length - 1) offset += 1;
  }
  return bounds;
}
