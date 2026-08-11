import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Popover,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  IconCheck,
  IconDots,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import {
  FALLBACK_KIND_STYLE,
  KIND_PRESETS,
  type KindStyle,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { ConfirmDialog } from "./ConfirmDialog";
import { KindStyleFields } from "./KindStyleFields";

type StyleEditing = {
  resolved: StyleMap;
  appStyles: StyleMap;
  libraryStyles: StyleMap;
  target: "app" | "library";
  onTargetChange: (t: "app" | "library") => void;
  libraryEnabled: boolean;
  onChangeApp: (next: StyleMap) => void;
  onChangeLibrary: (next: StyleMap) => void;
};

type Props = {
  value: string;
  options: string[];
  onChange: (kind: string) => void;
  onRename?: (from: string, to: string) => void;
  onDelete?: (kind: string) => void;
  styleEditing?: StyleEditing;
  compact?: boolean;
  onOpenChange?: (opened: boolean) => void;
  /** Open the popover on mount (shared single-instance usage). */
  defaultOpen?: boolean;
  /** Fired when popover and edit modal are both closed. */
  onIdle?: () => void;
};

/** Presets first (stable order), custom kinds at the bottom. */
function orderKinds(options: string[]): string[] {
  const unique = [...new Set(options)];
  const presetSet = new Set<string>(KIND_PRESETS);
  const presets = KIND_PRESETS.filter((k) => unique.includes(k));
  const custom = unique
    .filter((k) => !presetSet.has(k))
    .sort((a, b) => a.localeCompare(b));
  return [...presets, ...custom];
}

function styleForKind(kind: string, editing: StyleEditing): KindStyle {
  const stored =
    editing.target === "app"
      ? editing.appStyles[kind]
      : editing.libraryStyles[kind];
  return stored ?? editing.resolved[kind] ?? FALLBACK_KIND_STYLE;
}

export function kindTriggerStyle(compact: boolean): CSSProperties {
  return {
    border: compact ? "none" : "1px solid var(--opt-border-strong)",
    borderRadius: 6,
    padding: compact ? "2px 6px" : "6px 10px",
    background: compact ? "var(--opt-hover)" : "var(--opt-surface-solid)",
    width: "auto",
    fontSize: compact ? 11 : 13,
    color: "var(--opt-text-secondary)",
    fontWeight: 550,
  };
}

/** Lightweight kind label button — used when the full KindSelect is not mounted. */
export function KindTrigger({
  value,
  compact = false,
  onClick,
}: {
  value: string;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onClick}
      className="option-row"
      style={kindTriggerStyle(compact)}
    >
      {value}
    </UnstyledButton>
  );
}

