import { Modal, Stack, UnstyledButton } from "@mantine/core";
import {
  IconFileText,
  IconLanguage,
  IconMicrophone,
  IconPalette,
} from "@tabler/icons-react";
import type { Prayer, StyleMap } from "@orthodox-prayer-toolkit/core";
import { ExtraFieldsEditor } from "./ExtraFieldsEditor";
import { KindStylesPanel } from "./KindStylesPanel";
import { LanguagesPanel } from "./LanguagesPanel";
import { PrayerBasicsFields } from "./PrayerBasicsFields";
import { SpeakersPanel } from "./SpeakersPanel";

export type PrayerSettingsPane = "prayer" | "languages" | "speakers" | "styles";

type ActiveVariant = { lang: string; variant: string };

type Props = {
  opened: boolean;
  onClose: () => void;
  pane: PrayerSettingsPane;
  onPaneChange: (pane: PrayerSettingsPane) => void;
  prayer: Prayer;
  activeVariant: ActiveVariant;
  onChange: (prayer: Prayer, options?: { coalesceKey?: string }) => void;
  onActiveVariantChange: (v: ActiveVariant) => void;
  onRenameKind: (from: string, to: string) => void;
  /** Delete a custom kind (library-wide; the session asks when others use it). */
  onRemoveKind: (kind: string) => void;
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
  { id: "speakers", label: "Speakers", icon: IconMicrophone },
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
  onRemoveKind,
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
            data-active={pane === "speakers" ? "true" : undefined}
            aria-hidden={pane !== "speakers"}
          >
            <SpeakersPanel
              key={`${prayer.id}:${opened ? "open" : "closed"}`}
              prayer={prayer}
              onChange={onChange}
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
              onRemoveKind={onRemoveKind}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
