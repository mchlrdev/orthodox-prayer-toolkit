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
import { indexVariants } from "@orthodox-prayer-toolkit/core";
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
      void session.openEntry(entry);
      if (overlayMode) setLibraryCollapsed(true);
    },
    [overlayMode, session],
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
  }, [selectedPath, draft, visibleVariants.length, library]);

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
            {selectedPath && !draft ? (
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
              prayer={draft}
              primary={visibleVariants[0] ?? null}
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
