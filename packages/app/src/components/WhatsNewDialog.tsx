import { Button, Group, List, Modal, Stack } from "@mantine/core";

type Props = {
  opened: boolean;
  version: string;
  items: string[];
  onDismiss: () => void;
};

export function WhatsNewDialog({ opened, version, items, onDismiss }: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onDismiss}
      title={`What’s new in v${version}`}
      size="sm"
      centered
    >
      <Stack gap="md">
        <List size="sm" spacing="xs">
          {items.map((item) => (
            <List.Item key={item}>{item}</List.Item>
          ))}
        </List>
        <Group justify="flex-end">
          <Button color="accent" onClick={onDismiss}>
            Got it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
