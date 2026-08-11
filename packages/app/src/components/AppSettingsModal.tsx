import { Modal, SegmentedControl, Stack, Text } from "@mantine/core";
import type { ColorSchemePreference } from "../appearancePrefs";

type Props = {
  opened: boolean;
  onClose: () => void;
  colorScheme: ColorSchemePreference;
  onColorSchemeChange: (value: ColorSchemePreference) => void;
};

export function AppSettingsModal({
  opened,
  onClose,
  colorScheme,
  onColorSchemeChange,
}: Props) {
  return (
    <Modal opened={opened} onClose={onClose} title="App settings" size="md">
      <Stack gap="lg">
        <Stack gap={6}>
          <Text size="sm" fw={600}>
            Appearance
          </Text>
          <Text size="xs" c="dimmed">
            Choose light, dark, or follow the system setting.
          </Text>
          <SegmentedControl
            fullWidth
            value={colorScheme}
            onChange={(v) =>
              onColorSchemeChange(v as ColorSchemePreference)
            }
            data={[
              { label: "Light", value: "light" },
              { label: "Dark", value: "dark" },
              { label: "System", value: "system" },
            ]}
          />
        </Stack>
      </Stack>
    </Modal>
  );
}
