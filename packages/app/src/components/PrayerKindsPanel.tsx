import { useState } from "react";
import {
  Accordion,
  Button,
  Group,
  Menu,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { IconChevronDown, IconTemplate, IconTrash } from "@tabler/icons-react";
import {
  FALLBACK_KIND_STYLE,
  isKindPreset,
  kindDisplayLabel,
  pickerKinds,
  sanitizeKindIdInput,
  type KindDef,
  type KindStyle,
  type KindTemplate,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { AddKindForm } from "./AddKindForm";
import { KindStyleFields } from "./KindStyleFields";
import {
  kindRenameIssue,
  kindSpeakerNote,
  templateMissingKinds,
} from "../prayerEdit";

export type PrayerKindsPanelProps = {
  prayer: Prayer;
  /** Every kind the library knows: add suggestions and rename collisions. */
  libraryKinds: string[];
  templates: readonly KindTemplate[];
  resolved: StyleMap;
  libraryEnabled: boolean;
  /** Patch one kind's library style (applied to the latest styles.json). */
  onPatchStyle: (kind: string, partial: Partial<KindStyle>) => void;
  onAddKind: (def: KindDef) => void;
  onRemoveKind: (kind: string) => void;
  onRenameKind: (from: string, to: string) => void;
  onSetKindSpeaker: (kind: string, allowed: boolean) => void;
  onApplyTemplate: (templateId: string) => void;
};

/**
 * Prayer settings → Kinds: the built-in kinds plus this prayer's declared
 * custom kinds (picker order). Add / delete / speaker flag are per prayer
 * (undoable); rename and styles are library-wide.
 */
export function PrayerKindsPanel({
  prayer,
  libraryKinds,
  templates,
  resolved,
  libraryEnabled,
  onPatchStyle,
  onAddKind,
  onRemoveKind,
  onRenameKind,
  onSetKindSpeaker,
  onApplyTemplate,
}: PrayerKindsPanelProps) {
  const kinds = pickerKinds(prayer);
  const defs = prayer.kinds ?? [];
  const [openedKind, setOpenedKind] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // A rename must not collide with any kind anywhere in the library.
  const existing = new Set([...kinds, ...libraryKinds]);

  const openKind = (kind: string | null) => {
    setOpenedKind(kind);
    setRenameDraft(kind ?? "");
  };

  const commitRename = (kind: string) => {
    const next = renameDraft.trim();
    const issue = kindRenameIssue(kind, renameDraft, existing);
    if (issue || !next || next === kind) {
      setRenameDraft(kind);
      return;
    }
    onRenameKind(kind, next);
    setOpenedKind(next);
    setRenameDraft(next);
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text size="xs" c="dimmed">
          Kinds this prayer offers. Custom kinds are saved in the prayer;
          styles apply library-wide.
        </Text>
        <Menu position="bottom-end" withinPortal={false}>
          <Menu.Target>
            <Button
              size="compact-xs"
              variant="default"
              leftSection={<IconTemplate size={12} />}
              rightSection={<IconChevronDown size={12} />}
              disabled={templates.length === 0}
              title={
                templates.length === 0
                  ? "Create kind templates in Library settings"
                  : "Add a template's kinds to this prayer"
              }
              style={{ flexShrink: 0 }}
            >
              Apply template
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {templates.map((t) => {
              const missing = templateMissingKinds(prayer.kinds, t);
              return (
                <Menu.Item
                  key={t.id}
                  disabled={missing.length === 0}
                  onClick={() => onApplyTemplate(t.id)}
                >
                  <Text size="sm">{t.label}</Text>
                  <Text size="xs" c="dimmed">
                    {missing.length === 0
                      ? "All kinds already in this prayer"
                      : `Adds ${missing.join(", ")}`}
                  </Text>
                </Menu.Item>
              );
            })}
          </Menu.Dropdown>
        </Menu>
      </Group>

      <Accordion
        className="settings-accordion"
        variant="separated"
        radius="md"
        value={openedKind}
        onChange={openKind}
      >
        {kinds.map((kind) => {
          const preset = isKindPreset(kind);
          const def = defs.find((k) => k.id === kind);
          const speakerNote = kindSpeakerNote(kind);
          return (
            <Accordion.Item key={kind} value={kind}>
              <Group wrap="nowrap" gap={0} align="stretch">
                <Accordion.Control style={{ flex: 1 }}>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={600}>
                      {kindDisplayLabel(kind)}
                    </Text>
                    {preset ? (
                      <Text size="xs" c="dimmed">
                        built-in
                      </Text>
                    ) : def?.speaker ? (
                      <Text size="xs" c="dimmed">
                        speakers
                      </Text>
                    ) : null}
                  </Group>
                </Accordion.Control>
                {!preset ? (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="accent"
                    leftSection={<IconTrash size={12} />}
                    title="Delete from this prayer (blocks become verse)"
                    onClick={() => {
                      if (openedKind === kind) setOpenedKind(null);
                      onRemoveKind(kind);
                    }}
                    style={{ alignSelf: "center", marginRight: 8 }}
                  >
                    Delete
                  </Button>
                ) : null}
              </Group>
              <Accordion.Panel>
                <Stack gap="sm">
                  {!preset ? (
                    <TextInput
                      label="Kind"
                      description="Renaming applies to every prayer and template in the library"
                      value={openedKind === kind ? renameDraft : kind}
                      onChange={(e) =>
                        setRenameDraft(sanitizeKindIdInput(e.currentTarget.value))
                      }
                      onBlur={() => commitRename(kind)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      error={
                        openedKind === kind
                          ? (kindRenameIssue(kind, renameDraft, existing) ?? undefined)
                          : undefined
                      }
                    />
                  ) : null}
                  {speakerNote ? (
                    <Text size="xs" c="dimmed">
                      {speakerNote}
                    </Text>
                  ) : (
                    <Switch
                      label="Speakers"
                      description="Blocks of this kind can have a Speaker (this prayer)"
                      checked={def?.speaker === true}
                      onChange={(e) =>
                        onSetKindSpeaker(kind, e.currentTarget.checked)
                      }
                    />
                  )}
                  {libraryEnabled ? (
                    <>
                      <Text size="xs" fw={600} mt={4}>
                        Library style
                      </Text>
                      <KindStyleFields
                        style={resolved[kind] ?? FALLBACK_KIND_STYLE}
                        onChange={(partial) => onPatchStyle(kind, partial)}
                      />
                    </>
                  ) : null}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>

      <AddKindForm
        listed={defs}
        libraryKinds={libraryKinds}
        onAdd={(def) => {
          onAddKind(def);
          openKind(def.id);
        }}
      />
    </Stack>
  );
}
