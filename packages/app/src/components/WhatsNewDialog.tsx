import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { ReleaseNotesEntry } from "../releaseNotes";

type Props = {
  opened: boolean;
  entries: ReleaseNotesEntry[];
  onDismiss: () => void;
};

export function WhatsNewDialog({ opened, entries, onDismiss }: Props) {
  if (entries.length === 0) return null;

  return (
    <Modal
      opened={opened}
      onClose={onDismiss}
      title="What’s new"
      size="md"
      centered
      classNames={{ content: "whats-new-dialog" }}
    >
      <Stack gap="md">
        {entries.map((entry) => (
          <Stack key={entry.version} gap="xs">
            <Text fw={600} size="sm">
              v{entry.version}
            </Text>
            {/* Plain list: Mantine List keeps li nowrap + inside markers, which clips wrapped lines. */}
            <ul className="whats-new-list">
              {entry.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Stack>
        ))}
        <Group justify="flex-end">
          <Button color="accent" onClick={onDismiss}>
            Got it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
