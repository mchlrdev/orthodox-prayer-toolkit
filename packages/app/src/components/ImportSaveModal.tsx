import { useEffect, useState, type FormEvent } from "react";
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
import { IconChevronRight } from "@tabler/icons-react";
import { variantName } from "../languageName";

type VariantFields = Pick<DraftVariant, "title" | "license" | "source">;

export type ImportSaveInput = {
  meta: Partial<DraftPrayerMeta>;
  /** Per Variant key: each language keeps its own title, licence and source. */
  variants: Record<string, VariantFields>;
};

type Props = {
  opened: boolean;
  draft: ImportDraft;
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
  takenIds,
  busy,
  onClose,
  onSave,
}: Props) {
  const variant = draft.variants[0]!;
  const others = draft.variants.slice(1);
  const multilingual = others.length > 0;
  const [title, setTitle] = useState("");
  /** Title, licence and source of the other languages, by Variant key. */
  const [extra, setExtra] = useState<Record<string, VariantFields>>({});
  const setExtraField = (key: string, field: keyof VariantFields, value: string) =>
    setExtra((cur) => ({ ...cur, [key]: { ...cur[key]!, [field]: value } }));
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [type, setType] = useState("");
  const [tone, setTone] = useState<number | null>(null);
  const [book, setBook] = useState("");
  const [occasion, setOccasion] = useState("");
  const [license, setLicense] = useState("");
  const [source, setSource] = useState("");
  /** Save was pressed: empty required fields are marked. */
  const [attempted, setAttempted] = useState(false);
  const [details, setDetails] = useState(false);

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
    setAttempted(false);
    setDetails(false);
    setExtra(
      Object.fromEntries(
        others.map((v) => [
          v.key,
          // A language without its own licence/source starts from the first one's.
          { title: v.title, license: v.license || variant.license, source: v.source || variant.source },
        ]),
      ),
    );
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
    source.trim() !== "" &&
    others.every((v) => {
      const f = extra[v.key];
      return f !== undefined && f.title.trim() !== "" && f.license.trim() !== "" && f.source.trim() !== "";
    });

  const needed = (value: string) => (attempted && value.trim() === "" ? "Needed" : undefined);
  const nameOf = (v: DraftVariant) => variantName({ lang: v.lang, variant: v.variant });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (!ready) {
      setAttempted(true);
      if (type.trim() === "" || (fileId !== "" && idError !== null && !taken)) setDetails(true);
      return;
    }
    onSave({
      meta: {
        id: fileId,
        type: type.trim(),
        tone: tone ?? undefined,
        book: book.trim(),
        occasion: occasion.trim(),
      },
      variants: {
        [variant.key]: {
          title: title.trim(),
          license: license.trim(),
          source: source.trim(),
        },
        ...Object.fromEntries(
          others.map((v) => {
            const f = extra[v.key]!;
            return [v.key, { title: f.title.trim(), license: f.license.trim(), source: f.source.trim() }];
          }),
        ),
      },
    });
  };

  const fields = (
    v: DraftVariant,
    value: VariantFields,
    set: (field: keyof VariantFields, value: string) => void,
    first: boolean,
  ) => (
    <Stack gap="xs" key={v.key}>
      {multilingual ? (
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" className="import-save-lang">
          {nameOf(v)}
        </Text>
      ) : null}
      <TextInput
        label="Title"
        value={value.title}
        data-autofocus={first ? true : undefined}
        error={needed(value.title)}
        onChange={(e) => set("title", e.currentTarget.value)}
      />
      {first ? (
        idError ? (
          <Group justify="space-between" gap="xs" wrap="nowrap" mt={-4}>
            <Text size="xs" c="accent">
              {taken ? `${fileId}.json is already in the library.` : idError}
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
        ) : fileId ? (
          <Text size="xs" c="dimmed" mt={-4}>
            Saved as {fileId}.json
          </Text>
        ) : null
      ) : null}
      <Group grow align="flex-start">
        <TextInput
          label="From"
          placeholder="Book or website"
          value={value.source}
          error={needed(value.source)}
          onChange={(e) => set("source", e.currentTarget.value)}
        />
        <TextInput
          label="License"
          placeholder="e.g. CC BY 4.0"
          value={value.license}
          error={needed(value.license)}
          onChange={(e) => set("license", e.currentTarget.value)}
        />
      </Group>
    </Stack>
  );

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
      <form onSubmit={submit}>
        <Stack gap="md">
          {fields(variant, { title, license, source }, (field, value) => {
            if (field === "title") setTitle(value);
            else if (field === "license") setLicense(value);
            else setSource(value);
          }, true)}
          {others.map((v) =>
            fields(
              v,
              extra[v.key] ?? { title: "", license: "", source: "" },
              (field, value) => setExtraField(v.key, field, value),
              false,
            ),
          )}
          <UnstyledButton
            className="import-save-details"
            aria-expanded={details}
            onClick={() => setDetails(!details)}
          >
            <IconChevronRight size={12} stroke={2} data-open={details ? "true" : undefined} />
            More details
          </UnstyledButton>
          {details ? (
            <Stack gap="xs">
              <Group grow align="flex-start">
                <TextInput
                  label="Type"
                  placeholder="prayer, troparion …"
                  value={type}
                  error={needed(type)}
                  onChange={(e) => setType(e.currentTarget.value)}
                />
                <NumberInput
                  label="Tone"
                  placeholder="1–8"
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
                  placeholder="horologion, menaion …"
                  value={book}
                  onChange={(e) => setBook(e.currentTarget.value)}
                />
                <TextInput
                  label="Occasion"
                  value={occasion}
                  onChange={(e) => setOccasion(e.currentTarget.value)}
                />
              </Group>
              <TextInput
                label="File name"
                value={fileId}
                rightSection={<Text size="sm" c="dimmed">.json</Text>}
                rightSectionWidth={48}
                error={idError && !taken ? idError : undefined}
                onChange={(e) => {
                  setIdTouched(true);
                  setId(e.currentTarget.value);
                }}
              />
            </Stack>
          ) : null}
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button color="dark" loading={busy} type="submit">
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
