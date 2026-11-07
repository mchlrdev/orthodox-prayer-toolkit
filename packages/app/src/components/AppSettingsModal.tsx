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
  UnstyledButton,
} from "@mantine/core";
import {
  IconCopy,
  IconCpu,
  IconInfoCircle,
  IconPalette,
  IconPlugConnected,
  IconTypography,
} from "@tabler/icons-react";
import { agentPrompt, type AgentAccess } from "../agentTools/useAgentAccess";
import { BuiltInModelSection } from "./BuiltInModelSection";
import { LanguageFontsSection } from "./LanguageFontsSection";
import type { IndexedVariant, Prayer } from "@orthodox-prayer-toolkit/core";
import type { ColumnWidth, VariantFonts } from "../languageFontPrefs";
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

type AppSettingsPane = "appearance" | "fonts" | "model" | "agent" | "about";

const NAV: {
  id: AppSettingsPane;
  label: string;
  icon: typeof IconPalette;
}[] = [
  { id: "appearance", label: "Appearance", icon: IconPalette },
  { id: "fonts", label: "Language fonts", icon: IconTypography },
  { id: "model", label: "Built-in model", icon: IconCpu },
  { id: "agent", label: "Agent access", icon: IconPlugConnected },
  { id: "about", label: "About", icon: IconInfoCircle },
];

type Props = {
  opened: boolean;
  onClose: () => void;
  colorScheme: ColorSchemePreference;
  onColorSchemeChange: (value: ColorSchemePreference) => void;
  editorFontSize: number;
  onEditorFontSizeChange: (value: number) => void;
  columnWidth: ColumnWidth;
  onColumnWidthChange: (value: ColumnWidth) => void;
  variantFonts: VariantFonts;
  onVariantFontsChange: (value: VariantFonts) => void;
  /** Variants of the open Library and open drafts. */
  libraryVariants: IndexedVariant[];
  openPrayer: Prayer | null;
  agentAccess: AgentAccess;
};

export function AppSettingsModal({
  opened,
  onClose,
  colorScheme,
  onColorSchemeChange,
  editorFontSize,
  onEditorFontSizeChange,
  columnWidth,
  onColumnWidthChange,
  variantFonts,
  onVariantFontsChange,
  libraryVariants,
  openPrayer,
  agentAccess,
}: Props) {
  const [pane, setPane] = useState<AppSettingsPane>("appearance");
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

  const section = (id: AppSettingsPane) => ({
    className: "settings-hub-pane-section",
    "data-active": pane === id ? "true" : undefined,
    "aria-hidden": pane !== id,
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="App settings"
      size={760}
      padding={0}
      className="settings-hub-modal"
      styles={{
        body: { padding: 0 },
        content: { overflow: "hidden" },
      }}
    >
      <div className="settings-hub">
        <nav className="settings-hub-nav" aria-label="App settings">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pane === item.id;
            return (
              <UnstyledButton
                key={item.id}
                className="settings-hub-nav-item"
                data-active={active ? "true" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => setPane(item.id)}
              >
                <Icon size={16} stroke={1.75} />
                <span>{item.label}</span>
              </UnstyledButton>
            );
          })}
        </nav>
        <div className="settings-hub-pane">
          <div {...section("appearance")}>
            <Stack gap="lg">
              <Stack gap={6}>
                <Text size="sm" fw={600}>
                  Color scheme
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

              <Stack gap={6}>
                <Text size="sm" fw={600}>
                  Maximum column width
                </Text>
                <SegmentedControl
                  fullWidth
                  value={columnWidth}
                  onChange={(v) => onColumnWidthChange(v as ColumnWidth)}
                  data={[
                    { label: "Narrow", value: "narrow" },
                    { label: "Medium", value: "medium" },
                    { label: "Wide", value: "wide" },
                  ]}
                />
              </Stack>
            </Stack>
          </div>

          <div {...section("fonts")}>
            <LanguageFontsSection
              fonts={variantFonts}
              onChange={onVariantFontsChange}
              libraryVariants={libraryVariants}
              openPrayer={openPrayer}
            />
          </div>

          <div {...section("model")}>
            <BuiltInModelSection active={opened} />
          </div>

          <div {...section("agent")}>
            <Stack gap={8}>
              <Group justify="space-between" align="center">
                <Text size="sm" fw={600}>
                  Agent access
                </Text>
                <Switch
                  aria-label="Agent access"
                  checked={agentAccess.enabled}
                  disabled={!agentAccess.available}
                  onChange={(e) =>
                    agentAccess.setEnabled(e.currentTarget.checked)
                  }
                />
              </Group>
              <Text size="xs" c="dimmed">
                Lets agents such as Claude Code or Cursor on this computer edit
                imports and the library through the same tools.
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
                    <Text size="xs">
                      Running on 127.0.0.1:{agentAccess.port}
                    </Text>
                  </Group>
                  <div className="agent-prompt">
                    <code>{agentPrompt(agentAccess.port)}</code>
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconCopy size={13} />}
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(agentPrompt(agentAccess.port!))
                          .then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          });
                      }}
                    >
                      {copied ? "Copied" : "Copy prompt"}
                    </Button>
                  </div>
                  <Text size="xs" c="dimmed">
                    Saving, deleting and library-wide changes always ask in the
                    app first.
                  </Text>
                </>
              ) : null}
            </Stack>
          </div>

          <div {...section("about")}>
            <Stack gap={6}>
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
                  The update is downloading. You'll be asked to install it when
                  it's ready.
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
          </div>
        </div>
      </div>
    </Modal>
  );
}
