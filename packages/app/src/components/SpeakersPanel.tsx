import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  Accordion,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useClickOutside } from "@mantine/hooks";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import {
  removeSpeaker,
  resolveSpeakerLabel,
  sanitizeSpeakerIdInput,
  setSpeakerLabel,
  speakerChipLabel,
  speakerDisplayLabel,
  type Prayer,
  type VariantMeta,
} from "@orthodox-prayer-toolkit/core";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  addCustomSpeaker,
  commitSpeakerRename,
  speakerAddIssue,
  speakerPaneRows,
  speakerRenameIssue,
} from "../prayerEdit";

type Props = {
  prayer: Prayer;
  onChange: (prayer: Prayer, options?: { coalesceKey?: string }) => void;
};

function blockCountLabel(count: number): string {
  if (count === 0) return "Not used";
  return count === 1 ? "1 block" : `${count} blocks`;
}

/**
 * Text field that keeps what is typed (spaces included) while Core trims the
 * stored value; re-syncs from the prayer when not focused (undo, other edits).
 */
function LabelInput({
  value,
  onCommit,
  ...rest
}: {
  value: string;
  onCommit: (raw: string) => void;
  placeholder: string;
  "aria-label": string;
  label?: string;
  className?: string;
  title?: string;
  w?: number;
  style?: CSSProperties;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return (
    <TextInput
      size="xs"
      {...rest}
      value={draft}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setDraft(value);
      }}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        setDraft(raw);
        onCommit(raw);
      }}
    />
  );
}

/**
 * Prayer settings → Speakers: same Accordion pattern as Kinds / Languages.
 * Built-in speakers are always listed (fixed id, labels editable); custom
 * ones can be renamed and removed.
 */
