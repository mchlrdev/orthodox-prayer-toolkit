import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  resolveStyles,
  type LibraryManifest,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { getToolkitApi, isBrowserDev } from "./api";
import { scanLibraryCatalog } from "./catalog";
import type { LibraryEntry } from "./library";
import {
  applyKindRename,
  applyCatalogChunk,
  beginCreatePrayer,
  cancelCreatePrayer,
  clearDirtyDrafts,
  clearPendingLeave,
  clearSelection,
  commitCreatePrayer,
  deletePrayer,
  DESKTOP_REQUIRED_NOTICE,
  dirtyDrafts,
  discardDirty,
  DRAFT_VALIDATE_DEBOUNCE_MS,
  editDraft,
  emptySessionState,
  errorNotice,
  exportEntry,
  exportPrayerFile,
  importPrayerFile,
  hasUnsaved,
  evictPreviousClean,
  mergeOpResult,
  persistAppStyles as persistAppStylesOp,
  persistLibraryStyles as persistLibraryStylesOp,
  parseAppStyles,
  putPrayerFromText,
  requestKindRename,
  requestLeave,
  resetForLibrary,
  saveAllDirty,
  saveLibraryManifest as saveLibraryManifestOp,
  saveSelected,
  selectedDraft,
  setActiveVariant as setActiveVariantOp,
  setDraftErrors,
  setDraftVisibleVariants,
  sidebarEntries,
  validationErrorsFor,
  type ExportFormat,
  type HtmlExportRequest,
  type LayoutExportRequest,
  type LeaveAction,
  type PrayerSessionState,
  type SessionNotice,
  type SessionOpResult,
} from "./session";
import type { ActiveVariant } from "./variant";
import {
  loadRecentLibraries,
  pushRecentLibrary,
  removeRecentLibrary,
  type RecentLibrary,
} from "./recentLibraries";
import { savePrayerView } from "./viewPrefs";

