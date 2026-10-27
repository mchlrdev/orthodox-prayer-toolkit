import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import { agentPrompt, type AgentAccess } from "../agentTools/useAgentAccess";
import {
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  type ColorSchemePreference,
} from "../appearancePrefs";
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
  editorFontSize: number;
  onEditorFontSizeChange: (value: number) => void;
  agentAccess: AgentAccess;
};

export function AppSettingsModal({
  opened,
  onClose,
  colorScheme,
  onColorSchemeChange,
  editorFontSize,
  onEditorFontSizeChange,
  agentAccess,
}: Props) {
  const [copied, setCopied] = useState(false);
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

        <Stack gap={8}>
          <Group justify="space-between" align="baseline">
            <Text size="sm" fw={600}>
              Editor text size
            </Text>
            <Text size="sm" c="dimmed">
              {editorFontSize}px
            </Text>
          </Group>
          <Slider
            min={EDITOR_FONT_SIZE_MIN}
            max={EDITOR_FONT_SIZE_MAX}
            step={1}
            value={editorFontSize}
            onChange={onEditorFontSizeChange}
            label={null}
          />
        </Stack>

        <Stack gap={8}>
          <Group justify="space-between" align="center">
            <Text size="sm" fw={600}>
              Agent access
            </Text>
            <Switch
              aria-label="Agent access"
              checked={agentAccess.enabled}
              disabled={!agentAccess.available}
              onChange={(e) => agentAccess.setEnabled(e.currentTarget.checked)}
            />
          </Group>
          <Text size="xs" c="dimmed">
            Lets agents such as Claude Code or Cursor on this computer edit imports and the
            library through the same tools.
          </Text>
          {!agentAccess.available ? (
            <Text size="xs" c="dimmed">
              Needs the desktop app.
            </Text>
          ) : agentAccess.error ? (
            <Text size="xs" c="red">
              {agentAccess.error}
            </Text>
          ) : agentAccess.enabled && agentAccess.port !== null ? (
            <>
              <Group gap={6} className="agent-status">
                <span className="agent-status-dot" aria-hidden="true" />
                <Text size="xs">Running on 127.0.0.1:{agentAccess.port}</Text>
              </Group>
              <div className="agent-prompt">
                <code>{agentPrompt(agentAccess.port)}</code>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconCopy size={13} />}
                  onClick={() => {
                    void navigator.clipboard.writeText(agentPrompt(agentAccess.port!)).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? "Copied" : "Copy prompt"}
                </Button>
              </div>
              <Text size="xs" c="dimmed">
                Saving, deleting and library-wide changes always ask in the app first.
              </Text>
            </>
          ) : null}
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