export function SpeakersPanel({ prayer, onChange }: Props) {
  // Custom speakers seen while the pane is open stay listed, so clearing the
  // only label of an unused speaker does not pull its fields away mid-typing.
  const [kept, setKept] = useState<string[]>([]);
  const rows = speakerPaneRows(prayer, kept);
  const customKey = rows
    .filter((s) => !s.preset)
    .map((s) => s.id)
    .join("\0");
  useEffect(() => {
    const ids = customKey ? customKey.split("\0") : [];
    setKept((prev) => {
      const extra = ids.filter((id) => !prev.includes(id));
      return extra.length > 0 ? [...prev, ...extra] : prev;
    });
  }, [customKey]);

  const ids = rows.map((s) => s.id);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const firstVariant = prayer.variants[0];
  const chipAt = firstVariant ?? { lang: "", variant: "" };

  const openItem = (id: string | null) => {
    setOpenedId(id);
    setRenameDraft(id ?? "");
    setRenameError(null);
  };

  const commitRename = (id: string) => {
    const result = commitSpeakerRename(prayer, id, renameDraft);
    if (!result.ok) {
      setRenameError(result.issue);
      return;
    }
    setRenameError(null);
    if (result.id === id) {
      setRenameDraft(id);
      return;
    }
    setKept((prev) => prev.map((x) => (x === id ? result.id : x)));
    onChange(result.prayer);
    setOpenedId(result.id);
    setRenameDraft(result.id);
  };

  const cancelAdd = useCallback(() => {
    setAdding(false);
    setNewId("");
  }, []);
  const addFormRef = useClickOutside<HTMLDivElement>(cancelAdd);
  const addIssue = speakerAddIssue(newId, ids);

  const commitAdd = () => {
    const next = addCustomSpeaker(prayer, newId, ids);
    if (!next) return;
    const id = newId.trim();
    onChange(next);
    setKept((prev) => (prev.includes(id) ? prev : [...prev, id]));
    cancelAdd();
    openItem(id);
  };

  const remove = (id: string) => {
    onChange(removeSpeaker(prayer, id));
    setKept((prev) => prev.filter((x) => x !== id));
    if (openedId === id) openItem(null);
    setConfirmId(null);
  };

  const usedIn = (id: string, v: VariantMeta) =>
    prayer.structure.some(
      (b) =>
        b.speaker === id &&
        b.translations.some(
          (tr) => tr.lang === v.lang && tr.variant === v.variant,
        ),
    );

  const confirmSummary = confirmId
    ? rows.find((s) => s.id === confirmId)
    : undefined;

  return (
    <Stack gap="sm">
      <Accordion
        className="settings-accordion"
        variant="separated"
        radius="md"
        value={openedId}
        onChange={openItem}
      >
        {rows.map((s) => {
          const preset = Boolean(s.preset);
          const name = speakerDisplayLabel(s.id);
          return (
            <Accordion.Item key={s.id} value={s.id}>
              <Group wrap="nowrap" gap={0} align="stretch">
                <Accordion.Control style={{ flex: 1 }}>
                  <Group gap={8} wrap="nowrap">
                    <span className="speaker-chip-pill">
                      {speakerChipLabel(prayer, chipAt, s.id)}
                    </span>
                    <Text size="sm" fw={600} truncate style={{ minWidth: 0 }}>
                      {name}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                      {blockCountLabel(s.blockCount)}
                    </Text>
                  </Group>
                </Accordion.Control>
                {!preset ? (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="accent"
                    leftSection={<IconTrash size={12} />}
                    aria-label={`Remove speaker ${speakerDisplayLabel(s.id)}`}
                    onClick={() => {
                      if (s.blockCount > 0) setConfirmId(s.id);
                      else remove(s.id);
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
                      label="Speaker"
                      size="xs"
                      value={openedId === s.id ? renameDraft : s.id}
                      onChange={(e) => {
                        const raw = sanitizeSpeakerIdInput(e.currentTarget.value);
                        setRenameDraft(raw);
                        setRenameError(speakerRenameIssue(prayer, s.id, raw));
                      }}
                      onBlur={() => commitRename(s.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(s.id);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setRenameDraft(s.id);
                          setRenameError(null);
                        }
                      }}
                      error={
                        openedId === s.id ? (renameError ?? undefined) : undefined
                      }
                    />
                  ) : null}
                  {prayer.variants.map((v) => {
                    const label = v.speakers?.[s.id];
                    const variantLabel = `${v.lang} / ${v.variant}`;
                    const missing = !label?.name && usedIn(s.id, v);
                    const fallbackName = speakerDisplayLabel(s.id);
                    const key = `${s.id}::${v.lang}::${v.variant}`;
                    return (
                      <div key={key} className="speaker-variant-row">
                        <Text
                          size="xs"
                          c="dimmed"
                          className="speaker-variant-label"
                          truncate
                        >
                          {variantLabel}
                        </Text>
                        <LabelInput
                          style={{ flex: 1, minWidth: 0 }}
                          className={missing ? "speaker-name-missing" : undefined}
                          title={
                            missing
                              ? `No name in ${variantLabel}; exports print “${fallbackName}”.`
                              : undefined
                          }
                          aria-label={`Name (${variantLabel})`}
                          placeholder={fallbackName}
                          value={label?.name ?? ""}
                          onCommit={(raw) =>
                            onChange(
                              setSpeakerLabel(prayer, v, s.id, { name: raw }),
                              { coalesceKey: `speaker-name:${key}` },
                            )
                          }
                        />
                        <LabelInput
                          w={64}
                          aria-label={`Short (${variantLabel})`}
                          placeholder={resolveSpeakerLabel(prayer, v, s.id, "short")}
                          value={label?.short ?? ""}
                          onCommit={(raw) =>
                            onChange(
                              setSpeakerLabel(prayer, v, s.id, { short: raw }),
                              { coalesceKey: `speaker-short:${key}` },
                            )
                          }
                        />
                      </div>
                    );
                  })}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>

      {adding ? (
        <Stack ref={addFormRef} gap="xs">
          <TextInput
            size="xs"
            placeholder="new-speaker"
            aria-label="New speaker id"
            value={newId}
            onChange={(e) =>
              setNewId(sanitizeSpeakerIdInput(e.currentTarget.value))
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
                cancelAdd();
              }
            }}
            error={addIssue ?? undefined}
            autoFocus
          />
          <Group gap="xs" wrap="nowrap">
            <Button
              size="xs"
              onClick={commitAdd}
              disabled={!newId.trim() || Boolean(addIssue)}
            >
              Add
            </Button>
            <Button size="xs" variant="default" onClick={cancelAdd}>
              Cancel
            </Button>
          </Group>
        </Stack>
      ) : (
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={() => setAdding(true)}
          disabled={!firstVariant}
          style={{ alignSelf: "flex-start" }}
        >
          Add speaker
        </Button>
      )}

      <ConfirmDialog
        opened={confirmSummary !== undefined}
        onClose={() => setConfirmId(null)}
        zIndex={400}
        title="Remove speaker?"
        message={
          confirmSummary
            ? `Remove “${speakerDisplayLabel(confirmSummary.id)}”? It is removed from ${blockCountLabel(confirmSummary.blockCount).toLowerCase()} and from every language. Undo restores it.`
            : ""
        }
        onConfirm={() => {
          if (confirmId) remove(confirmId);
        }}
      />
    </Stack>
  );
}
