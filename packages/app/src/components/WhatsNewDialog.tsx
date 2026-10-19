import { Button, Group, Modal, Stack } from "@mantine/core";

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
      size="md"
      centered
    >
      <Stack gap="md">
        {/* Plain list: Mantine List keeps li nowrap + inside markers, which clips wrapped lines. */}
        <ul className="whats-new-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <Group justify="flex-end">
          <Button color="accent" onClick={onDismiss}>
            Got it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
