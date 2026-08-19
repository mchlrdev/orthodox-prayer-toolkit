import {
  DEFAULT_KIND_STYLES,
  isKindPreset,
  isValidKindId,
  prayerFilename,
  resolveDisplayTitle,
  validate,
  validateStyles,
  type LibraryManifest,
  type Prayer,
  type StyleMap,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import {
  mergeCatalogs,
  patchCatalogPrayer,
  patchCatalogText,
  removeCatalogPath,
  type CatalogEntry,
  type LibraryCatalog,
} from "../catalog";
import { emptyPrayer } from "../library";
import {
  movePrayerView,
  removePrayerView,
  savePrayerView,
} from "../viewPrefs";
import { sameVariant, type ActiveVariant } from "../variant";
import { applyDraftEdit, validationErrorsFor } from "./draftEdit";
import {
  exportPrayerVariant,
  type ExportFormat,
  type ExportOptions,
} from "./exportPrayerVariant";
import { persistPrayer } from "./persistPrayer";
import { planKindRename, renameKindAcrossLibrary } from "./renameKindLibrary";
import type {
  KindRenamePlan,
  LeaveAction,
  PrayerSessionState,
  SessionDraft,
  SessionNotice,
  SessionOpResult,
} from "./types";
import { resolveVisibleVariants } from "./visibleVariants";

export const DESKTOP_REQUIRED_NOTICE: SessionNotice = {
  color: "dark",
  title: "Desktop app required",
  message:
    "Browser preview is pinned to the examples library. Run pnpm dev:electron to open or create another folder.",
  autoClose: 6000,
};

export function emptySessionState(
  appStyles: StyleMap = { ...DEFAULT_KIND_STYLES },
): PrayerSessionState {
  return {
    catalog: null,
    drafts: {},
    selectedPath: null,
    createDraft: null,
    createVariant: null,
    appStyles,
    pendingLeave: null,
    pendingDelete: null,
    pendingKindRename: null,
  };
}

export function selectedDraft(
  state: PrayerSessionState,
): SessionDraft | undefined {
  return state.selectedPath ? state.drafts[state.selectedPath] : undefined;
}

export function dirtyDrafts(
  state: PrayerSessionState,
): Record<string, SessionDraft> {
  const out: Record<string, SessionDraft> = {};
  for (const [path, draft] of Object.entries(state.drafts)) {
    if (draft.dirty) out[path] = draft;
  }
  return out;
}

export function hasUnsaved(state: PrayerSessionState): boolean {
  return Object.values(state.drafts).some((d) => d.dirty);
}

export function sidebarEntries(state: PrayerSessionState): CatalogEntry[] {
  if (!state.catalog) return [];
  const preferred = state.catalog.manifest?.defaultVariant ?? null;
  return state.catalog.entries.map((entry) => {
    const draft = state.drafts[entry.path];
    if (!draft?.dirty) return entry;
    return {
      ...entry,
      id: draft.prayer.id,
      title: resolveDisplayTitle(draft.prayer, preferred),
      description: draft.prayer.description ?? null,
      valid: draft.errors.length === 0,
      errors: draft.errors,
    };
  });
}

export function resetForLibrary(
  state: PrayerSessionState,
): PrayerSessionState {
  return emptySessionState(state.appStyles);
}

export function clearSelection(state: PrayerSessionState): PrayerSessionState {
  const path = state.selectedPath;
  if (!path) return state;
  const drafts = { ...state.drafts };
  const current = drafts[path];
  if (current && !current.dirty) delete drafts[path];
  return { ...state, selectedPath: null, drafts };
}

export function evictPreviousClean(
  state: PrayerSessionState,
  nextPath: string,
): PrayerSessionState {
  const prev = state.selectedPath;
  if (!prev || prev === nextPath) return state;
  const previous = state.drafts[prev];
  if (!previous || previous.dirty) return state;
  const drafts = { ...state.drafts };
  delete drafts[prev];
  return { ...state, drafts };
}

export function catalogOpenNotices(
  catalog: LibraryCatalog,
  previous: LibraryCatalog | null,
): SessionNotice[] {
  const notices: SessionNotice[] = [];
  const prevCollisions = previous?.collisions.length ?? 0;
  if (catalog.collisions.length > 0 && prevCollisions === 0) {
    notices.push({
      color: "accent",
      title: "Duplicate prayer ids",
      message: catalog.collisions
        .map((c) => `${c.id}: ${c.paths.join(", ")}`)
        .join(" · "),
      autoClose: 8000,
    });
  }
  const prevStyle = previous?.styleErrors.length ?? 0;
  if (catalog.styleErrors.length > 0 && prevStyle === 0) {
    notices.push({
      color: "dark",
      title: "Library styles cleaned",
      message: catalog.styleErrors
        .slice(0, 3)
        .map((e) => e.message)
        .join(" · "),
      autoClose: 6000,
    });
  }
  return notices;
}

function retainDrafts(
  state: PrayerSessionState,
  catalog: LibraryCatalog,
): { drafts: Record<string, SessionDraft>; selectedPath: string | null } {
  const paths = new Set(catalog.entries.map((e) => e.path));
  const drafts: Record<string, SessionDraft> = {};
  for (const [path, draft] of Object.entries(state.drafts)) {
    if (!paths.has(path)) continue;
    if (draft.dirty || path === state.selectedPath) drafts[path] = draft;
  }
  const selectedPath =
    state.selectedPath && paths.has(state.selectedPath)
      ? state.selectedPath
      : null;
  return { drafts, selectedPath };
}

export function applyCatalogChunk(
  state: PrayerSessionState,
  catalog: LibraryCatalog,
  options?: { replace?: boolean },
): SessionOpResult {
  const replace = options?.replace === true;
  const nextCatalog = replace
    ? catalog
    : mergeCatalogs(catalog, state.catalog);
  const previousForNotices = replace ? null : state.catalog;
  const { drafts, selectedPath } = retainDrafts(state, nextCatalog);
  return {
    state: { ...state, catalog: nextCatalog, drafts, selectedPath },
    notices: catalogOpenNotices(nextCatalog, previousForNotices),
  };
}

export function editDraft(
  state: PrayerSessionState,
  next: Prayer,
): SessionOpResult {
  const path = state.selectedPath;
  if (!path) return { state, notices: [] };
  const current = state.drafts[path];
  if (!current) return { state, notices: [] };
  if (next === current.prayer) return { state, notices: [] };
  const edited = applyDraftEdit(next, current.visibleVariants, current.errors);
  return {
    state: {
      ...state,
      drafts: { ...state.drafts, [path]: edited },
    },
    notices: [],
  };
}

export function setDraftVisibleVariants(
  state: PrayerSessionState,
  cols: ActiveVariant[],
): PrayerSessionState {
  const path = state.selectedPath;
  if (!path) return state;
  const current = state.drafts[path];
  if (!current || current.visibleVariants === cols) return state;
  return {
    ...state,
    drafts: {
      ...state.drafts,
      [path]: { ...current, visibleVariants: cols },
    },
  };
}

export function setActiveVariant(
  state: PrayerSessionState,
  variant: ActiveVariant,
): PrayerSessionState {
  const current = selectedDraft(state);
  if (!current) return state;
  const without = current.visibleVariants.filter(
    (c) => !sameVariant(c, variant),
  );
  return setDraftVisibleVariants(state, [variant, ...without]);
}

export function setDraftErrors(
  state: PrayerSessionState,
  path: string,
  errors: ValidationError[],
): PrayerSessionState {
  const current = state.drafts[path];
  if (!current) return state;
  return {
    ...state,
    drafts: { ...state.drafts, [path]: { ...current, errors } },
  };
}

export function putPrayerFromText(
  state: PrayerSessionState,
  path: string,
  text: string,
): SessionOpResult {
  if (!state.catalog) return { state, notices: [] };

  try {
    JSON.parse(text);
  } catch {
    const catalog = patchCatalogText(state.catalog, path, text);
    return {
      state: { ...state, catalog, selectedPath: path },
      notices: [
        { color: "accent", title: "Invalid JSON", message: path },
      ],
    };
  }

  const result = validate(JSON.parse(text) as unknown);
  if (!result.ok) {
    const catalog = patchCatalogText(state.catalog, path, text);
    return {
      state: { ...state, catalog, selectedPath: path },
      notices: [],
    };
  }

  const catalog = patchCatalogPrayer(state.catalog, path, result.prayer);
  const draft: SessionDraft = {
    prayer: structuredClone(result.prayer),
    errors: [],
    visibleVariants: resolveVisibleVariants(
      result.prayer,
      catalog.root,
      path,
      catalog.manifest?.defaultVariant,
    ),
    dirty: false,
  };
  return {
    state: {
      ...state,
      catalog,
      selectedPath: path,
      drafts: { ...state.drafts, [path]: draft },
    },
    notices: [],
  };
}

export async function openPrayer(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  entry: CatalogEntry,
): Promise<SessionOpResult> {
  if (!state.catalog) return { state, notices: [] };

  if (state.selectedPath === entry.path && state.drafts[entry.path]) {
    return { state, notices: [] };
  }

  const next = evictPreviousClean(state, entry.path);
  if (next.drafts[entry.path]) {
    return {
      state: { ...next, selectedPath: entry.path },
      notices: [],
    };
  }

  try {
    const raw = await api.readText(next.catalog!.root, entry.path);
    return putPrayerFromText(next, entry.path, raw);
  } catch (err) {
    return {
      state: next,
      notices: [
        {
          color: "accent",
          title: "Could not open prayer",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}

function applyPersistedPath(
  state: PrayerSessionState,
  fromPath: string,
  toPath: string,
  prayer: Prayer,
  visibleVariants: ActiveVariant[],
  errors: ValidationError[],
): PrayerSessionState {
  if (!state.catalog) return state;
  let catalog = state.catalog;
  const drafts = { ...state.drafts };
  if (toPath !== fromPath) {
    catalog = removeCatalogPath(catalog, fromPath);
    delete drafts[fromPath];
    movePrayerView(catalog.root, fromPath, toPath);
  }
  catalog = patchCatalogPrayer(catalog, toPath, prayer);
  drafts[toPath] = {
    prayer,
    errors,
    visibleVariants,
    dirty: false,
  };
  savePrayerView(catalog.root, toPath, visibleVariants);
  const selectedPath =
    state.selectedPath === fromPath ? toPath : state.selectedPath;
  return { ...state, catalog, drafts, selectedPath };
}

export async function saveSelected(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
): Promise<SessionOpResult> {
  const path = state.selectedPath;
  const draft = path ? state.drafts[path] : undefined;
  if (!state.catalog || !path || !draft) return { state, notices: [] };

  const errors = validationErrorsFor(draft.prayer);
  const withErrors: PrayerSessionState = setDraftErrors(state, path, errors);

  const result = await persistPrayer(
    api,
    state.catalog.root,
    path,
    draft.prayer,
  );
  if (!result.ok) {
    return {
      state: withErrors,
      notices: [
        { color: "accent", title: "Cannot save", message: result.message },
      ],
    };
  }

  return {
    state: applyPersistedPath(
      withErrors,
      path,
      result.path,
      draft.prayer,
      draft.visibleVariants,
      [],
    ),
    notices: [
      {
        color: "dark",
        title: "Saved",
        message: prayerFilename(draft.prayer.id),
      },
    ],
  };
}

export async function saveAllDirty(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
): Promise<SessionOpResult> {
  if (!state.catalog) return { state, notices: [] };
  const entries = Object.entries(dirtyDrafts(state));
  if (entries.length === 0) return { state, notices: [] };

  let next = state;
  for (const [path, draft] of entries) {
    const result = await persistPrayer(
      api,
      next.catalog!.root,
      path,
      draft.prayer,
    );
    if (!result.ok) {
      return {
        state: setDraftErrors(next, path, draft.errors),
        notices: [
          {
            color: "accent",
            title: "Cannot save all",
            message: result.message,
          },
        ],
      };
    }
    next = applyPersistedPath(
      next,
      path,
      result.path,
      draft.prayer,
      draft.visibleVariants,
      [],
    );
  }

  return {
    state: next,
    notices: [
      {
        color: "dark",
        title: "Saved",
        message:
          entries.length === 1
            ? "1 prayer saved"
            : `${entries.length} prayers saved`,
      },
    ],
  };
}

export async function discardDirty(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
): Promise<SessionOpResult> {
  const selected = state.selectedPath;
  const wasDirty = selected ? state.drafts[selected]?.dirty === true : false;
  const drafts: Record<string, SessionDraft> = {};
  for (const [path, draft] of Object.entries(state.drafts)) {
    if (!draft.dirty) drafts[path] = draft;
  }
  const cleared: PrayerSessionState = { ...state, drafts };
  if (!state.catalog || !selected || !wasDirty) {
    return { state: cleared, notices: [] };
  }
  const entry = state.catalog.entries.find((e) => e.path === selected);
  if (!entry) {
    return { state: { ...cleared, selectedPath: null }, notices: [] };
  }
  try {
    const raw = await api.readText(state.catalog.root, selected);
    return putPrayerFromText(cleared, selected, raw);
  } catch {
    return { state: { ...cleared, selectedPath: null }, notices: [] };
  }
}

export function requestLeave(
  state: PrayerSessionState,
  action: LeaveAction,
): SessionOpResult {
  if (hasUnsaved(state)) {
    return { state: { ...state, pendingLeave: action }, notices: [] };
  }
  return { state: { ...state, pendingLeave: null }, notices: [] };
}

export function clearPendingLeave(
  state: PrayerSessionState,
): PrayerSessionState {
  return { ...state, pendingLeave: null };
}

export function clearDirtyDrafts(
  state: PrayerSessionState,
): PrayerSessionState {
  const drafts: Record<string, SessionDraft> = {};
  for (const [path, draft] of Object.entries(state.drafts)) {
    if (!draft.dirty) drafts[path] = draft;
  }
  return { ...state, drafts };
}

export async function beginCreatePrayer(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
): Promise<SessionOpResult> {
  if (!state.catalog || state.createDraft) return { state, notices: [] };
  let n = 1;
  let id = `new-prayer-${n}`;
  while (await api.exists(state.catalog.root, prayerFilename(id))) {
    n += 1;
    id = `new-prayer-${n}`;
  }
  return {
    state: {
      ...state,
      createDraft: emptyPrayer(id),
      createVariant: { lang: "de", variant: "standard" },
    },
    notices: [],
  };
}

export function cancelCreatePrayer(
  state: PrayerSessionState,
): PrayerSessionState {
  return { ...state, createDraft: null, createVariant: null };
}

export async function commitCreatePrayer(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
): Promise<SessionOpResult> {
  if (!state.catalog || !state.createDraft || !state.createVariant) {
    return { state, notices: [] };
  }

  const result = validate(state.createDraft);
  if (!result.ok) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Cannot create",
          message: result.errors.map((e) => e.message).join(" · "),
        },
      ],
    };
  }

  const path = prayerFilename(state.createDraft.id);
  const exists = await api.exists(state.catalog.root, path);
  if (exists) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Id collision",
          message: `File ${path} already exists. Choose another id.`,
        },
      ],
    };
  }

  try {
    await api.writeText(
      state.catalog.root,
      path,
      `${JSON.stringify(state.createDraft, null, 2)}\n`,
    );
    const prayer = structuredClone(state.createDraft);
    const variant = state.createVariant;
    const evicted = evictPreviousClean(state, path);
    const catalog = patchCatalogPrayer(evicted.catalog!, path, prayer);
    savePrayerView(catalog.root, path, [variant]);
    return {
      state: {
        ...evicted,
        catalog,
        selectedPath: path,
        drafts: {
          ...evicted.drafts,
          [path]: {
            prayer,
            errors: [],
            visibleVariants: [variant],
            dirty: false,
          },
        },
        createDraft: null,
        createVariant: null,
      },
      notices: [{ color: "dark", title: "Created", message: path }],
    };
  } catch (err) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Create failed",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}

