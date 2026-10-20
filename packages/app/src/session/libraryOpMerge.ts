import type { Prayer } from "@orthodox-prayer-toolkit/core";
import type { CatalogEntry, LibraryCatalog } from "../catalog";
import { setCreateTemplate } from "./kindOps";
import type {
  PrayerSessionState,
  SessionDraft,
  SessionNotice,
  SessionOpResult,
} from "./types";

/**
 * Apply the result of an async library-file op (templates, styles,
 * migration) to the state as it is *now*, taking only what the op owns:
 * the library file fields of the catalog, catalog entries and drafts the op
 * changed, and the New prayer template stamp. Edits that landed while the op
 * was writing (draft typing, a scan chunk, other ops) are kept.
 *
 * `start` is the state the op ran on, `result` the state it returned. A
 * draft the op rewrote but the user edited meanwhile keeps the edit and
 * takes the op's saved / disk text (so it shows as unsaved, not as an
 * external change); `rebaseDraft` replays the op on that edit (e.g. a kind
 * rename), so saving it later does not undo the op.
 */
export function mergeLibraryOpResult(
  current: PrayerSessionState,
  start: PrayerSessionState,
  result: PrayerSessionState,
  options: { rebaseDraft?: (prayer: Prayer) => Prayer } = {},
): PrayerSessionState {
  const cc = current.catalog;
  const rc = result.catalog;
  if (!cc || !rc || cc.root !== rc.root || result === start) return current;

  const catalog: LibraryCatalog = {
    ...cc,
    libraryStyles: rc.libraryStyles,
    styleErrors: rc.styleErrors,
    libraryStylesRaw: rc.libraryStylesRaw,
    templates: rc.templates,
    templateErrors: rc.templateErrors,
    templatesRaw: rc.templatesRaw,
  };
  const startEntries = new Map(
    (start.catalog?.entries ?? []).map((e) => [e.path, e] as const),
  );
  const changed = new Map<string, CatalogEntry>();
  for (const entry of rc.entries) {
    if (startEntries.get(entry.path) !== entry) changed.set(entry.path, entry);
  }
  if (changed.size > 0) {
    catalog.entries = cc.entries.map((e) => changed.get(e.path) ?? e);
  }

  let drafts = current.drafts;
  for (const [path, opDraft] of Object.entries(result.drafts)) {
    const before = start.drafts[path];
    if (opDraft === before) continue;
    const now = current.drafts[path];
    if (!now) continue;
    const rebase = options.rebaseDraft ?? ((p: Prayer) => p);
    const merged: SessionDraft =
      now === before
        ? opDraft
        : {
            ...now,
            prayer: rebase(now.prayer),
            history: now.history && {
              ...now.history,
              past: now.history.past.map(rebase),
              future: now.history.future.map(rebase),
            },
            saved: opDraft.saved,
            diskText: opDraft.diskText,
            dirty: true,
          };
    if (drafts === current.drafts) drafts = { ...current.drafts };
    drafts[path] = merged;
  }

  let next: PrayerSessionState = { ...current, catalog, drafts };
  if (result.pendingKindRename !== start.pendingKindRename) {
    next.pendingKindRename = result.pendingKindRename;
  }
  if (result.createTemplateId !== start.createTemplateId) {
    next = setCreateTemplate(next, result.createTemplateId);
  }
  return next;
}

export type LibraryOpOptions<R> = {
  /** Notices to emit (default: all of the result's). */
  notices?: (result: R) => SessionNotice[];
  /** Replays the op on drafts edited while it ran (see mergeLibraryOpResult). */
  rebaseDraft?: (start: PrayerSessionState) => ((prayer: Prayer) => Prayer) | undefined;
};

export type LibraryOpRunner = <R extends SessionOpResult>(
  op: (state: PrayerSessionState) => Promise<R>,
  options?: LibraryOpOptions<R>,
) => Promise<R>;

/**
 * Serialize library-file ops (templates.json, styles.json, migration): each
 * runs on the state as it is when it starts and merges back only what it
 * owns ({@link mergeLibraryOpResult}), so quick successive edits never
 * overwrite each other. A failing op does not block the ones after it.
 */
export function createLibraryOpQueue(deps: {
  get: () => PrayerSessionState;
  set: (state: PrayerSessionState) => void;
  emit: (notices: SessionNotice[]) => void;
}): LibraryOpRunner {
  let tail: Promise<unknown> = Promise.resolve();
  return (op, options = {}) => {
    const run = tail.then(async () => {
      const start = deps.get();
      const result = await op(start);
      deps.emit(options.notices ? options.notices(result) : result.notices);
      const current = deps.get();
      const next = mergeLibraryOpResult(current, start, result.state, {
        rebaseDraft: options.rebaseDraft?.(start),
      });
      if (next !== current) deps.set(next);
      return result;
    });
    tail = run.catch(() => undefined);
    return run;
  };
}
