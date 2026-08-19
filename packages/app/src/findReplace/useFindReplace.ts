import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useDebouncedValue } from "@mantine/hooks";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import {
  findMatchesInPrayer,
  replaceAllMatchesInPrayer,
  replaceMatchInPrayer,
  summarizeReplaceAll,
  type FindMatch,
} from "../prayerEdit/findReplace";
import type { ActiveVariant } from "../variant";
import {
  scrollFindMatchIntoView,
} from "./highlights";
import {
  clampMatchIndex,
  createDefaultFindReplaceState,
  type FindReplaceState,
} from "./state";
import { useFindReplaceHighlights } from "./useFindReplaceHighlights";

type Args = {
  prayer: Prayer;
  prayerPath: string;
  visibleVariants: ActiveVariant[];
  onChange: (prayer: Prayer) => void;
  scrollRootRef: RefObject<HTMLDivElement | null>;
};

function getSelectionTextInWorkspace(): string {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return "";
  const range = sel.getRangeAt(0);
  const root = range.commonAncestorContainer.parentElement?.closest?.(
    ".workspace-body",
  );
  if (!root) return "";
  return sel.toString();
}

export function useFindReplace({
  prayer,
  prayerPath,
  visibleVariants,
  onChange,
  scrollRootRef,
}: Args) {
  const stateByPathRef = useRef(new Map<string, FindReplaceState>());
  const [state, setState] = useState<FindReplaceState>(() => {
    return (
      stateByPathRef.current.get(prayerPath) ??
      createDefaultFindReplaceState()
    );
  });
  const [replaceAllOpen, setReplaceAllOpen] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  const persistState = useCallback(
    (next: FindReplaceState) => {
      stateByPathRef.current.set(prayerPath, next);
      setState(next);
    },
    [prayerPath],
  );

  useEffect(() => {
    const saved =
      stateByPathRef.current.get(prayerPath) ??
      createDefaultFindReplaceState();
    setState(saved);
  }, [prayerPath]);

  const [debouncedQuery] = useDebouncedValue(state.query, 150);

  const matches = useMemo(
    () =>
      findMatchesInPrayer(prayer, visibleVariants, debouncedQuery, {
        matchCase: state.matchCase,
        wholeWord: state.wholeWord,
      }),
    [
      prayer,
      visibleVariants,
      debouncedQuery,
      state.matchCase,
      state.wholeWord,
    ],
  );

  const activeIndex = clampMatchIndex(state.currentIndex, matches.length);
  const currentMatch = matches[activeIndex] ?? null;

  useEffect(() => {
    if (!state.open || !currentMatch || !scrollRootRef.current) return;
    scrollFindMatchIntoView(scrollRootRef.current, currentMatch);
  }, [activeIndex, currentMatch, scrollRootRef, state.open]);

  useFindReplaceHighlights({
    scrollRootRef,
    matches,
    currentIndex: activeIndex,
    query: debouncedQuery,
    enabled: state.open,
  });

  const patch = useCallback(
    (partial: Partial<FindReplaceState>) => {
      persistState({ ...state, ...partial });
    },
    [persistState, state],
  );

  const openFind = useCallback(
    (opts?: { expandReplace?: boolean }) => {
      const selection = getSelectionTextInWorkspace();
      const saved =
        stateByPathRef.current.get(prayerPath) ??
        createDefaultFindReplaceState();
      const next = {
        ...saved,
        open: true,
        query: selection || saved.query,
        replaceExpanded: opts?.expandReplace ?? saved.replaceExpanded,
        currentIndex: 0,
      };
      persistState(next);
      requestAnimationFrame(() => findInputRef.current?.focus());
    },
    [persistState, prayerPath],
  );

  const closeFind = useCallback(() => {
    persistState({ ...state, open: false });
  }, [persistState, state]);

  const toggleFind = useCallback(() => {
    if (state.open) closeFind();
    else openFind();
  }, [closeFind, openFind, state.open]);

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    persistState({
      ...state,
      currentIndex: clampMatchIndex(activeIndex + 1, matches.length),
    });
  }, [activeIndex, matches.length, persistState, state]);

  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    persistState({
      ...state,
      currentIndex: clampMatchIndex(activeIndex - 1, matches.length),
    });
  }, [activeIndex, matches.length, persistState, state]);

  const replaceCurrent = useCallback(() => {
    if (!currentMatch) return;
    const nextPrayer = replaceMatchInPrayer(
      prayer,
      currentMatch,
      state.replaceWith,
    );
    onChange(nextPrayer);
  }, [currentMatch, onChange, prayer, state.replaceWith]);

  const requestReplaceAll = useCallback(() => {
    if (matches.length === 0) return;
    setReplaceAllOpen(true);
  }, [matches.length]);

  const confirmReplaceAll = useCallback(() => {
    const nextPrayer = replaceAllMatchesInPrayer(
      prayer,
      matches,
      state.replaceWith,
    );
    onChange(nextPrayer);
    setReplaceAllOpen(false);
  }, [matches, onChange, prayer, state.replaceWith]);

  const replaceAllSummary = useMemo(
    () => summarizeReplaceAll(matches),
    [matches],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const target = event.target;
      const inInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;

      if (state.open && event.key === "Escape") {
        event.preventDefault();
        closeFind();
        return;
      }

      if (mod && event.key.toLowerCase() === "f" && !event.shiftKey) {
        event.preventDefault();
        toggleFind();
        return;
      }

      if (mod && event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openFind({ expandReplace: true });
        requestAnimationFrame(() => replaceInputRef.current?.focus());
        return;
      }

      if (!state.open) return;

      if (event.key === "Enter" && inInput) {
        event.preventDefault();
        if (event.shiftKey) goPrev();
        else goNext();
        return;
      }

      if (mod && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) goPrev();
        else goNext();
        return;
      }

      if (event.key === "F3") {
        event.preventDefault();
        if (event.shiftKey) goPrev();
        else goNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeFind, goNext, goPrev, openFind, state.open, toggleFind]);

  useEffect(() => {
    const api = window.prayerToolkit;
    if (!api?.onFindRequested) return;
    const unsubFind = api.onFindRequested(() => openFind());
    const unsubNext = api.onFindNextRequested?.(() => {
      if (!state.open) openFind();
      else goNext();
    });
    return () => {
      unsubFind();
      unsubNext?.();
    };
  }, [goNext, openFind, state.open]);

  return {
    state,
    debouncedQuery,
    matches,
    activeIndex,
    currentMatch,
    findInputRef,
    replaceInputRef,
    replaceAllOpen,
    replaceAllSummary,
    patch,
    openFind,
    closeFind,
    toggleFind,
    goNext,
    goPrev,
    replaceCurrent,
    requestReplaceAll,
    confirmReplaceAll,
    cancelReplaceAll: () => setReplaceAllOpen(false),
  };
}

export type { FindMatch };
