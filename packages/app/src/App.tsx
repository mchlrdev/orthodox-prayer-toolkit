import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, useMantineColorScheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconChevronLeft,
  IconChevronRight,
} from "@tabler/icons-react";
import { indexVariants, kindDisplayLabel } from "@orthodox-prayer-toolkit/core";
import { isBrowserDev } from "./api";
import { PrayerList } from "./components/PrayerList";
import { PrayerWorkspace } from "./components/PrayerWorkspace";
import { ContentOutline } from "./components/ContentOutline";
import {
  PrayerSettingsModal,
  type PrayerSettingsPane,
} from "./components/PrayerSettingsModal";
import { NewPrayerModal } from "./components/NewPrayerModal";
import { LibrarySettingsModal } from "./components/LibrarySettingsModal";
import { AppSettingsModal } from "./components/AppSettingsModal";
import { ExportModal } from "./components/ExportModal";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { InvalidPrayerScreen } from "./components/InvalidPrayerScreen";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { LibraryWelcome } from "./components/LibraryWelcome";
import { NewLibraryModal } from "./components/NewLibraryModal";
import type { InlineEditorHandle } from "./components/InlineEditor";
import type { LibraryEntry } from "./library";
import { usePrayerSession } from "./usePrayerSession";
import type { SessionNotice } from "./session";
import { loadSidebarPrefs, saveSidebarPrefs } from "./sidebarPrefs";
import {
  loadAppearancePrefs,
  saveAppearancePrefs,
  type ColorSchemePreference,
} from "./appearancePrefs";
import { toMantineColorScheme } from "./mantineColorScheme";

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
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [newLibraryOpen, setNewLibraryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const initialPrefs = useMemo(() => loadSidebarPrefs(), []);
  const [libraryCollapsed, setLibraryCollapsed] = useState(
    initialPrefs.libraryCollapsed,
  );
  const [contentCollapsed, setContentCollapsed] = useState(
    initialPrefs.contentCollapsed,
  );
  const [colorSchemePref, setColorSchemePref] = useState<ColorSchemePreference>(
    () => loadAppearancePrefs().colorScheme,
  );

  const overlayMode = useMediaQuery(OVERLAY_BREAKPOINT) ?? false;
  const editorRef = useRef<InlineEditorHandle>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const prevOverlayModeRef = useRef<boolean | null>(null);

  useEffect(() => {
    saveSidebarPrefs({ libraryCollapsed, contentCollapsed });
  }, [libraryCollapsed, contentCollapsed]);

  useEffect(() => {
    saveAppearancePrefs({ colorScheme: colorSchemePref });
    setColorScheme(toMantineColorScheme(colorSchemePref));
  }, [colorSchemePref, setColorScheme]);


  const handleSelectEntry = useCallback(
    (entry: LibraryEntry) => {
      void session.openEntry(entry);
      if (overlayMode) setLibraryCollapsed(true);
    },
    [overlayMode, session],
  );

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
    visibleVariants,
    setVisibleVariants,
    activeVariant,
    appStyles,
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

  return (
    <>
      <div
        className="app-shell"
        data-overlay={overlayMode ? "true" : undefined}
        data-library-collapsed={libraryCollapsed ? "true" : undefined}
        data-content-collapsed={contentCollapsed ? "true" : undefined}
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
                appStyles,
                libraryStyles: library?.libraryStyles ?? {},
                libraryEnabled: Boolean(library),
                onChangeApp: (next) => void session.persistAppStyles(next),
                onChangeLibrary: (next) =>
                  void session.persistLibraryStyles(next),
              }}
              busy={busy}
              dirty={dirty}
              editorRef={editorRef}
              scrollRootRef={scrollRootRef}
              onChange={session.updateDraft}
              onVisibleVariantsChange={setVisibleVariants}
              onSave={() => void session.saveDraft()}
              onSettings={() => setSettingsOpen(true)}
              onExport={() => setExportOpen(true)}
              onRenameKind={(from, to) => {
                void session.requestKindRename(from, to);
              }}
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

        {showBackdrop ? (
          <button
            type="button"
            className="sidebar-backdrop"
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
          styles={{
            kinds: Object.keys(resolvedStyles),
            resolved: resolvedStyles,
            appStyles,
            libraryStyles: library?.libraryStyles ?? {},
            libraryEnabled: Boolean(library),
            onChangeApp: (next) => void session.persistAppStyles(next),
            onChangeLibrary: (next) =>
              void session.persistLibraryStyles(next),
          }}
        />
      ) : null}

      {library ? (
        <LibrarySettingsModal
          opened={librarySettingsOpen}
          onClose={() => setLibrarySettingsOpen(false)}
          manifest={library.manifest}
          availableVariants={availableVariants}
          busy={busy}
          onSave={session.saveLibraryManifest}
        />
      ) : null}

      <AppSettingsModal
        opened={appSettingsOpen}
        onClose={() => setAppSettingsOpen(false)}
        colorScheme={colorSchemePref}
        onColorSchemeChange={setColorSchemePref}
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
                variants: [],
                scanned: true,
              },
              payload.variant,
              payload.format,
              {
                includeBlocksWithoutTranslation:
                  payload.includeBlocksWithoutTranslation,
                html: payload.html,
                layout: payload.layout,
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
            ? `Rename “${kindDisplayLabel(session.pendingKindRename.from)}” to “${kindDisplayLabel(session.pendingKindRename.to)}” in ${session.pendingKindRename.affectedPaths.length} prayers? This writes those files now.`
            : ""
        }
        confirmLabel="Rename"
        loading={session.kindRenameBusy || busy}
        onConfirm={() => void session.confirmKindRename()}
      />

      <UnsavedChangesDialog
        opened={pendingLeave !== null}
        count={unsavedCount}
        loading={leaveBusy || busy}
        onCancel={() => setPendingLeave(null)}
        onDiscard={() => {
          void session.handleLeaveDiscard().then((action) => {
            if (action?.type === "open-folder") setLibrarySettingsOpen(false);
          });
        }}
        onSaveAll={() => {
          void session.handleLeaveSaveAll().then((action) => {
            if (action?.type === "open-folder") setLibrarySettingsOpen(false);
          });
        }}
      />
    </>
  );
}
