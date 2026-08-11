import { ActionIcon, Button, Group, Stack, Text } from "@mantine/core";
import {
  IconFolderOpen,
  IconFolderPlus,
  IconX,
} from "@tabler/icons-react";
import {
  recentLibraryLabel,
  type RecentLibrary,
} from "../recentLibraries";

type Props = {
  recent: RecentLibrary[];
  busy?: boolean;
  desktopAvailable: boolean;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onOpenFolder: () => void;
  onNewLibrary: () => void;
};

export function LibraryWelcome({
  recent,
  busy = false,
  desktopAvailable,
  onOpenRecent,
  onRemoveRecent,
  onOpenFolder,
  onNewLibrary,
}: Props) {
  return (
    <div className="workspace-empty library-welcome">
      <div className="library-welcome-panel">
        <Text className="library-welcome-kicker">Prayer library</Text>
        <Text className="library-welcome-title">Open a library to begin</Text>
        <Text size="sm" c="dimmed" className="library-welcome-copy">
          {desktopAvailable
            ? "Choose a recent folder, browse for an existing library, or create a new one."
            : "Browser preview loads the examples library automatically. Use the desktop app to open or create other folders."}
        </Text>

        {desktopAvailable ? (
          <Group gap="sm" mt="md" className="library-welcome-actions">
            <Button
              leftSection={<IconFolderOpen size={16} />}
              onClick={onOpenFolder}
              disabled={busy}
            >
              Open library…
            </Button>
            <Button
              variant="default"
              leftSection={<IconFolderPlus size={16} />}
              onClick={onNewLibrary}
              disabled={busy}
            >
              New library…
            </Button>
          </Group>
        ) : null}

        {recent.length > 0 ? (
          <Stack gap={4} mt="xl" className="library-welcome-recents">
            <Text className="library-welcome-recents-label">Recent</Text>
            {recent.map((entry) => (
              <div key={entry.path} className="library-welcome-recent-row">
                <button
                  type="button"
                  className="library-welcome-recent"
                  disabled={busy || !desktopAvailable}
                  onClick={() => onOpenRecent(entry.path)}
                  title={entry.path}
                >
                  <span className="library-welcome-recent-name">
                    {recentLibraryLabel(entry.path)}
                  </span>
                  <span className="library-welcome-recent-path">
                    {entry.path}
                  </span>
                </button>
                <ActionIcon
                  className="library-welcome-recent-remove"
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={`Remove ${recentLibraryLabel(entry.path)} from recent`}
                  title="Remove from recent"
                  onClick={() => onRemoveRecent(entry.path)}
                >
                  <IconX size={14} stroke={1.75} />
                </ActionIcon>
              </div>
            ))}
          </Stack>
        ) : desktopAvailable ? (
          <Text size="sm" c="dimmed" mt="xl">
            No recent libraries yet.
          </Text>
        ) : null}
      </div>
    </div>
  );
}
