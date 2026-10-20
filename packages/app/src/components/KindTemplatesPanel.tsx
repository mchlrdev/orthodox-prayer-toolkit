import { useEffect, useState } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Button,
  Group,
  List,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  addTemplateKind,
  moveTemplateKind,
  removeTemplateKind,
  setTemplateKindSpeaker,
  templateIdFromLabel,
  type KindTemplate,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";
import type { TemplateEdit } from "../session";
import { AddKindForm } from "./AddKindForm";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = {
  templates: readonly KindTemplate[];
  templateErrors: readonly ValidationError[];
  /** Every kind the library knows: offered when adding a kind. */
  libraryKinds: string[];
  onCreate: (input: { label: string }) => Promise<string | null>;
  /** Edits are functions of the template as it is when the write runs. */
  onUpdate: (id: string, edit: TemplateEdit) => void;
  onDelete: (id: string) => void;
};

/** Label field that saves on blur / Enter (each save writes templates.json). */
function TemplateLabelInput({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (label: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const empty = draft.trim() === "";
  return (
    <TextInput
      label="Label"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => {
        if (empty || draft.trim() === value) setDraft(value);
        else onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      error={empty ? "Required" : undefined}
    />
  );
}

/**
 * Library settings → Kind templates (`templates.json`). A template is a
 * stamp: new prayers copy its kinds; editing it never touches existing
 * prayers. Read-only while the file has errors (rewriting would lose data).
 */
export function KindTemplatesPanel({
  templates,
  templateErrors,
  libraryKinds,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const locked = templateErrors.length > 0;
  const [opened, setOpened] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<KindTemplate | null>(null);

  const newId = newLabel.trim()
    ? templateIdFromLabel(newLabel, templates.map((t) => t.id))
    : null;

  const create = async () => {
    const label = newLabel.trim();
    if (!label || locked) return;
    setCreating(true);
    try {
      const id = await onCreate({ label });
      if (id) {
        setNewLabel("");
        setOpened(id);
      }
    } finally {
      setCreating(false);
    }
  };

  const edit = (id: string, fn: (t: KindTemplate) => KindTemplate) =>
    onUpdate(id, fn);

  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed">
        A kind template is a set of custom kinds for new prayers. Creating a
        prayer with it copies the kinds; later edits here never change existing
        prayers. Use “Apply template” in Prayer settings → Kinds to add a
        template’s kinds to an existing prayer.
      </Text>

      {locked ? (
        <Alert
          color="accent"
          variant="light"
          icon={<IconAlertTriangle size={16} />}
          title="templates.json has errors"
        >
          <Stack gap={4}>
            <Text size="xs">
              Templates are read-only until the file is fixed (saving now
              would drop the entries the app cannot read). Valid templates can
              still be used for new prayers.
            </Text>
            <List size="xs" spacing={2}>
              {templateErrors.slice(0, 8).map((e) => (
                <List.Item key={`${e.path}:${e.message}`}>
                  <Text size="xs" ff="monospace" span>
                    {e.path}
                  </Text>{" "}
                  {e.message}
                </List.Item>
              ))}
            </List>
          </Stack>
        </Alert>
      ) : null}

      {templates.length === 0 ? (
        <Text size="sm" c="dimmed">
          No kind templates yet.
        </Text>
      ) : (
        <Accordion
          className="settings-accordion"
          variant="separated"
          radius="md"
          value={opened}
          onChange={setOpened}
        >
          {templates.map((template) => (
            <Accordion.Item key={template.id} value={template.id}>
              <Group wrap="nowrap" gap={0} align="stretch">
                <Accordion.Control style={{ flex: 1 }}>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={600}>
                      {template.label}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {template.kinds.length === 1
                        ? "1 kind"
                        : `${template.kinds.length} kinds`}
                    </Text>
                  </Group>
                </Accordion.Control>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="accent"
                  leftSection={<IconTrash size={12} />}
                  disabled={locked}
                  onClick={() => setConfirmDelete(template)}
                  style={{ alignSelf: "center", marginRight: 8 }}
                >
                  Delete
                </Button>
              </Group>
              <Accordion.Panel>
                <Stack gap="sm">
                  <TemplateLabelInput
                    value={template.label}
                    disabled={locked}
                    onCommit={(label) => onUpdate(template.id, { label })}
                  />
                  <Text size="xs" c="dimmed">
                    Id: {template.id}
                  </Text>
                  <Stack gap={4}>
                    <Text size="sm" fw={500}>
                      Kinds
                    </Text>
                    {template.kinds.length === 0 ? (
                      <Text size="xs" c="dimmed">
                        No kinds yet — new prayers get the built-in kinds only.
                      </Text>
                    ) : (
                      template.kinds.map((def, i) => (
                        <Group key={def.id} gap="xs" wrap="nowrap">
                          <Text size="sm" style={{ flex: 1 }} truncate>
                            {def.id}
                          </Text>
                          <Switch
                            size="xs"
                            label="Speakers"
                            checked={def.speaker === true}
                            disabled={locked}
                            onChange={(e) => {
                              const allowed = e.currentTarget.checked;
                              edit(template.id, (t) =>
                                setTemplateKindSpeaker(t, def.id, allowed),
                              );
                            }}
                          />
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            disabled={locked || i === 0}
                            aria-label={`Move ${def.id} up`}
                            onClick={() =>
                              edit(template.id, (t) => moveTemplateKind(t, def.id, -1))
                            }
                          >
                            <IconArrowUp size={14} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            disabled={locked || i === template.kinds.length - 1}
                            aria-label={`Move ${def.id} down`}
                            onClick={() =>
                              edit(template.id, (t) => moveTemplateKind(t, def.id, 1))
                            }
                          >
                            <IconArrowDown size={14} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="accent"
                            size="sm"
                            disabled={locked}
                            aria-label={`Remove ${def.id} from template`}
                            onClick={() =>
                              edit(
                                template.id,
                                (t) => removeTemplateKind([t], def.id)[0]!,
                              )
                            }
                          >
                            <IconX size={14} />
                          </ActionIcon>
                        </Group>
                      ))
                    )}
                  </Stack>
                  <AddKindForm
                    listed={template.kinds}
                    libraryKinds={libraryKinds}
                    disabled={locked}
                    onAdd={(def) => edit(template.id, (t) => addTemplateKind(t, def))}
                  />
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}

      <Group gap="xs" align="flex-end" wrap="nowrap">
        <TextInput
          size="xs"
          style={{ flex: 1 }}
          label="New template"
          placeholder="Label, e.g. Hymns"
          value={newLabel}
          disabled={locked}
          description={newId ? `Id: ${newId}` : undefined}
          onChange={(e) => setNewLabel(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void create();
            }
          }}
        />
        <Button
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={() => void create()}
          loading={creating}
          disabled={locked || !newLabel.trim()}
        >
          Create
        </Button>
      </Group>

      <ConfirmDialog
        opened={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        zIndex={400}
        title="Delete template?"
        message={`Delete the kind template “${confirmDelete?.label ?? ""}”? Prayers created with it keep their kinds.`}
        onConfirm={() => {
          if (confirmDelete) onDelete(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </Stack>
  );
}
