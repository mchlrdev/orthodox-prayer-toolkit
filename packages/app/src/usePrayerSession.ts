import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import {
  DEFAULT_KIND_STYLES,
  isKindPreset,
  isValidKindId,
  prayerFilename,
  resolveDisplayTitle,
  resolveStyles,
  validate,
  validateStyles,
  type LibraryManifest,
  type Prayer,
  type StyleMap,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";
import { getToolkitApi, isBrowserDev } from "./api";
import {
  emptyPrayer,
  loadLibrary,
  type LibraryEntry,
  type OpenedLibrary,
} from "./library";
import {
  applyDraftEdit,
  DRAFT_VALIDATE_DEBOUNCE_MS,
  exportPrayerVariant,
  parseAppStyles,
  planKindRename,
  persistPrayer,
  renameKindAcrossLibrary,
  resolveVisibleVariants,
  validationErrorsFor,
  type ExportFormat,
  type HtmlExportRequest,
  type LayoutExportRequest,
  type KindRenamePlan,
  type LeaveAction,
  type SessionDraft,
} from "./session";
import { sameVariant, type ActiveVariant } from "./variant";
import {
  loadRecentLibraries,
  pushRecentLibrary,
  removeRecentLibrary,
  type RecentLibrary,
} from "./recentLibraries";
import {
  movePrayerView,
  removePrayerView,
  savePrayerView,
} from "./viewPrefs";

function showDesktopRequired(): void {
  notifications.show({
    color: "dark",
    title: "Desktop app required",
    message:
      "Browser preview is pinned to the examples library. Run pnpm dev:electron to open or create another folder.",
    autoClose: 6000,
  });
}

/**
 * Prayer session module — library open/reload, drafts, dirty map, save/leave,
 * create/delete/export. UI chrome (modals open flags) stays in App.
 */
export function usePrayerSession() {
  const api = getToolkitApi();

  const [library, setLibrary] = useState<OpenedLibrary | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState<Prayer | null>(null);
  const [draftErrors, setDraftErrors] = useState<ValidationError[]>([]);
  const [unsaved, setUnsaved] = useState<Record<string, SessionDraft>>({});
  const [visibleVariants, setVisibleVariants] = useState<ActiveVariant[]>([]);
  const [appStyles, setAppStyles] = useState<StyleMap>({
    ...DEFAULT_KIND_STYLES,
  });
  const [busy, setBusy] = useState(false);
  const [createDraft, setCreateDraft] = useState<Prayer | null>(null);
  const [createVariant, setCreateVariant] = useState<ActiveVariant | null>(
    null,
  );
  const [createBusy, setCreateBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryEntry | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<LeaveAction | null>(null);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [pendingKindRename, setPendingKindRename] =
    useState<KindRenamePlan | null>(null);
  const [kindRenameBusy, setKindRenameBusy] = useState(false);
  const [recentLibraries, setRecentLibraries] = useState<RecentLibrary[]>(() =>
    loadRecentLibraries(),
  );

  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const selectedPathRef = useRef(selectedPath);
  selectedPathRef.current = selectedPath;
  const visibleVariantsRef = useRef(visibleVariants);
  visibleVariantsRef.current = visibleVariants;
  const draftErrorsRef = useRef(draftErrors);
  draftErrorsRef.current = draftErrors;
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        const prayer =
          selectedPathRef.current === path
            ? draftRef.current
            : (unsavedRef.current[path]?.prayer ?? null);
        if (!prayer) return;
        const errors = validationErrorsFor(prayer);
        if (selectedPathRef.current === path) {
          setDraftErrors(errors);
        }
        setUnsaved((prev) => {
          const current = prev[path];
          if (!current) return prev;
          return {
            ...prev,
            [path]: { ...current, errors },
          };
        });
      }, DRAFT_VALIDATE_DEBOUNCE_MS);
    },
    [cancelDraftValidation],
  );

  const persistCurrentView = useCallback(() => {
    const root = libraryRef.current?.root;
    const path = selectedPathRef.current;
    const cols = visibleVariantsRef.current;
    if (!root || !path || cols.length === 0) return;
    savePrayerView(root, path, cols);
  }, []);

  const dirty = selectedPath !== null && selectedPath in unsaved;
  const unsavedCount = Object.keys(unsaved).length;
  const hasUnsaved = unsavedCount > 0;
  const activeVariant = visibleVariants[0] ?? null;

  useEffect(() => {
    void api
      .readAppStyles()
      .then((raw) => {
        setAppStyles(parseAppStyles(raw));
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

  const clearEditor = useCallback(() => {
    cancelDraftValidation();
    setSelectedPath(null);
    setDraft(null);
    setDraftErrors([]);
    setVisibleVariants([]);
  }, [cancelDraftValidation]);

  const clearSession = useCallback(() => {
    setUnsaved({});
    clearEditor();
  }, [clearEditor]);

  const rememberRecent = useCallback((root: string) => {
    setRecentLibraries(pushRecentLibrary(root));
  }, []);

  const forgetRecent = useCallback((root: string) => {
    setRecentLibraries(removeRecentLibrary(root));
  }, []);

  const refreshLibrary = useCallback(
    async (root: string, keepPath?: string | null) => {
      setBusy(true);
      try {
        const opened = await loadLibrary(root, api);
        setLibrary(opened);
        rememberRecent(root);
        const path = keepPath ?? selectedPathRef.current;

        setUnsaved((prev) => {
          const next: Record<string, SessionDraft> = {};
          for (const [p, session] of Object.entries(prev)) {
            if (opened.entries.some((e) => e.path === p)) {
              next[p] = session;
            }
          }
          return next;
        });

        if (path && opened.entries.some((e) => e.path === path)) {
          setSelectedPath(path);
        } else {
          clearEditor();
        }
        if (opened.collisions.length > 0) {
          notifications.show({
            color: "accent",
            title: "Duplicate prayer ids",
            message: opened.collisions
              .map((c) => `${c.id}: ${c.paths.join(", ")}`)
              .join(" · "),
            autoClose: 8000,
          });
        }
        if (opened.styleErrors.length > 0) {
          notifications.show({
            color: "dark",
            title: "Library styles cleaned",
            message: opened.styleErrors
              .slice(0, 3)
              .map((e) => e.message)
              .join(" · "),
            autoClose: 6000,
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [api, clearEditor, rememberRecent],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const startupRoot = await api.getStartupLibrary();
        if (cancelled || !startupRoot) return;
        setBusy(true);
        const opened = await loadLibrary(startupRoot, api);
        if (cancelled) return;
        setLibrary(opened);
        rememberRecent(startupRoot);
        if (opened.collisions.length > 0) {
          notifications.show({
            color: "accent",
            title: "Duplicate prayer ids",
            message: opened.collisions
              .map((c) => `${c.id}: ${c.paths.join(", ")}`)
              .join(" · "),
            autoClose: 8000,
          });
        }
        if (opened.styleErrors.length > 0) {
          notifications.show({
            color: "dark",
            title: "Library styles cleaned",
            message: opened.styleErrors
              .slice(0, 3)
              .map((e) => e.message)
              .join(" · "),
            autoClose: 6000,
          });
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to open example library", err);
        notifications.show({
          color: "accent",
          title: "Example library",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, rememberRecent]);

  const snapshotCurrentIfDirty = useCallback(() => {
    const path = selectedPathRef.current;
    const prayer = draftRef.current;
    if (!path || !prayer || !(path in unsavedRef.current)) return;
    setUnsaved((prev) => ({
      ...prev,
      [path]: {
        prayer,
        errors: draftErrorsRef.current,
        visibleVariants: visibleVariantsRef.current,
      },
    }));
  }, []);

  /** Switch to an already-allowed library root, respecting unsaved drafts. */
  const activateLibraryRoot = useCallback(
    async (root: string): Promise<boolean> => {
      if (Object.keys(unsavedRef.current).length > 0) {
        snapshotCurrentIfDirty();
        setPendingLeave({ type: "open-folder", root });
        return false;
      }
      clearSession();
      await refreshLibrary(root, null);
      return true;
    },
    [clearSession, refreshLibrary, snapshotCurrentIfDirty],
  );

  const applySession = useCallback((path: string, session: SessionDraft) => {
    setSelectedPath(path);
    setDraft(structuredClone(session.prayer));
    setDraftErrors(session.errors);
    setVisibleVariants(session.visibleVariants);
  }, []);

  const loadPrayerFromDisk = useCallback(
    async (
      entry: LibraryEntry,
      opts?: { openSettings?: boolean; openStyles?: boolean },
    ): Promise<{ openSettings?: boolean; openStyles?: boolean } | null> => {
      const lib = libraryRef.current;
      if (!lib) return null;
      setBusy(true);
      try {
        const raw = await api.readText(lib.root, entry.path);
        let data: unknown;
        try {
          data = JSON.parse(raw);
        } catch {
          notifications.show({
            color: "accent",
            title: "Invalid JSON",
            message: entry.path,
          });
          setDraft(null);
          setDraftErrors([{ path: "/", message: "Invalid JSON" }]);
          setSelectedPath(entry.path);
          setVisibleVariants([]);
          return null;
        }

        const result = validate(data);
        setSelectedPath(entry.path);
        if (!result.ok) {
          setDraft(null);
          setDraftErrors(result.errors);
          setVisibleVariants([]);
          return null;
        }

        setDraft(structuredClone(result.prayer));
        setDraftErrors([]);
        setVisibleVariants(
          resolveVisibleVariants(
            result.prayer,
            lib.root,
            entry.path,
            lib.manifest?.defaultVariant,
          ),
        );
        return opts ?? null;
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const openFolder = async (): Promise<boolean> => {
    if (isBrowserDev()) {
      showDesktopRequired();
      return false;
    }
    const root = await api.openLibraryFolder();
    if (!root) return false;
    return activateLibraryRoot(root);
  };

  const openRecentLibrary = async (path: string): Promise<boolean> => {
    if (isBrowserDev()) {
      showDesktopRequired();
      return false;
    }
    try {
      const root = await api.openLibraryPath(path);
      return await activateLibraryRoot(root);
    } catch (err) {
      forgetRecent(path);
      notifications.show({
        color: "accent",
        title: "Could not open library",
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  };

  const createLibrary = async (input: {
    name: string;
    manifest: LibraryManifest;
  }): Promise<boolean> => {
    if (isBrowserDev()) {
      showDesktopRequired();
      return false;
    }
    try {
      const root = await api.createLibraryFolder({
        name: input.name,
        manifestJson: `${JSON.stringify(input.manifest, null, 2)}\n`,
      });
      if (!root) return false;
      notifications.show({
        color: "dark",
        title: "Library created",
        message: "manifest.json written",
      });
      return await activateLibraryRoot(root);
    } catch (err) {
      notifications.show({
        color: "accent",
        title: "Could not create library",
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  };

  const requestReloadLibrary = () => {
    if (!library) return;
    if (hasUnsaved) {
      snapshotCurrentIfDirty();
      setPendingLeave({ type: "reload-library" });
      return;
    }
    void refreshLibrary(library.root, selectedPath);
  };

  const saveLibraryManifest = async (manifest: LibraryManifest) => {
    if (!library) return;
    setBusy(true);
    try {
      await api.writeText(
        library.root,
        "manifest.json",
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      setLibrary({ ...library, manifest });
      notifications.show({
        color: "dark",
        title: "Library updated",
        message: "manifest.json saved",
      });
    } catch (err) {
      notifications.show({
        color: "accent",
        title: "Could not save library settings",
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const openEntry = async (
    entry: LibraryEntry,
    opts?: { openSettings?: boolean; openStyles?: boolean },
  ): Promise<{ openSettings?: boolean; openStyles?: boolean } | null> => {
    if (!library) return null;

    if (selectedPath === entry.path && draft) {
      return opts ?? null;
    }

    cancelDraftValidation();
    snapshotCurrentIfDirty();
    persistCurrentView();

    const cached = unsavedRef.current[entry.path];
    if (cached) {
      applySession(entry.path, cached);
      return opts ?? null;
    }

    return loadPrayerFromDisk(entry, opts);
  };

  const updateDraft = (next: Prayer) => {
    if (!selectedPath) return;
    if (draft && JSON.stringify(next) === JSON.stringify(draft)) return;
    const path = selectedPath;
    const session = applyDraftEdit(next, visibleVariants, draftErrors);
    setDraft(session.prayer);
    setVisibleVariants(session.visibleVariants);
    setUnsaved((prev) => ({
      ...prev,
      [path]: session,
    }));
    scheduleDraftValidation(path);
  };

  const setActiveVariant = (v: ActiveVariant) => {
    setVisibleVariants((cols) => {
      const without = cols.filter((c) => !sameVariant(c, v));
      return [v, ...without];
    });
  };

  const saveDraft = async () => {
    if (!library || !draft || !selectedPath) return;

    cancelDraftValidation();
    const errors = validationErrorsFor(draft);
    setDraftErrors(errors);

    setBusy(true);
    try {
      const result = await persistPrayer(api, library.root, selectedPath, draft);
      if (!result.ok) {
        if (errors.length > 0) setDraftErrors(errors);
        notifications.show({
          color: "accent",
          title: "Cannot save",
          message: result.message,
        });
        return;
      }

      setUnsaved((prev) => {
        const next = { ...prev };
        delete next[selectedPath];
        if (result.path !== selectedPath) delete next[result.path];
        return next;
      });
      if (result.path !== selectedPath) {
        movePrayerView(library.root, selectedPath, result.path);
      }
      savePrayerView(library.root, result.path, visibleVariantsRef.current);
      setSelectedPath(result.path);
      notifications.show({
        color: "dark",
        title: "Saved",
        message: prayerFilename(draft.id),
      });
      await refreshLibrary(library.root, result.path);
    } finally {
      setBusy(false);
    }
  };

  const saveAllUnsaved = async (): Promise<boolean> => {
    if (!library) return false;
    cancelDraftValidation();
    snapshotCurrentIfDirty();

    const entries = Object.entries(unsavedRef.current);
    if (entries.length === 0) return true;

    setBusy(true);
    try {
      const nextUnsaved: Record<string, SessionDraft> = {
        ...unsavedRef.current,
      };
      let keepPath = selectedPathRef.current;

      for (const [path, session] of entries) {
        const result = await persistPrayer(
          api,
          library.root,
          path,
          session.prayer,
        );
        if (!result.ok) {
          setUnsaved(nextUnsaved);
          if (path === selectedPathRef.current) {
            setDraft(session.prayer);
            setDraftErrors(session.errors);
            setVisibleVariants(session.visibleVariants);
          }
          notifications.show({
            color: "accent",
            title: "Cannot save all",
            message: result.message,
          });
          return false;
        }
        delete nextUnsaved[path];
        if (result.path !== path) {
          movePrayerView(library.root, path, result.path);
        }
        savePrayerView(library.root, result.path, session.visibleVariants);
        if (keepPath === path) {
          keepPath = result.path;
          setDraft(session.prayer);
          setDraftErrors([]);
          setVisibleVariants(session.visibleVariants);
        }
      }

      setUnsaved({});
      if (keepPath) setSelectedPath(keepPath);
      notifications.show({
        color: "dark",
        title: "Saved",
        message:
          entries.length === 1
            ? "1 prayer saved"
            : `${entries.length} prayers saved`,
      });
      await refreshLibrary(library.root, keepPath);
      return true;
    } finally {
      setBusy(false);
    }
  };

  const discardAllUnsaved = async () => {
    const wasSelected = selectedPathRef.current;
    setUnsaved({});
    if (!library || !wasSelected) return;

    const entry = library.entries.find((e) => e.path === wasSelected);
    if (!entry) {
      clearEditor();
      return;
    }
    await loadPrayerFromDisk(entry);
  };

  const beginCreatePrayer = async () => {
    if (!library) return;
    if (createDraft) return;

    let n = 1;
    let id = `new-prayer-${n}`;
    while (await api.exists(library.root, prayerFilename(id))) {
      n += 1;
      id = `new-prayer-${n}`;
    }

    const prayer = emptyPrayer(id);
    setCreateDraft(prayer);
    setCreateVariant({ lang: "de", variant: "standard" });
  };

  const cancelCreatePrayer = () => {
    setCreateDraft(null);
    setCreateVariant(null);
    setCreateBusy(false);
  };

  const commitCreatePrayer = async () => {
    if (!library || !createDraft || !createVariant) return;

    const result = validate(createDraft);
    if (!result.ok) {
      notifications.show({
        color: "accent",
        title: "Cannot create",
        message: result.errors.map((e) => e.message).join(" · "),
      });
      return;
    }

    const path = prayerFilename(createDraft.id);
    const exists = await api.exists(library.root, path);
    if (exists) {
      notifications.show({
        color: "accent",
        title: "Id collision",
        message: `File ${path} already exists. Choose another id.`,
      });
      return;
    }

    snapshotCurrentIfDirty();

    setCreateBusy(true);
    try {
      await api.writeText(
        library.root,
        path,
        `${JSON.stringify(createDraft, null, 2)}\n`,
      );
      const prayer = structuredClone(createDraft);
      const variant = createVariant;
      setCreateDraft(null);
      setCreateVariant(null);
      await refreshLibrary(library.root, path);
      setSelectedPath(path);
      setDraft(prayer);
      setDraftErrors([]);
      setVisibleVariants([variant]);
      savePrayerView(library.root, path, [variant]);
      notifications.show({
        color: "dark",
        title: "Created",
        message: path,
      });
    } catch (err) {
      notifications.show({
        color: "accent",
        title: "Create failed",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCreateBusy(false);
    }
  };

  const deleteEntry = async (entry: LibraryEntry) => {
    if (!library) return;
    setDeleteBusy(true);
    try {
      await api.deleteFile(library.root, entry.path);
      removePrayerView(library.root, entry.path);
      setUnsaved((prev) => {
        if (!(entry.path in prev)) return prev;
        const next = { ...prev };
        delete next[entry.path];
        return next;
      });
      if (selectedPath === entry.path) {
        clearEditor();
      }
      setPendingDelete(null);
      await refreshLibrary(library.root, null);
      notifications.show({
        color: "dark",
        title: "Deleted",
        message: entry.path,
      });
    } catch (err) {
      notifications.show({
        color: "accent",
        title: "Delete failed",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleteBusy(false);
    }
  };

  const exportEntry = async (
    entry: LibraryEntry,
    variant: ActiveVariant,
    format: ExportFormat = "flat-json",
    options: {
      includeBlocksWithoutTranslation?: boolean;
      html?: HtmlExportRequest;
      layout?: LayoutExportRequest;
    } = {},
  ): Promise<string | null | false> => {
    if (!library) return false;

    let prayer = draft;

    if (selectedPath === entry.path && prayer) {
      // use editor state
    } else if (unsaved[entry.path]) {
      prayer = unsaved[entry.path]!.prayer;
    } else if (selectedPath !== entry.path || !prayer) {
      const raw = await api.readText(library.root, entry.path);
      const result = validate(JSON.parse(raw) as unknown);
      if (!result.ok) {
        notifications.show({
          color: "accent",
          title: "Cannot export",
          message: "Prayer is invalid.",
        });
        return false;
      }
      prayer = result.prayer;
    }

    if (!prayer) return false;

    try {
      const path = await exportPrayerVariant(
        api,
        prayer,
        variant,
        format,
        options,
      );
      if (path) {
        notifications.show({
          color: "dark",
          title: "Exported",
          message: path,
        });
      }
      return path;
    } catch (err) {
      notifications.show({
        color: "accent",
        title: "Export failed",
        message: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  };

  const persistAppStyles = async (next: StyleMap) => {
    const checked = validateStyles(next);
    if (!checked.ok) {
      notifications.show({
        color: "accent",
        title: "Cannot save app styles",
        message: checked.errors.map((e) => e.message).join(" · "),
      });
      return;
    }
    setAppStyles(checked.styles);
    await api.writeAppStyles(`${JSON.stringify(checked.styles, null, 2)}\n`);
  };

  const persistLibraryStyles = async (next: StyleMap) => {
    if (!library) return;
    const checked = validateStyles(next);
    if (!checked.ok) {
      notifications.show({
        color: "accent",
        title: "Cannot save library styles",
        message: checked.errors.map((e) => e.message).join(" · "),
      });
      return;
    }
    setLibrary({ ...library, libraryStyles: checked.styles, styleErrors: [] });
    await api.writeLibraryStyles(
      library.root,
      `${JSON.stringify(checked.styles, null, 2)}\n`,
    );
  };

  const applyKindRenamePlan = async (plan: KindRenamePlan) => {
    if (!library) return;
    setKindRenameBusy(true);
    try {
      cancelDraftValidation();
      snapshotCurrentIfDirty();
      const result = await renameKindAcrossLibrary(api, library.root, plan, {
        unsaved: unsavedRef.current,
        selectedPath: selectedPathRef.current,
        draft: draftRef.current,
        appStyles,
        libraryStyles: library.libraryStyles,
      });

      setUnsaved(result.unsaved);
      if (result.draft) {
        setDraft(result.draft);
        setDraftErrors(validationErrorsFor(result.draft));
      }
      setAppStyles(result.appStyles);
      setLibrary({
        ...library,
        libraryStyles: result.libraryStyles,
        styleErrors: [],
      });

      await api.writeAppStyles(
        `${JSON.stringify(result.appStyles, null, 2)}\n`,
      );
      await api.writeLibraryStyles(
        library.root,
        `${JSON.stringify(result.libraryStyles, null, 2)}\n`,
      );

      await refreshLibrary(library.root, selectedPathRef.current);

      const skippedNote =
        result.skipped.length > 0
          ? ` · ${result.skipped.length} skipped`
          : "";
      notifications.show({
        color: "dark",
        title: "Kind renamed",
        message: `“${plan.from}” → “${plan.to}” in ${result.writtenPaths.length} prayer${result.writtenPaths.length === 1 ? "" : "s"}${skippedNote}`,
      });
    } catch (err) {
      notifications.show({
        color: "accent",
        title: "Kind rename failed",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setKindRenameBusy(false);
      setPendingKindRename(null);
    }
  };

  const requestKindRename = async (from: string, to: string) => {
    if (
      !library ||
      from === to ||
      !isValidKindId(to.trim()) ||
      isKindPreset(from)
    ) {
      return;
    }
    const plan = await planKindRename(api, library.root, from, to.trim(), {
      unsaved: unsavedRef.current,
      selectedPath: selectedPathRef.current,
      draft: draftRef.current,
    });

    if (plan.affectedPaths.length <= 1) {
      await applyKindRenamePlan(plan);
      return;
    }

    setPendingKindRename(plan);
  };

  const confirmKindRename = async () => {
    if (!pendingKindRename) return;
    await applyKindRenamePlan(pendingKindRename);
  };

  const cancelKindRename = () => {
    setPendingKindRename(null);
  };

  const finishLeave = async (action: LeaveAction) => {
    switch (action.type) {
      case "close-window":
        api.confirmClose();
        break;
      case "reload-library":
        if (library) await refreshLibrary(library.root, selectedPathRef.current);
        break;
      case "open-folder":
        clearSession();
        await refreshLibrary(action.root, null);
        break;
    }
  };

  const handleLeaveSaveAll = async (): Promise<LeaveAction | null> => {
    if (!pendingLeave) return null;
    setLeaveBusy(true);
    try {
      const ok = await saveAllUnsaved();
      if (!ok) return null;
      const action = pendingLeave;
      setPendingLeave(null);
      await finishLeave(action);
      return action;
    } finally {
      setLeaveBusy(false);
    }
  };

  const handleLeaveDiscard = async (): Promise<LeaveAction | null> => {
    if (!pendingLeave) return null;
    setLeaveBusy(true);
    try {
      const action = pendingLeave;
      if (action.type === "close-window" || action.type === "open-folder") {
        setUnsaved({});
      } else {
        await discardAllUnsaved();
      }
      setPendingLeave(null);
      await finishLeave(action);
      return action;
    } finally {
      setLeaveBusy(false);
    }
  };

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.keys(unsavedRef.current).length === 0) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (isBrowserDev()) return;
    api.setDirty(hasUnsaved);
  }, [api, hasUnsaved]);

  useEffect(() => {
    if (isBrowserDev()) return;
    return api.onCloseRequested(() => {
      snapshotCurrentIfDirty();
      setPendingLeave({ type: "close-window" });
    });
  }, [api, snapshotCurrentIfDirty]);

  useEffect(() => {
    if (!selectedPath) return;
    setUnsaved((prev) => {
      const current = prev[selectedPath];
      if (!current) return prev;
      if (current.visibleVariants === visibleVariants) return prev;
      return {
        ...prev,
        [selectedPath]: { ...current, visibleVariants },
      };
    });
  }, [visibleVariants, selectedPath]);

  useEffect(() => {
    if (!library || !selectedPath || visibleVariants.length === 0) return;
    savePrayerView(library.root, selectedPath, visibleVariants);
  }, [library, selectedPath, visibleVariants]);

  const folderBasename = library
    ? (library.root.split(/[/\\]/).filter(Boolean).pop() ?? null)
    : null;
  const folderLabel = folderBasename;

  const sidebarEntries = useMemo(() => {
    if (!library) return [];
    const preferred = library.manifest?.defaultVariant ?? null;
    return library.entries.map((entry) => {
      const session = unsaved[entry.path];
      if (!session) return entry;
      return {
        ...entry,
        id: session.prayer.id,
        title: resolveDisplayTitle(session.prayer, preferred),
        description: session.prayer.description ?? null,
        valid: session.errors.length === 0,
        errors: session.errors,
      };
    });
  }, [library, unsaved]);

  return {
    library,
    selectedPath,
    draft,
    draftErrors,
    unsaved,
    visibleVariants,
    setVisibleVariants,
    activeVariant,
    appStyles,
    busy,
    dirty,
    unsavedCount,
    hasUnsaved,
    resolvedStyles,
    folderBasename,
    folderLabel,
    sidebarEntries,
    recentLibraries,
    removeRecentLibrary: forgetRecent,
    createDraft,
    createVariant,
    createBusy,
    pendingDelete,
    setPendingDelete,
    deleteBusy,
    pendingLeave,
    setPendingLeave,
    leaveBusy,
    openFolder,
    openRecentLibrary,
    createLibrary,
    requestReloadLibrary,
    saveLibraryManifest,
    openEntry,
    updateDraft,
    setActiveVariant,
    setCreateDraft,
    setCreateVariant,
    saveDraft,
    beginCreatePrayer,
    cancelCreatePrayer,
    commitCreatePrayer,
    deleteEntry,
    exportEntry,
    persistAppStyles,
    persistLibraryStyles,
    handleLeaveSaveAll,
    handleLeaveDiscard,
    clearEditor,
    pendingKindRename,
    kindRenameBusy,
    requestKindRename,
    confirmKindRename,
    cancelKindRename,
  };
}
