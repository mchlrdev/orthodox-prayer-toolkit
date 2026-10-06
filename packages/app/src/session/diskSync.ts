import { validate } from "@orthodox-prayer-toolkit/core";
import { patchCatalogText, removeCatalogPath } from "../catalog";
import { reconcileVisibleVariants } from "../variant";
import { putPrayerFromText } from "./operations";
import { resolveVisibleVariants } from "./visibleVariants";
import type {
  PrayerSessionState,
  SessionDraft,
  SessionOpResult,
} from "./types";

/**
 * Replace the session copy of `path` with what is on disk (`text`, or `null`
 * when the file is gone). Drops local edits. Keeps columns and undo history.
 */
export function takeDiskVersion(
  state: PrayerSessionState,
  path: string,
  text: string | null,
): PrayerSessionState {
  if (!state.catalog) return state;
  const drafts = { ...state.drafts };
  const current = drafts[path];

  if (text === null) {
    delete drafts[path];
    return {
      ...state,
      catalog: removeCatalogPath(state.catalog, path),
      drafts,
      selectedPath: state.selectedPath === path ? null : state.selectedPath,
    };
  }

  const catalog = patchCatalogText(state.catalog, path, text);
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* invalid JSON: catalog entry carries the error */
  }
  const result = data === null ? null : validate(data);
  if (!result?.ok) {
    // The selected path without a draft shows the invalid-prayer screen.
    delete drafts[path];
    return { ...state, catalog, drafts };
  }
  if (!current) {
    // A selected prayer that was invalid on disk opens once it is fixed.
    return state.selectedPath === path
      ? putPrayerFromText(state, path, text).state
      : { ...state, catalog };
  }

  const prayer = structuredClone(result.prayer);
  const fallback =
    reconcileVisibleVariants(current.visibleVariants, prayer.variants, null);
  const next: SessionDraft = {
    prayer,
    saved: prayer,
    diskText: text,
    errors: [],
    visibleVariants:
      fallback.length > 0
        ? fallback
        : resolveVisibleVariants(
            prayer,
            catalog.root,
            path,
            catalog.manifest?.defaultVariant,
          ),
    dirty: false,
    history: current.history,
  };
  drafts[path] = next;
  return { ...state, catalog, drafts };
}

/**
 * The folder watcher saw `path` change (`text`) or disappear (`null`).
 * Clean prayers follow the disk; prayers with unsaved edits keep them and get
 * a `diskConflict` the editor shows. Own writes (same text) are ignored.
 */
export function applyDiskChange(
  state: PrayerSessionState,
  path: string,
  text: string | null,
): SessionOpResult {
  if (!state.catalog) return { state, notices: [] };
  const current = state.drafts[path];

  if (current && text !== null && text === current.diskText) {
    return { state, notices: [] };
  }

  if (current?.dirty) {
    if (current.diskConflict === "deleted" && text === null) {
      return { state, notices: [] };
    }
    return {
      state: {
        ...state,
        drafts: {
          ...state.drafts,
          [path]: {
            ...current,
            diskConflict: text === null ? "deleted" : "changed",
            diskText: text ?? undefined,
          },
        },
      },
      notices: [],
    };
  }

  if (text === null && !state.catalog.entries.some((e) => e.path === path)) {
    return { state, notices: [] };
  }

  const wasSelected = state.selectedPath === path;
  const next = takeDiskVersion(state, path, text);
  return {
    state: next,
    notices:
      wasSelected && text === null
        ? [{ color: "dark", title: "Deleted on disk", message: path }]
        : [],
    dropCatalogPaths: text === null ? [path] : undefined,
  };
}

/** Keep the unsaved edits; the next save overwrites (or recreates) the file. */
export function keepLocalVersion(
  state: PrayerSessionState,
  path: string,
): PrayerSessionState {
  const current = state.drafts[path];
  if (!current?.diskConflict) return state;
  const { diskConflict: _, ...rest } = current;
  return { ...state, drafts: { ...state.drafts, [path]: rest } };
}