export function usePrayerSession(opts?: {
  onNotice?: (n: SessionNotice) => void;
}) {
  const api = getToolkitApi();
  const onNotice = opts?.onNotice;

  const [state, setState] = useState<PrayerSessionState>(() =>
    emptySessionState(),
  );
  const [opBusy, setOpBusy] = useState(false);
  const [awaitingCatalog, setAwaitingCatalog] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [kindRenameBusy, setKindRenameBusy] = useState(false);
  const [recentLibraries, setRecentLibraries] = useState<RecentLibrary[]>(() =>
    loadRecentLibraries(),
  );

  const stateRef = useRef(state);
  stateRef.current = state;
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanGenRef = useRef(0);

  const emit = useCallback(
    (notices: SessionNotice[]) => {
      if (!onNotice) return;
      for (const notice of notices) onNotice(notice);
    },
    [onNotice],
  );

  const commit = useCallback(
    (result: SessionOpResult, merge = false) => {
      emit(result.notices);
      const next = merge
        ? mergeOpResult(stateRef.current, result)
        : result.state;
      stateRef.current = next;
      setState(next);
    },
    [emit],
  );

  const cancelDraftValidation = useCallback(() => {
    if (validateTimerRef.current !== null) {
      clearTimeout(validateTimerRef.current);
      validateTimerRef.current = null;
    }
  }, []);

  const scheduleDraftValidation = useCallback(
    (path: string) => {
      cancelDraftValidation();
      validateTimerRef.current = setTimeout(() => {
        validateTimerRef.current = null;
        const draft = stateRef.current.drafts[path];
        if (!draft) return;
        const errors = validationErrorsFor(draft.prayer);
        const next = setDraftErrors(stateRef.current, path, errors);
        stateRef.current = next;
        setState(next);
      }, DRAFT_VALIDATE_DEBOUNCE_MS);
    },
    [cancelDraftValidation],
  );

  const persistCurrentView = useCallback(() => {
    const catalog = stateRef.current.catalog;
    const path = stateRef.current.selectedPath;
    const cols = selectedDraft(stateRef.current)?.visibleVariants ?? [];
    if (!catalog || !path || cols.length === 0) return;
    savePrayerView(catalog.root, path, cols);
  }, []);

  const rememberRecent = useCallback((root: string) => {
    setRecentLibraries(pushRecentLibrary(root));
  }, []);

  const forgetRecent = useCallback((root: string) => {
    setRecentLibraries(removeRecentLibrary(root));
  }, []);

  const startCatalogScan = useCallback(
    async (root: string) => {
      const gen = ++scanGenRef.current;
      setAwaitingCatalog(true);
      rememberRecent(root);
      try {
        let first = true;
        for await (const catalog of scanLibraryCatalog(root, api)) {
          if (scanGenRef.current !== gen) return;
          let notices: SessionNotice[] = [];
          setState((current) => {
            const result = applyCatalogChunk(current, catalog, {
              replace: first,
            });
            notices = result.notices;
            stateRef.current = result.state;
            return result.state;
          });
          first = false;
          setAwaitingCatalog(false);
          emit(notices);
        }
      } catch (err) {
        if (scanGenRef.current !== gen) return;
        setAwaitingCatalog(false);
        emit([errorNotice("Could not open library", err)]);
      } finally {
        if (scanGenRef.current === gen) setAwaitingCatalog(false);
      }
    },
    [api, emit, rememberRecent],
  );

  const selected = selectedDraft(state);
  const draft = selected?.prayer ?? null;
  const draftErrors =
    selected?.errors ??
    state.catalog?.entries.find((e) => e.path === state.selectedPath)
      ?.errors ??
    [];
  const visibleVariants = selected?.visibleVariants ?? [];
  const dirty = selected?.dirty === true;
  const unsaved = dirtyDrafts(state);
  const unsavedCount = Object.keys(unsaved).length;
  const sessionHasUnsaved = hasUnsaved(state);
  const library = state.catalog;
  const selectedPath = state.selectedPath;
  const busy = opBusy || awaitingCatalog;
  const activeVariant = visibleVariants[0] ?? null;

  useEffect(() => {
    void api
      .readAppStyles()
      .then((raw) => {
        const styles = parseAppStyles(raw);
        setState((prev) => {
          const next = { ...prev, appStyles: styles };
          stateRef.current = next;
          return next;
        });
      })
      .catch((err: unknown) => {
        console.error("Failed to load app styles", err);
      });
  }, [api]);

  const resolvedStyles = useMemo(() => {
    const discovered = new Set(library?.kinds ?? []);
    if (draft) {
      for (const block of draft.structure) discovered.add(block.kind);
    }
    return resolveStyles({
      discoveredKinds: [...discovered],
      libraryOverrides: library?.libraryStyles,
    });
  }, [library, draft]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const startupRoot = await api.getStartupLibrary();
        if (cancelled || !startupRoot) return;
        await startCatalogScan(startupRoot);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to open example library", err);
        emit([errorNotice("Example library", err)]);
      }
    })();
    return () => {
      cancelled = true;
      scanGenRef.current += 1;
    };
  }, [api, emit, startCatalogScan]);

  const activateLibraryRoot = useCallback(
    async (root: string): Promise<boolean> => {
      if (hasUnsaved(stateRef.current)) {
        commit(requestLeave(stateRef.current, { type: "open-folder", root }));
        return false;
      }
      commit({ state: resetForLibrary(stateRef.current), notices: [] });
      await startCatalogScan(root);
      return true;
    },
    [commit, startCatalogScan],
  );

  const openFolder = async (): Promise<boolean> => {
    if (isBrowserDev()) {
      emit([DESKTOP_REQUIRED_NOTICE]);
      return false;
    }
    const root = await api.openLibraryFolder();
    if (!root) return false;
    return activateLibraryRoot(root);
  };

  const openRecentLibrary = async (path: string): Promise<boolean> => {
    if (isBrowserDev()) {
      emit([DESKTOP_REQUIRED_NOTICE]);
      return false;
    }
    try {
      const root = await api.openLibraryPath(path);
      return await activateLibraryRoot(root);
    } catch (err) {
      forgetRecent(path);
      emit([errorNotice("Could not open library", err)]);
      return false;
    }
  };

  const createLibrary = async (input: {
    name: string;
    manifest: LibraryManifest;
  }): Promise<boolean> => {
    if (isBrowserDev()) {
      emit([DESKTOP_REQUIRED_NOTICE]);
      return false;
    }
    try {
      const root = await api.createLibraryFolder({
        name: input.name,
        manifestJson: `${JSON.stringify(input.manifest, null, 2)}\n`,
      });
      if (!root) return false;
      emit([
        {
          color: "dark",
          title: "Library created",
          message: "manifest.json written",
        },
      ]);
      return await activateLibraryRoot(root);
    } catch (err) {
      emit([errorNotice("Could not create library", err)]);
      return false;
    }
  };

  const requestReloadLibrary = () => {
    const catalog = stateRef.current.catalog;
    if (!catalog) return;
    if (hasUnsaved(stateRef.current)) {
      commit(
        requestLeave(stateRef.current, { type: "reload-library" }),
      );
      return;
    }
    void startCatalogScan(catalog.root);
  };

  const saveLibraryManifest = async (manifest: LibraryManifest) => {
    setOpBusy(true);
    try {
      const result = await saveLibraryManifestOp(
        stateRef.current,
        api,
        manifest,
      );
      commit(result, true);
      if (result.notices.some((n) => n.color === "accent")) {
        throw new Error(result.notices[0]?.message ?? "Could not save");
      }
    } finally {
      setOpBusy(false);
    }
  };

  const openEntry = async (
    entry: LibraryEntry,
    opts?: { openSettings?: boolean; openStyles?: boolean },
  ): Promise<{ openSettings?: boolean; openStyles?: boolean } | null> => {
    if (!stateRef.current.catalog) return null;
    if (
      stateRef.current.selectedPath === entry.path &&
      stateRef.current.drafts[entry.path]
    ) {
      return opts ?? null;
    }
    cancelDraftValidation();
    persistCurrentView();
    const cached = stateRef.current.drafts[entry.path];
    if (cached) {
      const next = {
        ...evictPreviousClean(stateRef.current, entry.path),
        selectedPath: entry.path,
      };
      stateRef.current = next;
      setState(next);
      return opts ?? null;
    }
    try {
      const raw = await api.readText(stateRef.current.catalog.root, entry.path);
      let notices: SessionNotice[] = [];
      setState((current) => {
        const evicted = evictPreviousClean(current, entry.path);
        if (evicted.drafts[entry.path]) {
          const next = { ...evicted, selectedPath: entry.path };
          stateRef.current = next;
          return next;
        }
        const result = putPrayerFromText(evicted, entry.path, raw);
        notices = result.notices;
        stateRef.current = result.state;
        return result.state;
      });
      emit(notices);
      return stateRef.current.selectedPath === entry.path ? (opts ?? null) : null;
    } catch (err) {
      emit([errorNotice("Could not open prayer", err)]);
      return null;
    }
  };

  const updateDraft = (next: Prayer) => {
    const result = editDraft(stateRef.current, next);
    if (result.state === stateRef.current) return;
    commit(result);
    if (result.state.selectedPath) {
      scheduleDraftValidation(result.state.selectedPath);
    }
  };

  const setVisibleVariants = (cols: ActiveVariant[]) => {
    const next = setDraftVisibleVariants(stateRef.current, cols);
    stateRef.current = next;
    setState(next);
  };

  const setActiveVariant = (v: ActiveVariant) => {
    const next = setActiveVariantOp(stateRef.current, v);
    stateRef.current = next;
    setState(next);
  };

  const saveDraft = async () => {
    cancelDraftValidation();
    setOpBusy(true);
    try {
      commit(await saveSelected(stateRef.current, api), true);
    } finally {
      setOpBusy(false);
    }
  };

  const saveAllUnsaved = async (): Promise<boolean> => {
    cancelDraftValidation();
    persistCurrentView();
    setOpBusy(true);
    try {
      const result = await saveAllDirty(stateRef.current, api);
      commit(result, true);
      return !result.notices.some((n) => n.color === "accent");
    } finally {
      setOpBusy(false);
    }
  };

  const beginCreate = async () => {
    commit(await beginCreatePrayer(stateRef.current, api), true);
  };

  const cancelCreate = () => {
    const next = cancelCreatePrayer(stateRef.current);
    stateRef.current = next;
    setState(next);
    setCreateBusy(false);
  };

  const commitCreate = async () => {
    persistCurrentView();
    setCreateBusy(true);
    try {
      commit(await commitCreatePrayer(stateRef.current, api), true);
    } finally {
      setCreateBusy(false);
    }
  };

  const deleteEntry = async (entry: LibraryEntry) => {
    setDeleteBusy(true);
    try {
      if (stateRef.current.selectedPath === entry.path) {
        cancelDraftValidation();
      }
      commit(await deletePrayer(stateRef.current, api, entry), true);
    } finally {
      setDeleteBusy(false);
    }
  };

  const exportEntryFn = async (
    entry: LibraryEntry,
    variant: ActiveVariant,
    format: ExportFormat = "flat-json",
    options: {
      includeBlocksWithoutTranslation?: boolean;
      html?: HtmlExportRequest;
      layout?: LayoutExportRequest;
    } = {},
  ): Promise<string | null | false> => {
    const result = await exportEntry(
      stateRef.current,
      api,
      entry,
      variant,
      format,
      options,
    );
    emit(result.notices);
    return result.exportedPath;
  };

  const exportPrayerFileFn = async (entry: LibraryEntry) => {
    const result = await exportPrayerFile(stateRef.current, api, entry);
    emit(result.notices);
  };

  const importPrayerFileFn = async () => {
    setOpBusy(true);
    try {
      persistCurrentView();
      commit(await importPrayerFile(stateRef.current, api), true);
    } finally {
      setOpBusy(false);
    }
  };

  const persistAppStyles = async (next: StyleMap) => {
    commit(await persistAppStylesOp(stateRef.current, api, next), true);
  };

  const persistLibraryStyles = async (next: StyleMap) => {
    commit(await persistLibraryStylesOp(stateRef.current, api, next), true);
  };

  const requestKindRenameFn = async (from: string, to: string) => {
    cancelDraftValidation();
    persistCurrentView();
    setKindRenameBusy(true);
    try {
      commit(await requestKindRename(stateRef.current, api, from, to), true);
    } finally {
      setKindRenameBusy(false);
    }
  };

  const confirmKindRename = async () => {
    const plan = stateRef.current.pendingKindRename;
    if (!plan) return;
    setKindRenameBusy(true);
    try {
      cancelDraftValidation();
      persistCurrentView();
      commit(await applyKindRename(stateRef.current, api, plan), true);
    } finally {
      setKindRenameBusy(false);
    }
  };

  const cancelKindRename = () => {
    const next = { ...stateRef.current, pendingKindRename: null };
    stateRef.current = next;
    setState(next);
  };

  const finishLeave = async (action: LeaveAction) => {
    switch (action.type) {
      case "close-window":
        api.confirmClose();
        break;
      case "reload-library":
        if (stateRef.current.catalog) {
          await startCatalogScan(stateRef.current.catalog.root);
        }
        break;
      case "open-folder":
        commit({ state: resetForLibrary(stateRef.current), notices: [] });
        await startCatalogScan(action.root);
        break;
    }
  };

  const handleLeaveSaveAll = async (): Promise<LeaveAction | null> => {
    const pending = stateRef.current.pendingLeave;
    if (!pending) return null;
    setLeaveBusy(true);
    try {
      const ok = await saveAllUnsaved();
      if (!ok) return null;
      commit({
        state: clearPendingLeave(stateRef.current),
        notices: [],
      });
      await finishLeave(pending);
      return pending;
    } finally {
      setLeaveBusy(false);
    }
  };

  const handleLeaveDiscard = async (): Promise<LeaveAction | null> => {
    const pending = stateRef.current.pendingLeave;
    if (!pending) return null;
    setLeaveBusy(true);
    try {
      if (pending.type === "close-window" || pending.type === "open-folder") {
        commit({
          state: clearPendingLeave(clearDirtyDrafts(stateRef.current)),
          notices: [],
        });
      } else {
        commit(await discardDirty(stateRef.current, api), true);
        commit({
          state: clearPendingLeave(stateRef.current),
          notices: [],
        });
      }
      await finishLeave(pending);
      return pending;
    } finally {
      setLeaveBusy(false);
    }
  };

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsaved(stateRef.current)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (isBrowserDev()) return;
    api.setDirty(sessionHasUnsaved);
  }, [api, sessionHasUnsaved]);

  useEffect(() => {
    if (isBrowserDev()) return;
    return api.onCloseRequested(() => {
      persistCurrentView();
      commit(
        requestLeave(stateRef.current, { type: "close-window" }),
      );
    });
  }, [api, commit, persistCurrentView]);

  useEffect(() => {
    if (!library || !selectedPath || visibleVariants.length === 0) return;
    savePrayerView(library.root, selectedPath, visibleVariants);
  }, [library, selectedPath, visibleVariants]);

  const folderBasename = library
    ? (library.root.split(/[/\\]/).filter(Boolean).pop() ?? null)
    : null;

  const listEntries = useMemo(() => sidebarEntries(state), [state]);

  return {
    library,
    selectedPath,
    draft,
    draftErrors,
    unsaved,
    visibleVariants,
    setVisibleVariants,
    activeVariant,
    appStyles: state.appStyles,
    busy,
    dirty,
    unsavedCount,
    hasUnsaved: sessionHasUnsaved,
    resolvedStyles,
    folderBasename,
    folderLabel: folderBasename,
    sidebarEntries: listEntries,
    recentLibraries,
    removeRecentLibrary: forgetRecent,
    createDraft: state.createDraft,
    createVariant: state.createVariant,
    createBusy,
    pendingDelete: state.pendingDelete,
    setPendingDelete: (entry: LibraryEntry | null) => {
      const next = { ...stateRef.current, pendingDelete: entry };
      stateRef.current = next;
      setState(next);
    },
    deleteBusy,
    pendingLeave: state.pendingLeave,
    setPendingLeave: (action: LeaveAction | null) => {
      const next = { ...stateRef.current, pendingLeave: action };
      stateRef.current = next;
      setState(next);
    },
    leaveBusy,
    openFolder,
    openRecentLibrary,
    createLibrary,
    requestReloadLibrary,
    saveLibraryManifest,
    openEntry,
    updateDraft,
    setActiveVariant,
    setCreateDraft: (prayer: Prayer | null) => {
      const next = { ...stateRef.current, createDraft: prayer };
      stateRef.current = next;
      setState(next);
    },
    setCreateVariant: (variant: ActiveVariant | null) => {
      const next = { ...stateRef.current, createVariant: variant };
      stateRef.current = next;
      setState(next);
    },
    saveDraft,
    beginCreatePrayer: beginCreate,
    cancelCreatePrayer: cancelCreate,
    commitCreatePrayer: commitCreate,
    deleteEntry,
    exportEntry: exportEntryFn,
    exportPrayerFile: exportPrayerFileFn,
    importPrayerFile: importPrayerFileFn,
    persistAppStyles,
    persistLibraryStyles,
    handleLeaveSaveAll,
    handleLeaveDiscard,
    clearEditor: () => {
      cancelDraftValidation();
      const next = clearSelection(stateRef.current);
      stateRef.current = next;
      setState(next);
    },
    pendingKindRename: state.pendingKindRename,
    kindRenameBusy,
    requestKindRename: requestKindRenameFn,
    confirmKindRename,
    cancelKindRename,
  };
}
