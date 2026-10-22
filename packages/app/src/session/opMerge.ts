import type { CatalogEntry, LibraryCatalog } from "../catalog";
import { recomputeCatalogIndex } from "../catalog/build";
import type {
  PrayerSessionState,
  SessionDraft,
  SessionOpResult,
} from "./types";

/** Session fields an op may set; derived catalog / drafts are merged apart. */
const SCALAR_KEYS = [
  "createDraft",
  "createVariant",
  "createTemplateId",
  "pendingLeave",
  "pendingDelete",
  "pendingKindRename",
  "migrationDismissed",
] as const satisfies readonly (keyof PrayerSessionState)[];

/** Catalog fields an op may replace (entries and derived indexes excluded). */
const CATALOG_KEYS = [
  "manifest",
  "libraryStyles",
  "styleErrors",
  "libraryStylesRaw",
  "templates",
  "templateErrors",
  "templatesRaw",
  "scanComplete",
] as const satisfies readonly (keyof LibraryCatalog)[];

/**
 * Apply an async session op (save, create, delete, import, disk change) to
 * the state as it is *now*. `start` is the state the op ran on; only what the
 * op changed relative to `start` is taken, so edits that landed while it
 * awaited I/O (typing, scan chunks, library-file ops) survive.
 *
 * Conflicts: a draft the op rewrote (e.g. saved) but the user edited meanwhile
 * keeps the edit and takes the op's `saved` / `diskText`, so it stays dirty.
 * A draft the op removed (delete, discard) is removed even if edited.
 * Paths the op removed (`dropCatalogPaths`, renames, deletes) are not
 * resurrected; drafts it moved (`movedPaths`) follow to the new path.
 */
export function mergeOpResult(
  current: PrayerSessionState,
  start: PrayerSessionState,
  result: SessionOpResult,
): PrayerSessionState {
  const op = result.state;
  if (current === start) return op;
  if (op === start) return current;
  // The library changed while the op ran: its result belongs to the old one.
  if ((current.catalog?.root ?? null) !== (start.catalog?.root ?? null)) {
    return current;
  }

  const moved = result.movedPaths ?? {};
  const next: PrayerSessionState = {
    ...current,
    catalog: mergeCatalog(current.catalog, start.catalog, op.catalog, result),
    drafts: mergeDrafts(current.drafts, start.drafts, op.drafts, moved),
  };
  for (const key of SCALAR_KEYS) {
    if (op[key] !== start[key] && current[key] === start[key]) {
      (next as Record<string, unknown>)[key] = op[key];
    }
  }
  if (op.selectedPath !== start.selectedPath) {
    if (current.selectedPath === start.selectedPath) {
      next.selectedPath = op.selectedPath;
    }
  } else if (current.selectedPath && moved[current.selectedPath]) {
    next.selectedPath = moved[current.selectedPath]!;
  }
  if (next.selectedPath && !next.drafts[next.selectedPath]) {
    const known = next.catalog?.entries.some((e) => e.path === next.selectedPath);
    if (!known) next.selectedPath = null;
  }
  return next;
}

function mergeCatalog(
  current: LibraryCatalog | null,
  start: LibraryCatalog | null,
  op: LibraryCatalog | null,
  result: SessionOpResult,
): LibraryCatalog | null {
  if (!current || !op || op === start) return current;
  if (!start) return op;

  const merged: LibraryCatalog = { ...current };
  for (const key of CATALOG_KEYS) {
    if (op[key] !== start[key]) {
      (merged as Record<string, unknown>)[key] = op[key];
    }
  }

  if (op.entries !== start.entries) {
    const before = new Map(start.entries.map((e) => [e.path, e] as const));
    const after = new Map(op.entries.map((e) => [e.path, e] as const));
    const removed = new Set(result.dropCatalogPaths ?? []);
    for (const path of before.keys()) if (!after.has(path)) removed.add(path);
    const changed = new Map<string, CatalogEntry>();
    for (const [path, entry] of after) {
      if (before.get(path) !== entry) changed.set(path, entry);
    }
    const entries: CatalogEntry[] = [];
    for (const entry of current.entries) {
      if (removed.has(entry.path)) continue;
      const replacement = changed.get(entry.path);
      entries.push(replacement ?? entry);
      changed.delete(entry.path);
    }
    entries.push(...changed.values());
    merged.entries = entries;
  }
  return recomputeCatalogIndex(merged);
}

function mergeDrafts(
  current: Record<string, SessionDraft>,
  start: Record<string, SessionDraft>,
  op: Record<string, SessionDraft>,
  moved: Record<string, string>,
): Record<string, SessionDraft> {
  if (op === start) return current;
  const drafts = { ...current };
  const carried: Record<string, SessionDraft> = {};
  const paths = new Set([...Object.keys(start), ...Object.keys(op)]);
  for (const path of paths) {
    const before = start[path];
    const after = op[path];
    if (after === before) continue;
    const now = current[path];
    const target = moved[path];
    if (target && !after) {
      // Renamed on save: an edit made meanwhile moves along with the file.
      const saved = op[target];
      delete drafts[path];
      if (now && saved && now !== before) carried[target] = keepEdit(now, saved);
      continue;
    }
    if (!after) {
      // Deleted / discarded on purpose: an edit made meanwhile goes too, or it
      // would linger as an invisible unsaved draft.
      delete drafts[path];
      continue;
    }
    if (now !== before) {
      // The user edited (or closed) this draft while the op ran.
      if (now) drafts[path] = keepEdit(now, after);
      continue;
    }
    drafts[path] = after;
  }
  return { ...drafts, ...carried };
}

/** The user's draft, rebased on what the op wrote to disk. */
function keepEdit(now: SessionDraft, opDraft: SessionDraft): SessionDraft {
  return {
    ...now,
    saved: opDraft.saved,
    diskText: opDraft.diskText,
    diskConflict: opDraft.diskConflict,
    dirty: opDraft.saved ? now.prayer !== opDraft.saved : now.dirty,
  };
}
