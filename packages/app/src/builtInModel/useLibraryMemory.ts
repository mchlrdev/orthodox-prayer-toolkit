import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyMemory,
  memoryFileText,
  sanitizeMemory,
  type LibraryMemory,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";
import { getToolkitApi, isBrowserDev } from "../api";

export const MEMORY_FILE = ".orthodox-prayer-toolkit/memory.json";

export type LibraryMemoryState = {
  memory: LibraryMemory;
  /** The memory right now, including changes made earlier in this turn. */
  current: () => LibraryMemory;
  /** Problems in `memory.json`; while non-empty the app does not rewrite it. */
  errors: ValidationError[];
  /** Change and write the memory; false when the file has errors or no Library is open. */
  update: (change: (memory: LibraryMemory) => LibraryMemory) => boolean;
};

function parse(text: string | null): { memory: LibraryMemory; errors: ValidationError[] } {
  if (text === null) return { memory: emptyMemory(), errors: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { memory: emptyMemory(), errors: [{ path: "/", message: "memory.json is not valid JSON" }] };
  }
  return sanitizeMemory(data);
}

/**
 * The open Library's memory (`.orthodox-prayer-toolkit/memory.json`): read
 * when the Library opens or the file changes on disk, written after every
 * change, one write at a time. A file with errors is read as far as it is
 * valid and never rewritten, so nothing in it is lost.
 */
export function useLibraryMemory(root: string | null): LibraryMemoryState {
  const [state, setState] = useState(() => ({ memory: emptyMemory(), errors: [] as ValidationError[] }));
  const ref = useRef(state);
  const writes = useRef<Promise<void>>(Promise.resolve());

  const set = useCallback((next: typeof state) => {
    ref.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    set({ memory: emptyMemory(), errors: [] });
    if (!root) return;
    const api = getToolkitApi();
    let live = true;
    const load = () =>
      api
        .readLibraryMemory(root)
        .then((text) => {
          if (live) set(parse(text));
        })
        .catch((error: unknown) => console.error("Cannot read the Library memory", error));
    void load();
    const unsubscribe = isBrowserDev()
      ? undefined
      : api.onLibraryChanged(({ root: changed, paths }) => {
          if (changed === root && paths.some((p) => p.replace(/\\/g, "/") === MEMORY_FILE)) void load();
        });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [root, set]);

  const update = useCallback(
    (change: (memory: LibraryMemory) => LibraryMemory): boolean => {
      const cur = ref.current;
      if (!root || cur.errors.length > 0) return false;
      const memory = change(cur.memory);
      if (memory === cur.memory) return true;
      set({ memory, errors: [] });
      const text = memoryFileText(memory);
      writes.current = writes.current
        .then(() => getToolkitApi().writeLibraryMemory(root, text))
        .catch((error: unknown) => console.error("Cannot write the Library memory", error));
      return true;
    },
    [root, set],
  );

  return {
    memory: state.memory,
    current: useCallback(() => ref.current.memory, []),
    errors: state.errors,
    update,
  };
}
