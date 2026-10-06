import { Button, Group, Modal, Stack, Text } from "@mantine/core";

type Props = {
  opened: boolean;
  count: number;
  /** Extra line, e.g. why the app asks now. */
  reason?: string;
  loading?: boolean;
  onSaveAll: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

export function UnsavedChangesDialog({
  opened,
  count,
  reason,
  loading = false,
  onSaveAll,
  onDiscard,
  onCancel,
}: Props) {
  const label =
    count === 1
      ? "1 prayer has unsaved changes."
      : `${count} prayers have unsaved changes.`;

  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title="Unsaved changes"
      size="sm"
      centered
      closeOnClickOutside={!loading}
      closeOnEscape={!loading}
    >
      <Stack gap="md">
        <Text size="sm">{label} Save all, discard all, or cancel.</Text>
        {reason ? (
          <Text size="sm" c="dimmed">
            {reason}
          </Text>
        ) : null}
        <Group justify="flex-end" gap="sm" wrap="wrap">
          <Button variant="default" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="outline"
            color="accent"
            onClick={onDiscard}
            disabled={loading}
          >
            Discard all
          </Button>
          <Button color="accent" onClick={onSaveAll} loading={loading}>
            Save all
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
