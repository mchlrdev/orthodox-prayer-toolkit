import { useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  Menu,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAdjustments,
  IconDots,
  IconFolderOpen,
  IconFolderPlus,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import type { IdCollision } from "@orthodox-prayer-toolkit/core";
import type { LibraryEntry } from "../library";
import {
  recentLibraryLabel,
  type RecentLibrary,
} from "../recentLibraries";

type Props = {
  folderLabel: string | null;
  libraryOpen: boolean;
  libraryRoot?: string | null;
  entries: LibraryEntry[];
  collisions: IdCollision[];
  selectedPath: string | null;
  unsavedPaths: string[];
  busy: boolean;
  description?: string;
  recent: RecentLibrary[];
  onSelect: (entry: LibraryEntry) => void;
  onOpenFolder: () => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onNewLibrary: () => void;
  onReload: () => void;
  onCreate: () => void;
  onLibrarySettings: () => void;
  onAppSettings: () => void;
  onDelete: (entry: LibraryEntry) => void;
};

export function PrayerList({
  folderLabel,
  libraryOpen,
  libraryRoot = null,
  entries,
  collisions,
  selectedPath,
  unsavedPaths,
  busy,
  description,
  recent,
  onSelect,
  onOpenFolder,
  onOpenRecent,
  onRemoveRecent,
  onNewLibrary,
  onReload,
  onCreate,
  onLibrarySettings,
  onAppSettings,
  onDelete,
}: Props) {
  const [query, setQuery] = useState("");
  const [menuOpenPath, setMenuOpenPath] = useState<string | null>(null);
  const unsavedSet = useMemo(() => new Set(unsavedPaths), [unsavedPaths]);

  const menuRecents = useMemo(() => recent.slice(0, 8), [recent]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay =
        `${e.id ?? ""} ${e.title ?? ""} ${e.description ?? ""} ${e.path}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query]);

  return (
    <Stack gap="sm" h="100%" style={{ minHeight: 0 }}>
      <div className="sidebar-chrome">
        <div className="sidebar-header">
          <div className="sidebar-title-row">
            <Menu position="bottom-start" withinPortal>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="Library menu"
                  className="sidebar-menu-btn"
                >
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconFolderOpen size={14} />}
                  onClick={onOpenFolder}
                >
                  Open library…
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconFolderPlus size={14} />}
                  onClick={onNewLibrary}
                >
                  New library…
                </Menu.Item>
                {menuRecents.length > 0 ? (
                  <>
                    <Menu.Divider />
                    <Menu.Label>Recent</Menu.Label>
                    {menuRecents.map((entry) => {
                      const isCurrent = entry.path === libraryRoot;
                      return (
                        <div key={entry.path} className="sidebar-recent-row">
                          <button
                            type="button"
                            className="sidebar-recent-open"
                            disabled={busy || isCurrent}
                            title={entry.path}
                            onClick={() => {
                              if (!isCurrent) onOpenRecent(entry.path);
                            }}
                          >
                            <span className="sidebar-recent-name">
                              {recentLibraryLabel(entry.path)}
                              {isCurrent ? " (current)" : ""}
                            </span>
                            <span className="sidebar-recent-path">
                              {entry.path}
                            </span>
                          </button>
                          <ActionIcon
                            className="sidebar-recent-remove"
                            variant="subtle"
                            color="gray"
                            size="sm"
                            aria-label={`Remove ${recentLibraryLabel(entry.path)} from recent`}
                            title="Remove from recent"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveRecent(entry.path);
                            }}
                          >
                            <IconX size={12} stroke={1.75} />
                          </ActionIcon>
                        </div>
                      );
                    })}
                  </>
                ) : null}
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconAdjustments size={14} />}
                  onClick={onAppSettings}
                >
                  App settings
                </Menu.Item>
                {libraryOpen ? (
                  <>
                    <Menu.Item
                      leftSection={<IconSettings size={14} />}
                      onClick={onLibrarySettings}
                    >
                      Library settings
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconRefresh size={14} />}
                      onClick={onReload}
                      disabled={busy}
                    >
                      Refresh
                    </Menu.Item>
                  </>
                ) : null}
              </Menu.Dropdown>
            </Menu>
            <span
              className="sidebar-folder"
              data-empty={!libraryOpen}
              title={folderLabel ?? undefined}
            >
              {libraryOpen ? (folderLabel ?? "Library") : "No library"}
            </span>
          </div>
        </div>

        {description && libraryOpen ? (
          <Text size="xs" c="dimmed" className="sidebar-description">
            {description}
          </Text>
        ) : null}
      </div>

      {libraryOpen ? (
        <Group gap={6} wrap="nowrap" align="center">
          <TextInput
            className="sidebar-search"
            placeholder="Filter prayers…"
            leftSection={<IconSearch size={14} />}
            size="xs"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            styles={{
              root: { flex: 1, minWidth: 0 },
            }}
          />
          <ActionIcon
            variant="subtle"
            color="gray"
            onClick={onCreate}
            aria-label="New prayer"
            title="New prayer"
          >
            <IconPlus size={18} />
          </ActionIcon>
        </Group>
      ) : null}

      {collisions.length > 0 ? (
        <Alert color="accent" title="Duplicate ids" p="xs">
          <Text size="xs">{collisions.map((c) => c.id).join(", ")}</Text>
        </Alert>
      ) : null}

      {!libraryOpen ? (
        <Stack gap="xs" p="xs" style={{ flex: 1, justifyContent: "center" }}>
          <Text size="sm" c="dimmed">
            Open or create a library to list prayers.
          </Text>
        </Stack>
      ) : (
        <ScrollArea className="prayer-list-scroll" type="hover" scrollbarSize={6}>
          <Stack gap={2} w="100%">
            {filtered.map((entry) => (
              <div
                key={entry.path}
                className="prayer-row"
                data-active={selectedPath === entry.path}
                data-dirty={unsavedSet.has(entry.path)}
                data-menu-open={menuOpenPath === entry.path}
              >
                <button
                  type="button"
                  className="prayer-row-main"
                  onClick={() => onSelect(entry)}
                >
                  <div className="prayer-row-id">
                    {unsavedSet.has(entry.path) ? (
                      <span
                        className="prayer-row-dirty"
                        title="Unsaved changes"
                        aria-label="Unsaved changes"
                      />
                    ) : null}
                    {entry.id ?? entry.path}
                  </div>
                  <div className="prayer-row-title">
                    {entry.title ?? entry.path}
                  </div>
                  {entry.description ? (
                    <div className="prayer-row-description">
                      {entry.description}
                    </div>
                  ) : null}
                </button>
                <Group gap={4} wrap="nowrap" pr={4}>
                  {entry.valid ? null : (
                    <Badge size="xs" color="accent" variant="filled">
                      !
                    </Badge>
                  )}
                  <Menu
                    position="bottom-end"
                    withinPortal
                    onChange={(o) =>
                      setMenuOpenPath(o ? entry.path : null)
                    }
                  >
                    <Menu.Target>
                      <ActionIcon
                        className="prayer-row-menu"
                        variant="subtle"
                        color="gray"
                        size="sm"
                        aria-label="Prayer actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        color="accent"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => onDelete(entry)}
                      >
                        Delete
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </div>
            ))}
            {filtered.length === 0 ? (
              <Text size="sm" c="dimmed" px="xs" py="md">
                No prayers match.
              </Text>
            ) : null}
          </Stack>
        </ScrollArea>
      )}
    </Stack>
  );
}
