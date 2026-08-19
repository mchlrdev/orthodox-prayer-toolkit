import { Button, Group, Modal, Stack, Text } from "@mantine/core";

type Props = {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
  zIndex?: number;
  withinPortal?: boolean;
};

export function ConfirmDialog({
  opened,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
  loading = false,
  zIndex,
  withinPortal,
}: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size="sm"
      centered
      zIndex={zIndex}
      withinPortal={withinPortal}
    >
      <Stack gap="md">
        <Text size="sm">{message}</Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button color="accent" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
