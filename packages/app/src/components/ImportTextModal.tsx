import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import type { StartImportInput } from "../importDraft/useImportDraft";
import { parseVariantKey, variantKey, type ActiveVariant } from "../variant";

type Props = {
  opened: boolean;
  /** Variants known in the library, for the language picker. */
  variants: ActiveVariant[];
  defaultVariant: ActiveVariant | null;
  onClose: () => void;
  onCreate: (input: StartImportInput) => void;
};

/** "Import prayer": paste text, say where it is from and in which Variant. */
export function ImportTextModal({
  opened,
  variants,
  defaultVariant,
  onClose,
  onCreate,
}: Props) {
  const [text, setText] = useState("");
  const [origin, setOrigin] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [lang, setLang] = useState("");
  const [edition, setEdition] = useState("standard");

  useEffect(() => {
    if (!opened) return;
    setText("");
    setOrigin("");
    const fallback = defaultVariant ?? variants[0] ?? null;
    setPicked(fallback ? variantKey(fallback) : null);
  }, [opened, defaultVariant, variants]);

  const chosen: ActiveVariant | null =
    variants.length > 0
      ? (picked ? parseVariantKey(picked) : null)
      : lang.trim() && edition.trim()
        ? { lang: lang.trim(), variant: edition.trim() }
        : null;
  const ready = text.trim().length > 0 && chosen !== null;

  return (
    <Modal opened={opened} onClose={onClose} title="Import prayer" size="lg" centered>
      <Stack gap="md">
        <Text size="xs" c="dimmed">
          Paste the text. Paragraphs (separated by blank lines) become blocks.
        </Text>
        <Textarea
          aria-label="Text"
          placeholder="Paste text here"
          autosize
          minRows={8}
          maxRows={16}
          value={text}
          data-autofocus
          onChange={(e) => setText(e.currentTarget.value)}
        />
        <Group grow align="flex-start">
          <TextInput
            label="Source"
            placeholder="Website, book, edition …"
            value={origin}
            onChange={(e) => setOrigin(e.currentTarget.value)}
          />
          {variants.length > 0 ? (
            <Select
              label="Language"
              data={variants.map((v) => ({
                value: variantKey(v),
                label: `${v.lang} / ${v.variant}`,
              }))}
              value={picked}
              allowDeselect={false}
              searchable
              onChange={setPicked}
            />
          ) : (
            <Group grow gap="xs">
              <TextInput
                label="Language code"
                placeholder="de"
                value={lang}
                onChange={(e) => setLang(e.currentTarget.value)}
              />
              <TextInput
                label="Edition"
                value={edition}
                onChange={(e) => setEdition(e.currentTarget.value)}
              />
            </Group>
          )}
        </Group>
        <Group justify="flex-end" gap="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="dark"
            disabled={!ready}
            onClick={() => {
              if (!chosen) return;
              onCreate({ text, origin, variant: chosen });
            }}
          >
            Create draft
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
