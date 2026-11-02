import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { draftUncertainWords, type ImportDraft } from "@orthodox-prayer-toolkit/core";
import { cssHighlightsSupported } from "../findReplace/highlights";
import { createRangeFromOffsets } from "../inlineDom";

const HIGHLIGHT = "ocr-uncertain";

type Word = { blockId: string; start: number; end: number; confidence?: number };

export type UncertainHover = { left: number; top: number; confidence?: number } | null;

/**
 * Words text recognition read with low confidence, underlined in the
 * editor (CSS Custom Highlight: the editor's DOM stays untouched), and the
 * one under the pointer for a tooltip.
 */
export function useUncertainWords(
  scrollRootRef: RefObject<HTMLElement | null>,
  draft: ImportDraft,
  variantKey: string,
  /** The editor column shown (`variantKey` of lang/edition). */
  colKey: string,
): { count: number; hover: UncertainHover } {
  const words = useMemo<Word[]>(() => {
    if (!draft.sources.some((s) => s.segments.some((seg) => seg.uncertain?.length))) return [];
    return draft.blocks.flatMap((b) =>
      draftUncertainWords(draft, b, variantKey).map((w) => ({
        blockId: b.id,
        start: w.start,
        end: w.end,
        ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
      })),
    );
  }, [draft, variantKey]);
  const [hover, setHover] = useState<UncertainHover>(null);

  useLayoutEffect(() => {
    const root = scrollRootRef.current;
    if (!root || words.length === 0 || !cssHighlightsSupported()) {
      if (cssHighlightsSupported()) CSS.highlights.delete(HIGHLIGHT);
      setHover(null);
      return;
    }
    let ranges: Array<{ range: Range; word: Word }> = [];
    let raf = 0;
    const paint = () => {
      ranges = [];
      for (const word of words) {
        const editable = root.querySelector<HTMLElement>(
          `[data-editor="${CSS.escape(`${word.blockId}::${colKey}`)}"]`,
        );
        const range = editable ? createRangeFromOffsets(editable, word.start, word.end) : null;
        if (range && !range.collapsed) ranges.push({ range, word });
      }
      if (ranges.length > 0) CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges.map((r) => r.range)));
      else CSS.highlights.delete(HIGHLIGHT);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(paint);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, characterData: true });

    const onMove = (e: MouseEvent) => {
      for (const { range, word } of ranges) {
        for (const r of range.getClientRects()) {
          if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            setHover((h) =>
              h && h.left === r.left && h.top === r.top
                ? h
                : { left: r.left, top: r.top, ...(word.confidence !== undefined ? { confidence: word.confidence } : {}) },
            );
            return;
          }
        }
      }
      setHover((h) => (h ? null : h));
    };
    const onLeave = () => setHover(null);
    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    root.addEventListener("scroll", onLeave, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
      root.removeEventListener("scroll", onLeave);
      CSS.highlights.delete(HIGHLIGHT);
    };
  }, [scrollRootRef, words, colKey]);

  return { count: words.length, hover };
}