export function KindSelect({
  value,
  options,
  onChange,
  onRename,
  onDelete,
  styleEditing,
  compact = false,
  onOpenChange,
  defaultOpen = false,
  onIdle,
}: Props) {
  const [opened, setOpened] = useState(defaultOpen);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState("");
  const [editingKind, setEditingKind] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [tab, setTab] = useState<string | null>("name");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const idleArmedRef = useRef(defaultOpen || false);

  const all = orderKinds(options);
  const canEdit = Boolean(onRename || styleEditing || onDelete);

  const setOpen = (o: boolean) => {
    setOpened(o);
    onOpenChange?.(o);
    if (!o) setAdding(false);
  };

  useEffect(() => {
    if (opened || editingKind !== null) {
      idleArmedRef.current = true;
      return;
    }
    if (!idleArmedRef.current) return;
    idleArmedRef.current = false;
    onIdleRef.current?.();
  }, [opened, editingKind]);

  const commitAdd = () => {
    const next = newKind.trim();
    if (!next) return;
    onChange(next);
    setNewKind("");
    setAdding(false);
    setOpen(false);
  };

  const openEdit = (kind: string) => {
    setOpen(false);
    setEditingKind(kind);
    setRenameTo(kind);
    setTab("name");
    setConfirmDelete(false);
  };

  const closeEdit = () => {
    setEditingKind(null);
    setConfirmDelete(false);
  };

  const commitRename = () => {
    if (!editingKind || !onRename) return;
    const next = renameTo.trim();
    if (!next || next === editingKind) {
      closeEdit();
      return;
    }
    onRename(editingKind, next);
    closeEdit();
  };

  const patchStyle = (partial: Partial<KindStyle>) => {
    if (!editingKind || !styleEditing) return;
    const current = styleForKind(editingKind, styleEditing);
    const nextStyle: KindStyle = {
      ...current,
      ...partial,
      fontSize: partial.fontSize ?? current.fontSize,
      color: partial.color ?? current.color,
      fontWeight: partial.fontWeight ?? current.fontWeight,
      fontStyle: partial.fontStyle ?? current.fontStyle,
    };
    if (!nextStyle.htmlTag) {
      delete nextStyle.htmlTag;
    }
    if (styleEditing.target === "app") {
      styleEditing.onChangeApp({
        ...styleEditing.appStyles,
        [editingKind]: nextStyle,
      });
    } else {
      styleEditing.onChangeLibrary({
        ...styleEditing.libraryStyles,
        [editingKind]: nextStyle,
      });
    }
  };

  const currentStyle =
    editingKind && styleEditing
      ? styleForKind(editingKind, styleEditing)
      : null;

  return (
    <>
      <Popover
        opened={opened}
        onChange={setOpen}
        position="bottom-start"
        width={220}
        withinPortal
      >
        <Popover.Target>
          <UnstyledButton
            onClick={() => setOpen(!opened)}
            className="option-row"
            style={kindTriggerStyle(compact)}
          >
            {value}
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown p={6}>
          <Stack gap={2}>
            {all.map((kind) => {
              const active = kind === value;
              return (
                <Group key={kind} gap={4} wrap="nowrap">
                  <UnstyledButton
                    className="option-row"
                    data-active={active}
                    style={{ flex: 1 }}
                    onClick={() => {
                      onChange(kind);
                      setOpen(false);
                    }}
                  >
                    <Text size="sm" style={{ flex: 1 }}>
                      {kind}
                    </Text>
                    {active ? <IconCheck size={14} /> : null}
                  </UnstyledButton>
                  {canEdit ? (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(kind);
                      }}
                      aria-label={`Edit kind ${kind}`}
                    >
                      <IconDots size={14} />
                    </ActionIcon>
                  ) : null}
                </Group>
              );
            })}

            {adding ? (
              <Group gap={4} mt={4}>
                <TextInput
                  size="xs"
                  placeholder="new-kind"
                  value={newKind}
                  onChange={(e) => setNewKind(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitAdd();
                    if (e.key === "Escape") setAdding(false);
                  }}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <Button size="xs" onClick={commitAdd}>
                  Add
                </Button>
              </Group>
            ) : (
              <Button
                variant="subtle"
                size="xs"
                justify="flex-start"
                leftSection={<IconPlus size={14} />}
                onClick={() => setAdding(true)}
                mt={4}
              >
                Add kind…
              </Button>
            )}
          </Stack>
        </Popover.Dropdown>
      </Popover>

      <Modal
        opened={editingKind !== null}
        onClose={closeEdit}
        title={editingKind ? `Edit kind “${editingKind}”` : "Edit kind"}
        size="sm"
        centered
      >
        <Tabs value={tab} onChange={setTab}>
          <Tabs.List mb="sm">
            {onRename ? <Tabs.Tab value="name">Name</Tabs.Tab> : null}
            {styleEditing ? <Tabs.Tab value="style">Style</Tabs.Tab> : null}
          </Tabs.List>

          {onRename ? (
            <Tabs.Panel value="name">
              <Stack gap="sm">
                <Text size="sm" c="dimmed">
                  Renames this kind across the current prayer.
                </Text>
                <TextInput
                  label="Kind"
                  value={renameTo}
                  onChange={(e) => setRenameTo(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                  }}
                  data-autofocus
                />
                <Group justify="space-between">
                  {onDelete ? (
                    <Button
                      variant="subtle"
                      color="accent"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Group gap="xs">
                    <Button variant="default" onClick={closeEdit}>
                      Cancel
                    </Button>
                    <Button
                      onClick={commitRename}
                      disabled={!renameTo.trim()}
                    >
                      Save
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </Tabs.Panel>
          ) : null}

          {styleEditing && currentStyle ? (
            <Tabs.Panel value="style">
              <Stack gap="sm">
                <Text size="xs" c="dimmed">
                  Styles apply to this kind only. Library overrides win over
                  app defaults.
                </Text>
                <KindStyleFields
                  style={currentStyle}
                  onChange={patchStyle}
                  leading={
                    <Select
                      label="Apply to"
                      data={[
                        { value: "app", label: "App defaults" },
                        {
                          value: "library",
                          label: "Library override",
                          disabled: !styleEditing.libraryEnabled,
                        },
                      ]}
                      value={styleEditing.target}
                      allowDeselect={false}
                      onChange={(v) => {
                        if (v === "app" || v === "library") {
                          styleEditing.onTargetChange(v);
                        }
                      }}
                    />
                  }
                />
                <Group justify="space-between" mt="xs">
                  {onDelete ? (
                    <Button
                      variant="subtle"
                      color="accent"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button onClick={closeEdit}>Done</Button>
                </Group>
              </Stack>
            </Tabs.Panel>
          ) : null}
        </Tabs>
      </Modal>

      <ConfirmDialog
        opened={confirmDelete && editingKind !== null}
        onClose={() => setConfirmDelete(false)}
        title="Delete kind?"
        message={
          editingKind === "verse"
            ? `Delete “${editingKind}”? Blocks using it become annotation. Style overrides for this kind are removed.`
            : `Delete “${editingKind ?? ""}”? Blocks using it become verse. Style overrides for this kind are removed.`
        }
        onConfirm={() => {
          if (!editingKind || !onDelete) return;
          onDelete(editingKind);
          closeEdit();
        }}
      />
    </>
  );
}