export async function deletePrayer(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  entry: CatalogEntry,
): Promise<SessionOpResult> {
  if (!state.catalog) return { state, notices: [] };
  try {
    await api.deleteFile(state.catalog.root, entry.path);
    removePrayerView(state.catalog.root, entry.path);
    const drafts = { ...state.drafts };
    delete drafts[entry.path];
    const selectedPath =
      state.selectedPath === entry.path ? null : state.selectedPath;
    return {
      state: {
        ...state,
        catalog: removeCatalogPath(state.catalog, entry.path),
        drafts,
        selectedPath,
        pendingDelete: null,
      },
      notices: [{ color: "dark", title: "Deleted", message: entry.path }],
    };
  } catch (err) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Delete failed",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}

export async function saveLibraryManifest(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  manifest: LibraryManifest,
): Promise<SessionOpResult> {
  if (!state.catalog) return { state, notices: [] };
  try {
    await api.writeText(
      state.catalog.root,
      "manifest.json",
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return {
      state: {
        ...state,
        catalog: { ...state.catalog, manifest },
      },
      notices: [
        {
          color: "dark",
          title: "Library updated",
          message: "manifest.json saved",
        },
      ],
    };
  } catch (err) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Could not save library settings",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}

export async function persistAppStyles(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  next: StyleMap,
): Promise<SessionOpResult> {
  const checked = validateStyles(next);
  if (!checked.ok) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Cannot save app styles",
          message: checked.errors.map((e) => e.message).join(" · "),
        },
      ],
    };
  }
  await api.writeAppStyles(`${JSON.stringify(checked.styles, null, 2)}\n`);
  return {
    state: { ...state, appStyles: checked.styles },
    notices: [],
  };
}

