import type { Prayer } from "@orthodox-prayer-toolkit/core";

/**
 * Undo / redo stack for one prayer in the session. Snapshots are whole
 * prayers (immutable), so undo crosses blocks, kinds, moves and deletes.
 */
export type DraftHistory = {
  past: Prayer[];
  future: Prayer[];
  /** Consecutive edits with the same key inside COALESCE_MS share one step. */
  coalesceKey: string | null;
  at: number;
};

export const HISTORY_LIMIT = 200;
export const HISTORY_COALESCE_MS = 1500;

export function emptyHistory(): DraftHistory {
  return { past: [], future: [], coalesceKey: null, at: 0 };
}

/** Record `previous` before an edit replaces it. Clears redo. */
export function recordEdit(
  history: DraftHistory | undefined,
  previous: Prayer,
  options: { coalesceKey?: string | null; now: number },
): DraftHistory {
  const h = history ?? emptyHistory();
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

export function stepBack(
  history: DraftHistory | undefined,
  current: Prayer,
): { prayer: Prayer; history: DraftHistory } | null {
  const h = history ?? emptyHistory();
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

export function stepForward(
  history: DraftHistory | undefined,
  current: Prayer,
): { prayer: Prayer; history: DraftHistory } | null {
  const h = history ?? emptyHistory();
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
