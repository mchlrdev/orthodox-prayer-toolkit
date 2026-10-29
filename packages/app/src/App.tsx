import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ActionIcon, useMantineColorScheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import {
  applyImportOps,
  draftBlocksInColumn,
  draftBlockVisible,
  freeSourceId,
  importDraftToPrayer,
  indexVariants,
  type ImportOp,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import { getToolkitApi, isBrowserDev } from "./api";
import { PrayerList } from "./components/PrayerList";
import { PrayerWorkspace } from "./components/PrayerWorkspace";
import { ContentOutline } from "./components/ContentOutline";
import {
  PrayerSettingsModal,
  type PrayerSettingsPane,
} from "./components/PrayerSettingsModal";
import { NewPrayerModal } from "./components/NewPrayerModal";
import {
  LibrarySettingsModal,
  type LibrarySettingsPane,
} from "./components/LibrarySettingsModal";
import { LibraryMigrationDialog } from "./components/LibraryMigrationDialog";
import { AppSettingsModal } from "./components/AppSettingsModal";
import { ExportModal } from "./components/ExportModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { WhatsNewDialog } from "./components/WhatsNewDialog";
import { InvalidPrayerScreen } from "./components/InvalidPrayerScreen";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { LibraryWelcome } from "./components/LibraryWelcome";
import { NewLibraryModal } from "./components/NewLibraryModal";
import { ImportWorkspace } from "./components/ImportWorkspace";
import { ImportTextModal, type AddLanguageTarget } from "./components/ImportTextModal";
import { draftColumns } from "./importDraft/sourceView";
import {
  ImportSaveModal,
  type ImportSaveInput,
} from "./components/ImportSaveModal";
import { useImportDraft } from "./importDraft/useImportDraft";
import { useFirstDraft } from "./builtInModel/useFirstDraft";
import { readImportInput } from "./importDraft/readInput";
import type { ToolHost } from "./agentTools/toolDirectory";
import { useAgentAccess } from "./agentTools/useAgentAccess";
import type { InlineEditorHandle } from "./components/InlineEditor";
import type { LibraryEntry } from "./library";
import { usePrayerSession } from "./usePrayerSession";
import {
  kindRenameConfirmMessage,
  type LibraryMigrationReport,
  type SessionNotice,
} from "./session";
import { loadSidebarPrefs, saveSidebarPrefs } from "./sidebarPrefs";
import {
  loadAppearancePrefs,
  saveAppearancePrefs,
  type ColorSchemePreference,
} from "./appearancePrefs";
import {
  RELEASE_NOTES,
  newestNotesVersion,
  notesForRunning,
  shouldShowWhatsNew,
} from "./releaseNotes";
import {
  loadLastSeenWhatsNew,
  saveLastSeenWhatsNew,
} from "./whatsNewPrefs";
import { toMantineColorScheme } from "./mantineColorScheme";
import {
  commandForKey,
  flushPendingEdits,
  isAppCommand,
  isMacPlatform,
  modalOpen,
  wantsNativeUndo,
  type AppCommand,
} from "./appCommands";

const OVERLAY_BREAKPOINT = "(max-width: 1099px)";

export function App() {
  const onNotice = useCallback((n: SessionNotice) => {
    notifications.show({
      color: n.color,
      title: n.title,
      message: n.message,
      autoClose: n.autoClose,
    });
  }, []);
  const session = usePrayerSession({ onNotice });
  const importDraft = useImportDraft();
  const firstDraft = useFirstDraft(importDraft);
  const importing = importDraft.draft !== null;
  const [importTextOpen, setImportTextOpen] = useState(false);
  const [importSaveOpen, setImportSaveOpen] = useState(false);
  const [addLanguageOpen, setAddLanguageOpen] = useState(false);
  /** What waits for "discard the open Import draft?": a prayer or a new import. */
  const [leaveImportFor, setLeaveImportFor] = useState<
    LibraryEntry | "new-import" | null
  >(null);
  const { setColorScheme } = useMantineColorScheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPane, setSettingsPane] =
    useState<PrayerSettingsPane>("prayer");
  const [librarySettingsOpen, setLibrarySettingsOpen] = useState(false);
  const [librarySettingsPane, setLibrarySettingsPane] =
    useState<LibrarySettingsPane>("library");
  /** Migration dialog opened by hand (Library settings) after "Not now". */
  const [migrationManual, setMigrationManual] = useState(false);
  const [migrationReport, setMigrationReport] = useState<{
    report: LibraryMigrationReport;
    legacyTokensBefore: boolean;
  } | null>(null);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [newLibraryOpen, setNewLibraryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [runningVersion, setRunningVersion] = useState("");

  const initialPrefs = useMemo(() => loadSidebarPrefs(), []);
  const initialAppearance = useMemo(() => loadAppearancePrefs(), []);
  const [libraryCollapsed, setLibraryCollapsed] = useState(
    initialPrefs.libraryCollapsed,
  );
  const [contentCollapsed, setContentCollapsed] = useState(
    initialPrefs.contentCollapsed,
  );
  const [colorSchemePref, setColorSchemePref] = useState<ColorSchemePreference>(
    initialAppearance.colorScheme,
  );
  const [editorFontSize, setEditorFontSize] = useState(
    initialAppearance.editorFontSize,
  );

  const overlayMode = useMediaQuery(OVERLAY_BREAKPOINT) ?? false;
  const editorRef = useRef<InlineEditorHandle>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const prevOverlayModeRef = useRef<boolean | null>(null);

  useEffect(() => {
    saveSidebarPrefs({ libraryCollapsed, contentCollapsed });
  }, [libraryCollapsed, contentCollapsed]);

  useEffect(() => {
    saveAppearancePrefs({
      colorScheme: colorSchemePref,
      editorFontSize,
    });
    setColorScheme(toMantineColorScheme(colorSchemePref));
  }, [colorSchemePref, editorFontSize, setColorScheme]);


  const handleSelectEntry = useCallback(
    (entry: LibraryEntry) => {
      flushPendingEdits();
      if (importing) {
        setLeaveImportFor(entry);
        return;
      }
      void session.openEntry(entry);
      if (overlayMode) setLibraryCollapsed(true);
    },
    [overlayMode, session, importing],
  );

  const commandRef = useRef<(command: AppCommand, fromKey: boolean) => boolean>(
    () => false,
  );
  /** Returns false when the command should fall through to the browser. */
  commandRef.current = (command, fromKey) => {
    const dialogOpen = modalOpen();
    switch (command) {
      case "save":
        flushPendingEdits();
        if (importing) {
          if (!dialogOpen) setImportSaveOpen(true);
          return true;
        }
        void session.saveDraft();
        return true;
      case "save-all":
        flushPendingEdits();
        void session.saveAll();
        return true;
      case "open-library":
        if (dialogOpen) return true;
        handleOpenFolder();
        return true;
      case "new-prayer":
        if (dialogOpen || !session.library) return true;
        void session.beginCreatePrayer();
        return true;
      case "settings":
        if (dialogOpen) return true;
        setAppSettingsOpen(true);
        return true;
      case "assign-speaker":
        if (dialogOpen) return true;
        editorRef.current?.openSpeakerMenu();
        return true;
      case "undo":
      case "redo": {
        const active = document.activeElement;
        if (wantsNativeUndo(active)) {
          // Keys: the browser undoes itself. Menu clicks (macOS) need a nudge.
          if (!fromKey) document.execCommand(command);
          return false;
        }
        if (dialogOpen) return false;
        // Leave the cell so it re-renders from the restored prayer.
        if (active instanceof HTMLElement && active.isContentEditable) {
          active.blur();
        }
        if (importing) {
          if (command === "undo") importDraft.undo();
          else importDraft.redo();
          return true;
        }
        if (command === "undo") session.undo();
        else session.redo();
        return true;
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    const decide = (version: string) => {
      if (cancelled) return;
      setRunningVersion(version);
      setWhatsNewOpen(
        shouldShowWhatsNew({
          lastSeen: loadLastSeenWhatsNew(),
          runningVersion: version,
          notes: RELEASE_NOTES,
        }),
      );
    };
    void getToolkitApi()
      .getAppInfo()
      .then((info) => decide(info.version))
      // Failed IPC: newest seeded row, not a removed `.version` field.
      .catch(() => decide(newestNotesVersion(RELEASE_NOTES)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const mac = isMacPlatform();
    let lastKey: { command: AppCommand; at: number } | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const command = commandForKey(event, mac);
      if (!command) return;
      if (commandRef.current(command, true)) {
        event.preventDefault();
        lastKey = { command, at: Date.now() };
      }
    };
    window.addEventListener("keydown", onKeyDown);
    // macOS menu items carry the same accelerators; skip their echo.
    const unsubscribe = getToolkitApi().onCommand((command) => {
      if (!isAppCommand(command)) return;
      if (lastKey?.command === command && Date.now() - lastKey.at < 400) {
        return;
      }
      commandRef.current(command, false);
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unsubscribe();
    };
  }, []);

  const handleOutlineJump = useCallback(
    (blockId: string) => {
      editorRef.current?.revealBlock(blockId, {
        scroll: "instant-start",
        focusCol: null,
        flash: true,
      });
      if (overlayMode) setContentCollapsed(true);
    },
    [overlayMode],
  );

  const {
    library,
    selectedPath,
    draft,
    draftErrors,
    draftWarnings,
    visibleVariants,
    setVisibleVariants,
    activeVariant,
    busy,
    dirty,
    unsavedCount,
    resolvedStyles,
    folderLabel,
    sidebarEntries,
    unsaved,
    recentLibraries,
    createDraft,
    createVariant,
    createBusy,
    pendingDelete,
    setPendingDelete,
    deleteBusy,
    pendingLeave,
    setPendingLeave,
    leaveBusy,
  } = session;

  const overlayLibraryPinned =
    overlayMode &&
    Boolean(library) &&
    !(selectedPath && !draft) &&
    !(draft && visibleVariants.length > 0);

  useEffect(() => {
    const prev = prevOverlayModeRef.current;
    prevOverlayModeRef.current = overlayMode;
    if (!overlayMode) return;

    if (overlayLibraryPinned) {
      setLibraryCollapsed(false);
      setContentCollapsed(true);
      return;
    }

    if (prev === null || !prev) {
      setLibraryCollapsed(true);
      setContentCollapsed(true);
    }
  }, [overlayMode, overlayLibraryPinned]);

  const toggleLibrary = useCallback(() => {
    setLibraryCollapsed((c) => {
      if (overlayLibraryPinned) return false;
      const next = !c;
      if (overlayMode && !next) setContentCollapsed(true);
      return next;
    });
  }, [overlayMode, overlayLibraryPinned]);

  const toggleContent = useCallback(() => {
    setContentCollapsed((c) => {
      const next = !c;
      if (overlayMode && !next) setLibraryCollapsed(true);
      return next;
    });
  }, [overlayMode]);

  const closeOverlays = useCallback(() => {
    if (!overlayMode || overlayLibraryPinned) return;
    setLibraryCollapsed(true);
    setContentCollapsed(true);
  }, [overlayMode, overlayLibraryPinned]);

  useEffect(() => {
    setSettingsPane("prayer");
  }, [selectedPath]);

  const handleOpenFolder = useCallback(() => {
    void session.openFolder().then((cleared) => {
      if (cleared) setLibrarySettingsOpen(false);
    });
  }, [session]);

  const handleOpenRecent = useCallback(
    (path: string) => {
      void session.openRecentLibrary(path).then((cleared) => {
        if (cleared) setLibrarySettingsOpen(false);
      });
    },
    [session],
  );

  const availableVariants = useMemo(() => {
    if (!library) return [];
    const openPrayers = [
      ...Object.values(unsaved).map((s) => s.prayer),
      ...(draft ? [draft] : []),
      ...(createDraft ? [createDraft] : []),
    ];
    const byKey = new Map(
      library.variants.map((v) => [`${v.lang}::${v.variant}`, v] as const),
    );
    for (const v of indexVariants(openPrayers)) {
      byKey.set(`${v.lang}::${v.variant}`, v);
    }
    return [...byKey.values()].sort(
      (a, b) =>
        a.lang.localeCompare(b.lang) || a.variant.localeCompare(b.variant),
    );
  }, [library, unsaved, draft, createDraft]);

  const showBackdrop =
    overlayMode &&
    !overlayLibraryPinned &&
    (!libraryCollapsed || !contentCollapsed);

  const workspaceView = useMemo(() => {
    if (importing) {
      return { key: "import", kind: "import" as const };
    }
    if (selectedPath && !draft) {
      return { key: `invalid:${selectedPath}`, kind: "invalid" as const };
    }
    if (draft && visibleVariants.length > 0) {
      return { key: `prayer:${selectedPath}`, kind: "prayer" as const };
    }
    if (library) {
      return { key: "pick", kind: "pick" as const };
    }
    return { key: "welcome", kind: "welcome" as const };
  }, [importing, selectedPath, draft, visibleVariants.length, library]);

  const takenIds = useMemo(
    () =>
      new Set(
        sidebarEntries.flatMap((e) => (e.id ? [e.id] : [])),
      ),
    [sidebarEntries],
  );

  const addLanguageTarget = useMemo<AddLanguageTarget | null>(() => {
    const d = importDraft.draft;
    if (!d) return null;
    const first = d.variants[0]!;
    return {
      title: first.title,
      firstLang: first.lang,
      blockCount: d.blocks.filter((b) => draftBlockVisible(d, b) && b.content[first.key]).length,
      firstColumnCount: draftBlocksInColumn(d, 0, first.key).length,
      columns: draftColumns(d),
      taken: d.variants.map((v) => ({ lang: v.lang, variant: v.variant })),
      sourceId: freeSourceId(d),
    };
  }, [importDraft.draft]);

  /** A Tool call waiting for the user's yes (save, replace the draft). */
  const [agentConfirm, setAgentConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const agentHost: ToolHost = {
    appVersion: runningVersion,
    library: () =>
      session.library
        ? {
            entries: session.library.entries.map(({ id, title, path, valid, kinds }) => ({
              id,
              title,
              path,
              valid,
              kinds,
            })),
            variants: session.library.variants.map(({ lang, variant }) => ({ lang, variant })),
          }
        : null,
    readPrayer: async (id) => {
      const library = session.library;
      const entry = library?.entries.find((e) => e.id === id);
      if (!library || !entry) return null;
      if (entry.path === session.selectedPath && session.draft) return session.draft;
      return JSON.parse(await getToolkitApi().readText(library.root, entry.path)) as Prayer;
    },
    readSource: async (input, id) =>
      readImportInput(
        { text: input.url ?? input.text ?? "", html: input.html ?? null, fileName: input.name ?? null },
        (address) => getToolkitApi().fetchSource(address),
        { id },
      ),
    importDraft: () => importDraft.currentDraft(),
    startImport: ({ source, origin, variant }) => {
      flushPendingEdits();
      importDraft.start({ source, origin, variant });
      if (overlayMode) setLibraryCollapsed(true);
    },
    applyImportOps: (ops) => importDraft.apply(ops, { origin: { by: "agent" } }),
    confirm: (request) =>
      new Promise((resolve) => {
        setAgentConfirm((prev) => {
          prev?.resolve(false);
          return { ...request, resolve };
        });
      }),
    createPrayer: (prayer, variant) => session.createPrayer(prayer, variant),
    closeImport: () => importDraft.discard(),
    runFirstDraft: () => firstDraft.start(),
  };
  const agentAccess = useAgentAccess(agentHost);

  const saveImport = async ({ meta, variants }: ImportSaveInput) => {
    const current = importDraft.draft;
    if (!current) return;
    const ops: ImportOp[] = [
      { op: "setPrayerMeta", patch: meta },
      ...Object.entries(variants).map(([key, patch]) => ({
        op: "setVariantMeta" as const,
        variant: key,
        patch,
      })),
    ];
    const result = applyImportOps(current, ops);
    if (!result.ok) {
      onNotice({ color: "accent", title: "Cannot save", message: result.error });
      return;
    }
    // Keep what was typed in the dialog even when saving is refused.
    importDraft.apply(ops);
    const { lang, variant: edition } = result.draft.variants[0]!;
    const saved = await session.createPrayer(importDraftToPrayer(result.draft), {
      lang,
      variant: edition,
    });
    if (!saved) return;
    setImportSaveOpen(false);
    importDraft.discard();
  };

  return (
    <>
      <div
        className="app-shell"
        data-overlay={overlayMode ? "true" : undefined}
        data-library-collapsed={libraryCollapsed ? "true" : undefined}
        data-content-collapsed={contentCollapsed ? "true" : undefined}
        style={
          {
            "--opt-editor-font-size": `${editorFontSize}px`,
          } as CSSProperties
        }
      >
        <ActionIcon
          className="sidebar-edge-btn sidebar-edge-btn-library"
          variant="default"
          size="sm"
          radius="xl"
          aria-label={
            libraryCollapsed
              ? "Expand library sidebar"
              : "Collapse library sidebar"
          }
          title={
            libraryCollapsed
              ? "Expand library sidebar"
              : "Collapse library sidebar"
          }
          onClick={toggleLibrary}
        >
          {libraryCollapsed ? (
            <IconChevronRight size={14} stroke={2} />
          ) : (
            <IconChevronLeft size={14} stroke={2} />
          )}
        </ActionIcon>

        <aside
          className="sidebar sidebar-library"
          data-collapsed={libraryCollapsed ? "true" : undefined}
        >
          <div className="sidebar-inner" aria-hidden={libraryCollapsed}>
            <PrayerList
              folderLabel={folderLabel}
              libraryOpen={Boolean(library)}
              libraryRoot={library?.root ?? null}
              entries={sidebarEntries}
              collisions={library?.collisions ?? []}
              selectedPath={selectedPath}
              unsavedPaths={Object.keys(unsaved)}
              busy={busy}
              description={library?.manifest?.description}
              recent={recentLibraries}
              onSelect={handleSelectEntry}
              onOpenFolder={handleOpenFolder}
              onOpenRecent={handleOpenRecent}
              onRemoveRecent={session.removeRecentLibrary}
              onNewLibrary={() => setNewLibraryOpen(true)}
              onReload={session.requestReloadLibrary}
              onCreate={() => void session.beginCreatePrayer()}
              onLibrarySettings={() => setLibrarySettingsOpen(true)}
              onAppSettings={() => setAppSettingsOpen(true)}
              onImportPrayer={() => void session.importPrayerFile()}
              onImportText={() => {
                if (importing) setLeaveImportFor("new-import");
                else setImportTextOpen(true);
              }}
              onExportPrayer={(entry) => void session.exportPrayerFile(entry)}
              onDelete={(entry) => setPendingDelete(entry)}
            />
          </div>
        </aside>

        <main className="workspace-main">
          <div
            className="workspace-content"
            key={workspaceView.key}
            data-view={workspaceView.kind}
          >
            {importDraft.draft && importDraft.prayer ? (
              <ImportWorkspace
                draft={importDraft.draft}
                files={importDraft.files}
                prayer={importDraft.prayer}
                styles={resolvedStyles}
                styleEditing={{
                  resolved: resolvedStyles,
                  libraryKinds: session.libraryKinds,
                  libraryEnabled: Boolean(library),
                  onPatchStyle: (kind, partial) =>
                    void session.patchKindStyle(kind, partial),
                }}
                edits={importDraft.edits}
                canUndo={importDraft.canUndo}
                canRedo={importDraft.canRedo}
                takenIds={takenIds}
                editorRef={editorRef}
                scrollRootRef={scrollRootRef}
                onApply={(ops) => importDraft.apply(ops)}
                onUndo={() => importDraft.undo()}
                onRedo={() => importDraft.redo()}
                onDiscard={importDraft.discard}
                onAddLanguage={() => setAddLanguageOpen(true)}
                firstDraft={firstDraft}
                onSave={() => {
                  flushPendingEdits();
                  setImportSaveOpen(true);
                }}
              />
            ) : selectedPath && !draft ? (
              <InvalidPrayerScreen path={selectedPath} errors={draftErrors} />
            ) : draft && visibleVariants.length > 0 ? (
              <PrayerWorkspace
                prayer={draft}
                prayerPath={selectedPath ?? ""}
                libraryRoot={library?.root ?? ""}
                visibleVariants={visibleVariants}
                styles={resolvedStyles}
                styleEditing={{
                  resolved: resolvedStyles,
                  libraryKinds: session.libraryKinds,
                  libraryEnabled: Boolean(library),
                  onPatchStyle: (kind, partial) =>
                    void session.patchKindStyle(kind, partial),
                }}
                busy={busy}
                dirty={dirty}
                errors={draftErrors}
                warnings={draftWarnings}
                diskConflict={session.diskConflict}
                editorRef={editorRef}
                scrollRootRef={scrollRootRef}
                onChange={session.updateDraft}
                onKeepLocal={() => {
                  if (selectedPath) session.keepLocal(selectedPath);
                }}
                onReloadFromDisk={() => {
                  if (selectedPath) void session.reloadFromDisk(selectedPath);
                }}
                onVisibleVariantsChange={setVisibleVariants}
                onSave={() => {
                  flushPendingEdits();
                  void session.saveDraft();
                }}
                onSettings={(pane) => {
                  if (pane) setSettingsPane(pane);
                  setSettingsOpen(true);
                }}
                onExport={() => {
                  flushPendingEdits();
                  setExportOpen(true);
                }}
                onRenameKind={(from, to) => {
                  void session.requestKindRename(from, to);
                }}
                onDeleteKind={session.deleteKind}
                onSetKindSpeaker={session.setKindSpeaker}
              />
            ) : library ? (
              <div className="workspace-empty">
                Select a prayer from the library.
              </div>
            ) : (
              <LibraryWelcome
                recent={recentLibraries}
                busy={busy}
                desktopAvailable={!isBrowserDev()}
                onOpenRecent={handleOpenRecent}
                onRemoveRecent={session.removeRecentLibrary}
                onOpenFolder={handleOpenFolder}
                onNewLibrary={() => setNewLibraryOpen(true)}
              />
            )}
          </div>
        </main>

        <aside
          className="sidebar sidebar-content"
          data-collapsed={contentCollapsed ? "true" : undefined}
        >
          <div className="sidebar-inner" aria-hidden={contentCollapsed}>
            <ContentOutline
              prayer={importDraft.prayer ?? draft}
              primary={
                importDraft.draft
                  ? {
                      lang: importDraft.draft.variants[0]!.lang,
                      variant: importDraft.draft.variants[0]!.variant,
                    }
                  : (visibleVariants[0] ?? null)
              }
              scrollRootRef={scrollRootRef}
              onJump={handleOutlineJump}
            />
          </div>
        </aside>

        <ActionIcon
          className="sidebar-edge-btn sidebar-edge-btn-content"
          variant="default"
          size="sm"
          radius="xl"
          aria-label={
            contentCollapsed
              ? "Expand content sidebar"
              : "Collapse content sidebar"
          }
          title={
            contentCollapsed
              ? "Expand content sidebar"
              : "Collapse content sidebar"
          }
          onClick={toggleContent}
        >
          {contentCollapsed ? (
            <IconChevronLeft size={14} stroke={2} />
          ) : (
            <IconChevronRight size={14} stroke={2} />
          )}
        </ActionIcon>

        {overlayMode && !overlayLibraryPinned ? (
          <button
            type="button"
            className="sidebar-backdrop"
            data-visible={showBackdrop ? "true" : undefined}
            aria-hidden={!showBackdrop}
            tabIndex={showBackdrop ? 0 : -1}
            aria-label="Close sidebar"
            onClick={closeOverlays}
          />
        ) : null}
      </div>

      {createDraft && createVariant ? (
        <NewPrayerModal
          opened
          busy={createBusy}
          onClose={session.cancelCreatePrayer}
          onCreate={() => {
            void session.commitCreatePrayer().then(() => {
              setSettingsOpen(false);
            });
          }}
          prayer={createDraft}
          activeVariant={createVariant}
          onChange={session.setCreateDraft}
          onActiveVariantChange={session.setCreateVariant}
          templates={session.templates}
          templateId={session.createTemplateId}
          onTemplateChange={session.setCreateTemplate}
        />
      ) : draft && activeVariant ? (
        <PrayerSettingsModal
          opened={settingsOpen}
          pane={settingsPane}
          onPaneChange={setSettingsPane}
          onClose={() => setSettingsOpen(false)}
          prayer={draft}
          activeVariant={activeVariant}
          onChange={session.updateDraft}
          onActiveVariantChange={session.setActiveVariant}
          onRenameKind={(from, to) => {
            void session.requestKindRename(from, to);
          }}
          onAddKind={(def) =>
            session.addKind(def.id, { speaker: def.speaker === true })
          }
          onRemoveKind={session.deleteKind}
          onSetKindSpeaker={session.setKindSpeaker}
          onApplyTemplate={session.applyTemplate}
          templates={session.templates}
          styles={{
            libraryKinds: session.libraryKinds,
            resolved: resolvedStyles,
            libraryEnabled: Boolean(library),
            onPatchStyle: (kind, partial) =>
              void session.patchKindStyle(kind, partial),
          }}
        />
      ) : null}

      {library ? (
        <LibrarySettingsModal
          opened={librarySettingsOpen}
          onClose={() => setLibrarySettingsOpen(false)}
          pane={librarySettingsPane}
          onPaneChange={setLibrarySettingsPane}
          manifest={library.manifest}
          availableVariants={availableVariants}
          busy={busy}
          onSave={session.saveLibraryManifest}
          migrationNeeded={
            session.migrationStatus.prayers > 0 ||
            session.migrationStatus.legacyTokens
          }
          migrationBlocked={session.migrationStatus.blocked}
          onMigrate={() => setMigrationManual(true)}
          templates={{
            templates: session.templates,
            templateErrors: session.templateErrors,
            onCreate: session.createTemplate,
            onUpdate: (id, edit) => void session.updateTemplate(id, edit),
            onDelete: (id) => void session.deleteTemplate(id),
          }}
          styles={{
            libraryKinds: session.libraryKinds,
            resolved: resolvedStyles,
            unusedStyleKeys: session.unusedStyleKeys,
            onPatchStyle: (kind, partial) =>
              void session.patchKindStyle(kind, partial),
            onRemoveStyle: (kind) => void session.removeLibraryStyle(kind),
          }}
        />
      ) : null}

      {library ? (
        <LibraryMigrationDialog
          opened={
            migrationReport !== null ||
            (migrationManual && session.migrationStatus.blocked === null) ||
            session.migrationStatus.pending
          }
          status={session.migrationStatus}
          report={migrationReport?.report ?? null}
          legacyTokensBefore={migrationReport?.legacyTokensBefore ?? false}
          busy={busy}
          onMigrate={() => {
            const legacyTokensBefore = session.migrationStatus.legacyTokens;
            void session.migrateLibrary().then((report) => {
              setMigrationManual(false);
              // Leftovers (failed / unsaved) are not asked again this session;
              // Library settings offers "Migrate…".
              session.dismissMigration();
              if (report) setMigrationReport({ report, legacyTokensBefore });
            });
          }}
          onClose={() => {
            if (!migrationReport) session.dismissMigration();
            setMigrationManual(false);
            setMigrationReport(null);
          }}
        />
      ) : null}

      <AppSettingsModal
        opened={appSettingsOpen}
        onClose={() => setAppSettingsOpen(false)}
        colorScheme={colorSchemePref}
        onColorSchemeChange={setColorSchemePref}
        editorFontSize={editorFontSize}
        onEditorFontSizeChange={setEditorFontSize}
        agentAccess={agentAccess}
      />

      <ImportTextModal
        opened={importTextOpen}
        variants={availableVariants.map((v) => ({
          lang: v.lang,
          variant: v.variant,
        }))}
        defaultVariant={library?.manifest?.defaultVariant ?? null}
        onClose={() => setImportTextOpen(false)}
        onCreate={(input) => {
          flushPendingEdits();
          importDraft.start(input);
          firstDraft.startIfAvailable();
          setImportTextOpen(false);
          if (overlayMode) setLibraryCollapsed(true);
        }}
      />

      <ImportTextModal
        opened={addLanguageOpen && importDraft.draft !== null}
        addTo={addLanguageTarget}
        variants={availableVariants.map((v) => ({
          lang: v.lang,
          variant: v.variant,
        }))}
        defaultVariant={null}
        onClose={() => setAddLanguageOpen(false)}
        onCreate={(input) => {
          if (importDraft.addLanguage(input)) {
            setAddLanguageOpen(false);
            firstDraft.startIfAvailable({ only: ["pair"] });
          }
          else onNotice({ color: "accent", title: "Cannot add language", message: "The language is already in the draft." });
        }}
        onAddColumn={(input) => {
          if (importDraft.addColumn(input)) {
            setAddLanguageOpen(false);
            firstDraft.startIfAvailable({ only: ["pair"] });
          }
          else onNotice({ color: "accent", title: "Cannot add language", message: "The language is already in the draft." });
        }}
      />

      {importDraft.draft ? (
        <ImportSaveModal
          opened={importSaveOpen}
          draft={importDraft.draft}
          blockCount={importDraft.prayer?.structure.length ?? 0}
          takenIds={takenIds}
          busy={createBusy}
          onClose={() => setImportSaveOpen(false)}
          onSave={(input) => void saveImport(input)}
        />
      ) : null}

      <ConfirmDialog
        opened={agentConfirm !== null}
        onClose={() => {
          agentConfirm?.resolve(false);
          setAgentConfirm(null);
        }}
        onConfirm={() => {
          agentConfirm?.resolve(true);
          setAgentConfirm(null);
        }}
        title={agentConfirm?.title ?? ""}
        message={agentConfirm?.message ?? ""}
        confirmLabel={agentConfirm?.confirmLabel ?? "OK"}
      />

      <ConfirmDialog
        opened={leaveImportFor !== null}
        onClose={() => setLeaveImportFor(null)}
        title="Discard import draft?"
        message={
          leaveImportFor === "new-import"
            ? "A new import replaces the open import draft and every change to it."
            : "Opening another prayer drops the import draft and every change to it."
        }
        confirmLabel="Discard"
        onConfirm={() => {
          const next = leaveImportFor;
          setLeaveImportFor(null);
          importDraft.discard();
          if (next === "new-import") setImportTextOpen(true);
          else if (next) void session.openEntry(next);
        }}
      />

      <NewLibraryModal
        opened={newLibraryOpen}
        onClose={() => setNewLibraryOpen(false)}
        busy={busy}
        onCreate={(input) => session.createLibrary(input)}
      />

      {draft && selectedPath && library ? (
        <ExportModal
          opened={exportOpen}
          onClose={() => setExportOpen(false)}
          prayer={draft}
          prayerPath={selectedPath}
          libraryRoot={library.root}
          resolvedStyles={resolvedStyles}
          libraryManifest={library.manifest}
          libraryDefault={library.manifest?.defaultVariant}
          visibleVariants={visibleVariants}
          busy={busy}
          onExport={(payload) =>
            session.exportEntry(
              {
                path: selectedPath,
                id: draft.id,
                title: null,
                description: draft.description ?? null,
                valid: draftErrors.length === 0,
                errors: draftErrors,
                filenameMismatch: false,
                kinds: [],
                readable: true,
                needsMigration: false,
                variants: [],
                scanned: true,
              },
              payload.variant,
              payload.format,
              {
                includeBlocksWithoutTranslation:
                  payload.includeBlocksWithoutTranslation,
                styles: resolvedStyles,
                html: payload.html,
                layout: payload.layout,
                parallel: payload.parallel,
              },
            )
          }
        />
      ) : null}

      <ConfirmDialog
        opened={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete prayer?"
        message={`Delete “${pendingDelete?.id ?? pendingDelete?.path}”? This cannot be undone.`}
        loading={deleteBusy}
        onConfirm={() => {
          if (!pendingDelete) return;
          const deletingSelected = pendingDelete.path === selectedPath;
          void session.deleteEntry(pendingDelete).then(() => {
            if (deletingSelected) setSettingsOpen(false);
          });
        }}
      />

      <ConfirmDialog
        opened={session.pendingKindRename !== null}
        onClose={session.cancelKindRename}
        title="Rename kind in library?"
        message={
          session.pendingKindRename
            ? kindRenameConfirmMessage(session.pendingKindRename)
            : ""
        }
        confirmLabel="Rename"
        loading={session.kindRenameBusy || busy}
        onConfirm={() => void session.confirmKindRename()}
      />

      <WhatsNewDialog
        opened={whatsNewOpen}
        entries={notesForRunning(RELEASE_NOTES, runningVersion)}
        onDismiss={() => {
          saveLastSeenWhatsNew(runningVersion);
          setWhatsNewOpen(false);
        }}
      />

      <UnsavedChangesDialog
        opened={pendingLeave !== null}
        count={unsavedCount}
        reason={
          pendingLeave?.type === "install-update"
            ? "The update installs and restarts the app afterwards."
            : pendingLeave?.type === "reload-library"
              ? "Refresh reloads the library and the open prayer from disk."
              : undefined
        }
        loading={leaveBusy || busy}
        onCancel={() => setPendingLeave(null)}
        onDiscard={() => {
          void session.handleLeaveDiscard().then((action) => {
            if (action?.type === "open-folder") setLibrarySettingsOpen(false);
          });
        }}
        onSaveAll={() => {
          flushPendingEdits();
          void session.handleLeaveSaveAll().then((action) => {
            if (action?.type === "open-folder") setLibrarySettingsOpen(false);
          });
        }}
      />
    </>
  );
}
