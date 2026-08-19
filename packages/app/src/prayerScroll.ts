import { useLayoutEffect, useRef, type RefObject } from "react";

/** In-memory only: forgotten when the app process exits. */
const sessionScroll = new Map<string, number>();

export function prayerScrollKey(libraryRoot: string, path: string): string {
  return `${libraryRoot}\0${path}`;
}

export function rememberPrayerScroll(key: string, scrollTop: number): void {
  sessionScroll.set(key, scrollTop);
}

export function recallPrayerScroll(key: string): number {
  return sessionScroll.get(key) ?? 0;
}

/**
 * Capture the current scroller position for `fromKey`, then restore `toKey`.
 * Call this while the scroller still shows `fromKey` content — after a
 * prayer switch the same node may already be clamped to the next prayer.
 */
export function applyPrayerScroll(
  el: { scrollTop: number },
  fromKey: string | null,
  toKey: string | null,
): void {
  if (fromKey) rememberPrayerScroll(fromKey, el.scrollTop);
  el.scrollTop = toKey ? recallPrayerScroll(toKey) : 0;
}

/** Test helper — session memory is process-global. */
export function resetPrayerScrollMemory(): void {
  sessionScroll.clear();
}

export function usePrayerScroll(
  libraryRoot: string | null,
  path: string | null,
  scrollRootRef: RefObject<HTMLElement | null>,
): void {
  const key =
    libraryRoot && path ? prayerScrollKey(libraryRoot, path) : null;
  const prevKeyRef = useRef<string | null>(null);

  // Capture while the previous prayer is still in the DOM (before commit).
  const fromKey = prevKeyRef.current;
  if (fromKey !== key) {
    const el = scrollRootRef.current;
    if (el && fromKey) rememberPrayerScroll(fromKey, el.scrollTop);
    prevKeyRef.current = key;
  }

  useLayoutEffect(() => {
    const el = scrollRootRef.current;
    if (!el) return;
    el.scrollTop = key ? recallPrayerScroll(key) : 0;
    if (!key) return;

    const onScroll = () => rememberPrayerScroll(key, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [key, scrollRootRef]);
}
