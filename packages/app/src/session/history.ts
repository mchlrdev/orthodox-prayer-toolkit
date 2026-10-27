import type { Prayer } from "@orthodox-prayer-toolkit/core";

/**
 * Undo / redo stack for one prayer (or Import draft) in the session.
 * Snapshots are whole immutable values, so undo crosses blocks, kinds,
 * moves and deletes.
 */
export type DraftHistory<T = Prayer> = {
  past: T[];
  future: T[];
  /** Consecutive edits with the same key inside COALESCE_MS share one step. */
  coalesceKey: string | null;
  at: number;
};

export const HISTORY_LIMIT = 200;
export const HISTORY_COALESCE_MS = 1500;

export function emptyHistory<T = Prayer>(): DraftHistory<T> {
  return { past: [], future: [], coalesceKey: null, at: 0 };
}

/** Record `previous` before an edit replaces it. Clears redo. */
export function recordEdit<T = Prayer>(
  history: DraftHistory<T> | undefined,
  previous: T,
  options: { coalesceKey?: string | null; now: number },
): DraftHistory<T> {
  const h = history ?? emptyHistory<T>();
  const key = options.coalesceKey ?? null;
  if (
    key !== null &&
    key === h.coalesceKey &&
    options.now - h.at <= HISTORY_COALESCE_MS &&
    h.past.length > 0
  ) {
    return { ...h, future: [], at: options.now };
  }
  const past = [...h.past, previous];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [], coalesceKey: key, at: options.now };
}

export function stepBack<T = Prayer>(
  history: DraftHistory<T> | undefined,
  current: T,
): { prayer: T; history: DraftHistory<T> } | null {
  const h = history ?? emptyHistory<T>();
  const prayer = h.past[h.past.length - 1];
  if (!prayer) return null;
  return {
    prayer,
    history: {
      past: h.past.slice(0, -1),
      future: [current, ...h.future],
      coalesceKey: null,
      at: 0,
    },
  };
}

export function stepForward<T = Prayer>(
  history: DraftHistory<T> | undefined,
  current: T,
): { prayer: T; history: DraftHistory<T> } | null {
  const h = history ?? emptyHistory<T>();
  const prayer = h.future[0];
  if (!prayer) return null;
  return {
    prayer,
    history: {
      past: [...h.past, current],
      future: h.future.slice(1),
      coalesceKey: null,
      at: 0,
    },
  };
}
