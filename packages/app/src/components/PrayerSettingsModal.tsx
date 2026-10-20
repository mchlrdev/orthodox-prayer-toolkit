import { Modal, Stack, UnstyledButton } from "@mantine/core";
import {
  IconFileText,
  IconLanguage,
  IconMicrophone,
  IconPalette,
} from "@tabler/icons-react";
import type {
  KindDef,
  KindTemplate,
  Prayer,
  KindStyle,
  StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { ExtraFieldsEditor } from "./ExtraFieldsEditor";
import { PrayerKindsPanel } from "./PrayerKindsPanel";
import { LanguagesPanel } from "./LanguagesPanel";
import { PrayerBasicsFields } from "./PrayerBasicsFields";
import { SpeakersPanel } from "./SpeakersPanel";

export type PrayerSettingsPane = "prayer" | "languages" | "speakers" | "kinds";

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
  /** Declare a custom kind in this prayer. */
  onAddKind: (def: KindDef) => void;
  /** Delete a custom kind from this prayer (undoable draft edit). */
  onRemoveKind: (kind: string) => void;
  onSetKindSpeaker: (kind: string, allowed: boolean) => void;
  /** Additive "Apply template" (undoable draft edit). */
  onApplyTemplate: (templateId: string) => void;
  templates: readonly KindTemplate[];
  styles: {
    /** Every kind the library knows. */
    libraryKinds: string[];
    resolved: StyleMap;
    libraryEnabled: boolean;
    onPatchStyle: (kind: string, partial: Partial<KindStyle>) => void;
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
  { id: "kinds", label: "Kinds", icon: IconPalette },
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
  onAddKind,
  onRemoveKind,
  onSetKindSpeaker,
  onApplyTemplate,
  templates,
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
            data-active={pane === "kinds" ? "true" : undefined}
            aria-hidden={pane !== "kinds"}
          >
            <PrayerKindsPanel
              prayer={prayer}
              libraryKinds={styles.libraryKinds}
              templates={templates}
              resolved={styles.resolved}
              libraryEnabled={styles.libraryEnabled}
              onPatchStyle={styles.onPatchStyle}
              onRenameKind={onRenameKind}
              onAddKind={onAddKind}
              onRemoveKind={onRemoveKind}
              onSetKindSpeaker={onSetKindSpeaker}
              onApplyTemplate={onApplyTemplate}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
