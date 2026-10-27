import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Modal,
  NumberInput,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  freePrayerId,
  prayerIdFromTitle,
  type DraftPrayerMeta,
  type DraftVariant,
  type ImportDraft,
} from "@orthodox-prayer-toolkit/core";

export type ImportSaveInput = {
  meta: Partial<DraftPrayerMeta>;
  variant: Pick<DraftVariant, "title" | "license" | "source">;
};

type Props = {
  opened: boolean;
  draft: ImportDraft;
  blockCount: number;
  takenIds: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  onSave: (input: ImportSaveInput) => void;
};

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Title, file name and metadata; refuses an id the library already has. */
export function ImportSaveModal({
  opened,
  draft,
  blockCount,
  takenIds,
  busy,
  onClose,
  onSave,
}: Props) {
  const variant = draft.variants[0]!;
  const [title, setTitle] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [type, setType] = useState("");
  const [tone, setTone] = useState<number | null>(null);
  const [book, setBook] = useState("");
  const [occasion, setOccasion] = useState("");
  const [license, setLicense] = useState("");
  const [source, setSource] = useState("");

  useEffect(() => {
    if (!opened) return;
    setTitle(variant.title);
    setId(draft.meta.id);
    setIdTouched(draft.meta.id !== "");
    setType(draft.meta.type || "prayer");
    setTone(draft.meta.tone ?? null);
    setBook(draft.meta.book ?? "");
    setOccasion(draft.meta.occasion ?? "");
    setLicense(variant.license);
    setSource(variant.source);
    // Fill once per opening; later draft changes are this dialog's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);

  const fileId = idTouched ? id : prayerIdFromTitle(title);
  const taken = fileId !== "" && takenIds.has(fileId);
  const idError =
    fileId === ""
      ? null
      : !ID_PATTERN.test(fileId)
        ? "Lowercase letters, digits and single hyphens only."
        : taken
          ? "Already in the library. Nothing is overwritten."
          : null;
  const ready =
    title.trim() !== "" &&
    fileId !== "" &&
    idError === null &&
    type.trim() !== "" &&
    license.trim() !== "" &&
    source.trim() !== "";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Save to library"
      size="lg"
      centered
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <Stack gap="md">
        <Text size="xs" c="dimmed">
          {blockCount} {blockCount === 1 ? "block" : "blocks"} · {variant.lang} /{" "}
          {variant.variant}
        </Text>
        <TextInput
          label={`Title · ${variant.lang}`}
          value={title}
          data-autofocus
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <Stack gap={6}>
          <TextInput
            label="File name"
            value={fileId}
            rightSection={<Text size="sm" c="dimmed">.json</Text>}
            rightSectionWidth={48}
            error={idError ? true : undefined}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.currentTarget.value);
            }}
          />
          {idError ? (
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Text size="xs" c="accent">
                {idError}
              </Text>
              {taken ? (
                <UnstyledButton
                  className="import-id-suggestion"
                  onClick={() => {
                    setIdTouched(true);
                    setId(freePrayerId(fileId, takenIds));
                  }}
                >
                  Use {freePrayerId(fileId, takenIds)}
                </UnstyledButton>
              ) : null}
            </Group>
          ) : null}
        </Stack>
        <Group grow align="flex-start">
          <TextInput
            label="Type"
            description="e.g. prayer, troparion"
            value={type}
            onChange={(e) => setType(e.currentTarget.value)}
          />
          <NumberInput
            label="Tone"
            description="1–8, optional"
            min={1}
            max={8}
            allowDecimal={false}
            hideControls
            value={tone ?? ""}
            onChange={(v) => setTone(typeof v === "number" ? v : null)}
          />
        </Group>
        <Group grow>
          <TextInput
            label="Book"
            placeholder="horologion, menaion…"
            value={book}
            onChange={(e) => setBook(e.currentTarget.value)}
          />
          <TextInput
            label="Occasion"
            placeholder="Optional"
            value={occasion}
            onChange={(e) => setOccasion(e.currentTarget.value)}
          />
        </Group>
        <Group grow>
          <TextInput
            label="License"
            value={license}
            onChange={(e) => setLicense(e.currentTarget.value)}
          />
          <TextInput
            label="Source"
            value={source}
            onChange={(e) => setSource(e.currentTarget.value)}
          />
        </Group>
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" color="gray" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            color="dark"
            loading={busy}
            disabled={!ready}
            onClick={() =>
              onSave({
                meta: {
                  id: fileId,
                  type: type.trim(),
                  tone: tone ?? undefined,
                  book: book.trim(),
                  occasion: occasion.trim(),
                },
                variant: {
                  title: title.trim(),
                  license: license.trim(),
                  source: source.trim(),
                },
              })
            }
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