export async function persistLibraryStyles(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  next: StyleMap,
): Promise<SessionOpResult> {
  if (!state.catalog) return { state, notices: [] };
  const checked = validateStyles(next);
  if (!checked.ok) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Cannot save library styles",
          message: checked.errors.map((e) => e.message).join(" · "),
        },
      ],
    };
  }
  await api.writeLibraryStyles(
    state.catalog.root,
    `${JSON.stringify(checked.styles, null, 2)}\n`,
  );
  return {
    state: {
      ...state,
      catalog: {
        ...state.catalog,
        libraryStyles: checked.styles,
        styleErrors: [],
      },
    },
    notices: [],
  };
}

export async function exportEntry(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  entry: CatalogEntry,
  variant: ActiveVariant,
  format: ExportFormat = "flat-json",
  options: ExportOptions = {},
): Promise<SessionOpResult & { exportedPath: string | null | false }> {
  if (!state.catalog) {
    return { state, notices: [], exportedPath: false };
  }

  let prayer: Prayer | null = null;
  if (state.selectedPath === entry.path) {
    prayer = state.drafts[entry.path]?.prayer ?? null;
  }
  if (!prayer && state.drafts[entry.path]?.dirty) {
    prayer = state.drafts[entry.path]!.prayer;
  }
  if (!prayer) {
    try {
      const raw = await api.readText(state.catalog.root, entry.path);
      const result = validate(JSON.parse(raw) as unknown);
      if (!result.ok) {
        return {
          state,
          notices: [
            {
              color: "accent",
              title: "Cannot export",
              message: "Prayer is invalid.",
            },
          ],
          exportedPath: false,
        };
      }
      prayer = result.prayer;
    } catch (err) {
      return {
        state,
        notices: [
          {
            color: "accent",
            title: "Export failed",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        exportedPath: false,
      };
    }
  }

  try {
    const path = await exportPrayerVariant(
      api,
      prayer,
      variant,
      format,
      options,
    );
    return {
      state,
      notices: path
        ? [{ color: "dark", title: "Exported", message: path }]
        : [],
      exportedPath: path,
    };
  } catch (err) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Export failed",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
      exportedPath: false,
    };
  }
}

