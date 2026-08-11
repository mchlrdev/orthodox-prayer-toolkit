import { Button, Group, Modal, Stack, Text } from "@mantine/core";

type Props = {
  opened: boolean;
  count: number;
  loading?: boolean;
  onSaveAll: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

export function UnsavedChangesDialog({
  opened,
  count,
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
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="default"
            color="accent"
            onClick={onDiscard}
            disabled={loading}
          >
            Discard all
          </Button>
          <Button onClick={onSaveAll} loading={loading}>
            Save all
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
