import { createRangeFromOffsets } from "../inlineDom";
import type { FindMatch } from "../prayerEdit/findReplace";
import { editorKey } from "./state";

export const FIND_HIGHLIGHT = "find-match";
export const FIND_HIGHLIGHT_CURRENT = "find-match-current";

export function cssHighlightsSupported(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS;
}

export function clearFindHighlights(): void {
  if (!cssHighlightsSupported()) return;
  CSS.highlights.delete(FIND_HIGHLIGHT);
  CSS.highlights.delete(FIND_HIGHLIGHT_CURRENT);
}

export function applyFindHighlights(
  root: HTMLElement,
  matches: FindMatch[],
  currentIndex: number,
): void {
  if (!cssHighlightsSupported()) return;

  const otherRanges: Range[] = [];
  const currentRanges: Range[] = [];

  for (const [index, match] of matches.entries()) {
    const editable = root.querySelector<HTMLElement>(
      `[data-editor="${CSS.escape(editorKey(match.blockId, match.col))}"]`,
    );
    if (!editable) continue;

    const range = createRangeFromOffsets(editable, match.start, match.end);
    if (!range || range.collapsed) continue;

    if (index === currentIndex) currentRanges.push(range);
    else otherRanges.push(range);
  }

  if (otherRanges.length > 0) {
    CSS.highlights.set(FIND_HIGHLIGHT, new Highlight(...otherRanges));
  } else {
    CSS.highlights.delete(FIND_HIGHLIGHT);
  }

  if (currentRanges.length > 0) {
    CSS.highlights.set(
      FIND_HIGHLIGHT_CURRENT,
      new Highlight(...currentRanges),
    );
  } else {
    CSS.highlights.delete(FIND_HIGHLIGHT_CURRENT);
  }
}

export function scrollFindMatchIntoView(
  scrollRoot: HTMLElement,
  match: FindMatch,
): void {
  const editable = scrollRoot.querySelector<HTMLElement>(
    `[data-editor="${CSS.escape(editorKey(match.blockId, match.col))}"]`,
  );
  if (!editable) return;

  const range = createRangeFromOffsets(editable, match.start, match.end);
  if (!range) {
    scrollRoot
      .querySelector<HTMLElement>(
        `[data-block-id="${CSS.escape(match.blockId)}"]`,
      )
      ?.scrollIntoView({ behavior: "auto", block: "nearest" });
    return;
  }

  const margin = 20;
  const rangeRect = range.getBoundingClientRect();
  const scrollerRect = scrollRoot.getBoundingClientRect();

  if (rangeRect.top < scrollerRect.top + margin) {
    scrollRoot.scrollTop += rangeRect.top - scrollerRect.top - margin;
  } else if (rangeRect.bottom > scrollerRect.bottom - margin) {
    scrollRoot.scrollTop += rangeRect.bottom - scrollerRect.bottom + margin;
  }
}
