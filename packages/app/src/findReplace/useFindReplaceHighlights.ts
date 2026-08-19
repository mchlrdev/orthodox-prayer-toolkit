import { useLayoutEffect } from "react";
import type { RefObject } from "react";
import type { FindMatch } from "../prayerEdit/findReplace";
import {
  applyFindHighlights,
  clearFindHighlights,
  cssHighlightsSupported,
} from "./highlights";

type Args = {
  scrollRootRef: RefObject<HTMLElement | null>;
  matches: FindMatch[];
  currentIndex: number;
  query: string;
  enabled: boolean;
};

export function useFindReplaceHighlights({
  scrollRootRef,
  matches,
  currentIndex,
  query,
  enabled,
}: Args): void {
  useLayoutEffect(() => {
    if (!enabled || !cssHighlightsSupported()) {
      clearFindHighlights();
      return;
    }

    const root = scrollRootRef.current;
    if (!root || query.length === 0 || matches.length === 0) {
      clearFindHighlights();
      return;
    }

    let raf = 0;
    const paint = () => {
      if (!scrollRootRef.current) return;
      applyFindHighlights(scrollRootRef.current, matches, currentIndex);
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(paint);
    };

    schedule();

    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      clearFindHighlights();
    };
  }, [currentIndex, enabled, matches, query, scrollRootRef]);
}
