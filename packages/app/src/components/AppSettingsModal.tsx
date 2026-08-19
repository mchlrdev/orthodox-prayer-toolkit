import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import type { ColorSchemePreference } from "../appearancePrefs";
import { getToolkitApi } from "../api";
import {
  type AppUpdateCheckResult,
  updateStatusMessage,
} from "../../electron/updateCheck";

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
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<AppUpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!opened) return;
    const api = getToolkitApi();
    let cancelled = false;

    setUpdate(null);
    setChecking(true);

    const unsub = api.onUpdateStatus((result) => {
      if (!cancelled) {
        setUpdate(result);
        setChecking(false);
      }
    });

    void (async () => {
      try {
        const info = await api.getAppInfo();
        if (cancelled) return;
        setVersion(info.version);
        const result = await api.checkForUpdates();
        if (!cancelled) setUpdate(result);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
      unsub();
    };
  }, [opened]);

  const onCheck = () => {
    setChecking(true);
    void (async () => {
      try {
        const result = await getToolkitApi().checkForUpdates();
        setUpdate(result);
      } finally {
        setChecking(false);
      }
    })();
  };

  const onInstall = () => {
    setInstalling(true);
    void (async () => {
      try {
        await getToolkitApi().installUpdate();
      } finally {
        setInstalling(false);
      }
    })();
  };

  const statusText = checking
    ? "Checking for updates…"
    : update
      ? updateStatusMessage(update)
      : null;
  const showCheckButton = update !== null && update.status !== "dev";
  const showInstall = !checking && update?.status === "ready";
  const error = !checking && update?.status === "error";

  return (
    <Modal opened={opened} onClose={onClose} title="App settings" size="md">
      <Stack gap="lg">
        <Stack gap={6}>
          <Text size="sm" fw={600}>
            Appearance
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

        <Stack gap={6}>
          <Text size="sm" fw={600}>
            About
          </Text>
          <Text size="sm">
            {version ? `Version ${version}` : "Loading version…"}
          </Text>
          {statusText ? (
            <Group gap={8} wrap="nowrap" align="flex-start">
              {checking ? <Loader size="xs" mt={2} /> : null}
              <Text size="xs" c={error ? "red" : "dimmed"}>
                {statusText}
              </Text>
            </Group>
          ) : null}
          {!checking && update?.status === "available" ? (
            <Text size="xs" c="dimmed">
              The update is downloading. You'll be asked to install it when it's
              ready.
            </Text>
          ) : null}
          {showCheckButton || showInstall ? (
            <Group gap="sm" mt={4}>
              {showInstall ? (
                <Button onClick={onInstall} loading={installing}>
                  Install and Restart
                </Button>
              ) : null}
              {showCheckButton ? (
                <Button
                  variant="default"
                  onClick={onCheck}
                  disabled={checking || installing}
                >
                  Check for updates
                </Button>
              ) : null}
            </Group>
          ) : null}
        </Stack>
      </Stack>
    </Modal>
  );
}
