import { Modal, Stack, UnstyledButton } from "@mantine/core";
import {
  IconFileText,
  IconLanguage,
  IconPalette,
} from "@tabler/icons-react";
import {
  deleteKind,
  isKindPreset,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { ExtraFieldsEditor } from "./ExtraFieldsEditor";
import { KindStylesPanel } from "./KindStylesPanel";
import { LanguagesPanel } from "./LanguagesPanel";
import { PrayerBasicsFields } from "./PrayerBasicsFields";
import { removeStyleKey } from "../prayerEdit";

export type PrayerSettingsPane = "prayer" | "languages" | "styles";

type ActiveVariant = { lang: string; variant: string };

type Props = {
  opened: boolean;
  onClose: () => void;
  pane: PrayerSettingsPane;
  onPaneChange: (pane: PrayerSettingsPane) => void;
  prayer: Prayer;
  activeVariant: ActiveVariant;
  onChange: (prayer: Prayer) => void;
  onActiveVariantChange: (v: ActiveVariant) => void;
  onRenameKind: (from: string, to: string) => void;
  styles: {
    kinds: string[];
    resolved: StyleMap;
    appStyles: StyleMap;
    libraryStyles: StyleMap;
    libraryEnabled: boolean;
    onChangeApp: (next: StyleMap) => void;
    onChangeLibrary: (next: StyleMap) => void;
  };
};

const NAV: {
  id: PrayerSettingsPane;
  label: string;
  icon: typeof IconFileText;
}[] = [
  { id: "prayer", label: "Prayer", icon: IconFileText },
  { id: "languages", label: "Languages", icon: IconLanguage },
  { id: "styles", label: "Kinds", icon: IconPalette },
];

export function PrayerSettingsModal({
  opened,
  onClose,
  pane,
  onPaneChange,
  prayer,
  activeVariant,
  onChange,
  onActiveVariantChange,
  onRenameKind,
  styles,
}: Props) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Settings"
      size={760}
      padding={0}
      className="settings-hub-modal"
      styles={{
        body: { padding: 0 },
        content: { overflow: "hidden" },
      }}
    >
      <div className="settings-hub">
        <nav className="settings-hub-nav" aria-label="Settings">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pane === item.id;
            return (
              <UnstyledButton
                key={item.id}
                className="settings-hub-nav-item"
                data-active={active ? "true" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => onPaneChange(item.id)}
              >
                <Icon size={16} stroke={1.75} />
                <span>{item.label}</span>
              </UnstyledButton>
            );
          })}
        </nav>
        <div className="settings-hub-pane">
          <div
            className="settings-hub-pane-section"
            data-active={pane === "prayer" ? "true" : undefined}
            aria-hidden={pane !== "prayer"}
          >
            <Stack gap="lg">
              <PrayerBasicsFields prayer={prayer} onChange={onChange} />
              <ExtraFieldsEditor prayer={prayer} onChange={onChange} />
            </Stack>
          </div>
          <div
            className="settings-hub-pane-section"
            data-active={pane === "languages" ? "true" : undefined}
            aria-hidden={pane !== "languages"}
          >
            <LanguagesPanel
              prayer={prayer}
              activeVariant={activeVariant}
              onChange={onChange}
              onActiveVariantChange={onActiveVariantChange}
            />
          </div>
          <div
            className="settings-hub-pane-section"
            data-active={pane === "styles" ? "true" : undefined}
            aria-hidden={pane !== "styles"}
          >
            <KindStylesPanel
              kinds={styles.kinds}
              resolved={styles.resolved}
              libraryStyles={styles.libraryStyles}
              libraryEnabled={styles.libraryEnabled}
              onChangeLibrary={styles.onChangeLibrary}
              onRenameKind={onRenameKind}
              onRemoveKind={(kind) => {
                if (isKindPreset(kind)) return;
                styles.onChangeLibrary(
                  removeStyleKey(styles.libraryStyles, kind),
                );
                styles.onChangeApp(removeStyleKey(styles.appStyles, kind));
                if (prayer.structure.some((block) => block.kind === kind)) {
                  onChange(deleteKind(prayer, kind));
                }
              }}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
