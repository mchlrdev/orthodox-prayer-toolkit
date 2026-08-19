import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Popover,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  IconCheck,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import {
  FALLBACK_KIND_STYLE,
  isKindPreset,
  isValidKindId,
  kindDisplayLabel,
  sanitizeKindIdInput,
  type KindStyle,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { ConfirmDialog } from "./ConfirmDialog";
import { KindStyleFields } from "./KindStyleFields";
import { kindRenameIssue, orderKinds, ensureKindStyle } from "../prayerEdit";

type StyleEditing = {
  resolved: StyleMap;
  appStyles: StyleMap;
  libraryStyles: StyleMap;
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

function styleForKind(kind: string, editing: StyleEditing): KindStyle {
  return (
    editing.libraryStyles[kind] ??
    editing.resolved[kind] ??
    FALLBACK_KIND_STYLE
  );
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
      {kindDisplayLabel(value)}
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const idleArmedRef = useRef(defaultOpen || false);

  const all = orderKinds(options);
  const editingPreset = editingKind !== null && isKindPreset(editingKind);
  const canRenameEditing = Boolean(onRename) && !editingPreset;
  const canDeleteEditing = Boolean(onDelete) && !editingPreset;
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
    const next = sanitizeKindIdInput(newKind);
    if (!isValidKindId(next)) return;
    if (styleEditing) {
      const styles = ensureKindStyle(
        styleEditing.libraryStyles,
        next,
        FALLBACK_KIND_STYLE,
      );
      if (styles !== styleEditing.libraryStyles) {
        styleEditing.onChangeLibrary(styles);
      }
    }
    onChange(next);
    setNewKind("");
    setAdding(false);
    setOpen(false);
  };

  const openEdit = (kind: string) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    setOpen(false);
    setEditingKind(kind);
    setRenameTo(kind);
    setConfirmDelete(false);
  };

  const closeEdit = () => {
    setEditingKind(null);
    setConfirmDelete(false);
  };

  const renameIssue =
    editingKind && canRenameEditing
      ? kindRenameIssue(editingKind, renameTo, all)
      : null;

  const finishEdit = () => {
    if (canRenameEditing && editingKind && onRename) {
      if (renameIssue) return;
      const next = renameTo.trim();
      if (next && next !== editingKind) onRename(editingKind, next);
    }
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
    styleEditing.onChangeLibrary({
      ...styleEditing.libraryStyles,
      [editingKind]: nextStyle,
    });
  };

  const currentStyle =
    editingKind && styleEditing
      ? styleForKind(editingKind, styleEditing)
      : null;

  const editingLabel = editingKind ? kindDisplayLabel(editingKind) : "";

  const editModal = (
    <Modal
      opened={editingKind !== null}
      onClose={closeEdit}
      title={editingKind ? `Edit kind “${editingLabel}”` : "Edit kind"}
      size="sm"
      centered
      trapFocus
      withinPortal={false}
      zIndex={400}
      styles={{
        content: { overflow: "visible" },
        body: { overflow: "visible" },
      }}
    >
      <Stack
        gap="sm"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {canRenameEditing ? (
          <TextInput
            label="Kind"
            value={renameTo}
            onChange={(e) =>
              setRenameTo(sanitizeKindIdInput(e.currentTarget.value))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                finishEdit();
              }
            }}
            error={renameIssue ?? undefined}
            autoFocus
          />
        ) : null}
        {styleEditing && currentStyle ? (
          <>
            <KindStyleFields
              style={currentStyle}
              onChange={patchStyle}
              portalDropdowns={false}
            />
          </>
        ) : null}
        <Group
          justify={canDeleteEditing ? "space-between" : "flex-end"}
          mt="xs"
        >
          {canDeleteEditing ? (
            <Button
              variant="subtle"
              color="accent"
              leftSection={<IconTrash size={14} />}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          ) : null}
          <Button onClick={finishEdit} disabled={Boolean(renameIssue)}>
            Done
          </Button>
        </Group>
      </Stack>
    </Modal>
  );

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
            {kindDisplayLabel(value)}
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown
          p={6}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.stopPropagation();
            }
          }}
        >
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
                      {kindDisplayLabel(kind)}
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
                      aria-label={`Edit kind ${kindDisplayLabel(kind)}`}
                    >
                      <IconPencil size={14} />
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
                  onChange={(e) =>
                    setNewKind(sanitizeKindIdInput(e.currentTarget.value))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      commitAdd();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setAdding(false);
                    }
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

      {createPortal(
        <>
          {editModal}
          <ConfirmDialog
            opened={confirmDelete && editingKind !== null && canDeleteEditing}
            onClose={() => setConfirmDelete(false)}
            zIndex={500}
            withinPortal={false}
            title="Delete kind?"
            message={
              editingKind === "verse"
                ? `Delete “${editingLabel}”? Blocks using it become annotation. Style overrides for this kind are removed.`
                : `Delete “${editingLabel}”? Blocks using it become verse. Style overrides for this kind are removed.`
            }
            onConfirm={() => {
              if (!editingKind || !onDelete || isKindPreset(editingKind)) return;
              onDelete(editingKind);
              closeEdit();
            }}
          />
        </>,
        document.body,
      )}
    </>
  );
}