export async function applyKindRename(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  plan: KindRenamePlan,
): Promise<SessionOpResult> {
  if (!state.catalog) return { state, notices: [] };
  try {
    const result = await renameKindAcrossLibrary(api, state.catalog, plan, {
      drafts: state.drafts,
      appStyles: state.appStyles,
      libraryStyles: state.catalog.libraryStyles,
    });
    let catalog = state.catalog;
    for (const { path, prayer } of result.written) {
      catalog = patchCatalogPrayer(catalog, path, prayer);
    }
    catalog = {
      ...catalog,
      libraryStyles: result.libraryStyles,
      styleErrors: [],
    };
    await api.writeAppStyles(
      `${JSON.stringify(result.appStyles, null, 2)}\n`,
    );
    await api.writeLibraryStyles(
      state.catalog.root,
      `${JSON.stringify(result.libraryStyles, null, 2)}\n`,
    );
    const skippedNote =
      result.skipped.length > 0
        ? ` · ${result.skipped.length} skipped`
        : "";
    return {
      state: {
        ...state,
        catalog,
        drafts: result.drafts,
        appStyles: result.appStyles,
        pendingKindRename: null,
      },
      notices: [
        {
          color: "dark",
          title: "Kind renamed",
          message: `“${plan.from}” → “${plan.to}” in ${result.writtenPaths.length} prayer${result.writtenPaths.length === 1 ? "" : "s"}${skippedNote}`,
        },
      ],
    };
  } catch (err) {
    return {
      state: { ...state, pendingKindRename: null },
      notices: [
        {
          color: "accent",
          title: "Kind rename failed",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
}

export async function requestKindRename(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  from: string,
  to: string,
): Promise<SessionOpResult> {
  if (
    !state.catalog ||
    from === to ||
    !isValidKindId(to.trim()) ||
    isKindPreset(from)
  ) {
    return { state, notices: [] };
  }
  const plan = await planKindRename(api, state.catalog, from, to.trim(), {
    drafts: state.drafts,
  });
  if (plan.affectedPaths.length <= 1) {
    return applyKindRename(state, api, plan);
  }
  return {
    state: { ...state, pendingKindRename: plan },
    notices: [],
  };
}

export function errorNotice(title: string, err: unknown): SessionNotice {
  return {
    color: "accent",
    title,
    message: err instanceof Error ? err.message : String(err),
  };
}
