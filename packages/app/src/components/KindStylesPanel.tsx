import { useState } from "react";
import { Accordion, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import {
  FALLBACK_KIND_STYLE,
  isKindPreset,
  isValidKindId,
  kindDisplayLabel,
  sanitizeKindIdInput,
  type KindStyle,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { KindStyleFields } from "./KindStyleFields";
import { kindRenameIssue, orderKinds, ensureKindStyle } from "../prayerEdit";

export type KindStylesPanelProps = {
  kinds: string[];
  resolved: StyleMap;
  libraryStyles: StyleMap;
  libraryEnabled: boolean;
  onChangeLibrary: (next: StyleMap) => void;
  onRemoveKind: (kind: string) => void;
  onRenameKind: (from: string, to: string) => void;
};

export function KindStylesPanel({
  kinds,
  resolved,
  libraryStyles,
  libraryEnabled,
  onChangeLibrary,
  onRemoveKind,
  onRenameKind,
}: KindStylesPanelProps) {
  const ordered = orderKinds(kinds);
  const [openedKind, setOpenedKind] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState("");
  const [renameDraft, setRenameDraft] = useState("");

  const existing = new Set(ordered);

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

  const patch = (kind: string, partial: Partial<KindStyle>) => {
    const current = resolved[kind] ?? FALLBACK_KIND_STYLE;
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
    onChangeLibrary({ ...libraryStyles, [kind]: nextStyle });
  };

  const commitAdd = () => {
    const id = sanitizeKindIdInput(newKind);
    if (!isValidKindId(id) || existing.has(id)) return;
    const style = resolved[id] ?? { ...FALLBACK_KIND_STYLE };
    onChangeLibrary(ensureKindStyle(libraryStyles, id, style));
    setNewKind("");
    setAdding(false);
    setOpenedKind(id);
    setRenameDraft(id);
  };

  if (!libraryEnabled) {
    return (
      <Text size="sm" c="dimmed">
        Open a library to edit kind styles.
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      <Accordion
        variant="separated"
        radius="md"
        value={openedKind}
        onChange={openKind}
      >
        {ordered.map((kind) => {
          const current = resolved[kind] ?? FALLBACK_KIND_STYLE;
          const preset = isKindPreset(kind);
          return (
            <Accordion.Item key={kind} value={kind}>
              <Group wrap="nowrap" gap={0} align="stretch">
                <Accordion.Control style={{ flex: 1 }}>
                  <Text size="sm" fw={600}>
                    {kindDisplayLabel(kind)}
                  </Text>
                </Accordion.Control>
                {!preset ? (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="accent"
                    leftSection={<IconTrash size={12} />}
                    onClick={() => {
                      if (openedKind === kind) setOpenedKind(null);
                      onRemoveKind(kind);
                    }}
                    style={{ alignSelf: "center", marginRight: 8 }}
                  >
                    Remove
                  </Button>
                ) : null}
              </Group>
              <Accordion.Panel>
                <Stack gap="sm">
                  {!preset ? (
                    <TextInput
                      label="Kind"
                      value={openedKind === kind ? renameDraft : kind}
                      onChange={(e) =>
                        setRenameDraft(sanitizeKindIdInput(e.currentTarget.value))
                      }
                      onBlur={() => commitRename(kind)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                      error={
                        openedKind === kind
                          ? (kindRenameIssue(kind, renameDraft, existing) ??
                            undefined)
                          : undefined
                      }
                    />
                  ) : null}
                  <KindStyleFields
                    style={current}
                    onChange={(partial) => patch(kind, partial)}
                  />
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>

      {adding ? (
        <Group gap="xs" wrap="nowrap">
          <TextInput
            size="xs"
            placeholder="new-kind"
            value={newKind}
            onChange={(e) =>
              setNewKind(sanitizeKindIdInput(e.currentTarget.value))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAdd();
              if (e.key === "Escape") {
                setAdding(false);
                setNewKind("");
              }
            }}
            error={
              newKind.trim() && existing.has(newKind.trim())
                ? "Already exists"
                : undefined
            }
            style={{ flex: 1 }}
            autoFocus
          />
          <Button
            size="xs"
            onClick={commitAdd}
            disabled={!newKind.trim() || existing.has(newKind.trim())}
          >
            Add
          </Button>
        </Group>
      ) : (
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={() => setAdding(true)}
          style={{ alignSelf: "flex-start" }}
        >
          Add kind
        </Button>
      )}
    </Stack>
  );
}
