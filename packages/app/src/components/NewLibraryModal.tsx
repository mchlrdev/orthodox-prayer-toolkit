import { useEffect, useState } from "react";
import {
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  normalizeLibraryManifest,
  type LibraryManifest,
} from "@orthodox-prayer-toolkit/core";

export type NewLibraryInput = {
  name: string;
  manifest: LibraryManifest;
};

type Props = {
  opened: boolean;
  onClose: () => void;
  busy?: boolean;
  onCreate: (input: NewLibraryInput) => void | Promise<boolean>;
};

type Draft = {
  name: string;
  description: string;
  lang: string;
  variant: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  lang: "de",
  variant: "standard",
};

function toManifest(draft: Draft): LibraryManifest {
  const raw: LibraryManifest = {};
  const description = draft.description.trim();
  if (description) raw.description = description;

  const lang = draft.lang.trim();
  const variant = draft.variant.trim();
  if (lang && variant) {
    raw.defaultVariant = { lang, variant };
  }

  return normalizeLibraryManifest(raw);
}

function isValidFolderName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (/[/\\]/.test(trimmed)) return false;
  if (trimmed === "." || trimmed === "..") return false;
  return true;
}

export function NewLibraryModal({
  opened,
  onClose,
  busy = false,
  onCreate,
}: Props) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (opened) setDraft(EMPTY_DRAFT);
  }, [opened]);

  const nameOk = isValidFolderName(draft.name);
  const lang = draft.lang.trim();
  const variant = draft.variant.trim();
  const defaultsOk = (lang.length === 0 && variant.length === 0) ||
    (lang.length > 0 && variant.length > 0);
  const canCreate = nameOk && defaultsOk && !busy && !creating;

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    try {
      const ok = await onCreate({
        name: draft.name.trim(),
        manifest: toManifest(draft),
      });
      if (ok) onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="New library"
      size="md"
    >
      <Stack gap="sm">
        <TextInput
          label="Folder name"
          placeholder="my-prayer-library"
          value={draft.name}
          onChange={(e) => {
            const name = e.currentTarget.value;
            setDraft((prev) => ({ ...prev, name }));
          }}
          error={
            draft.name.trim() && !nameOk
              ? "Name cannot contain path separators"
              : undefined
          }
          data-autofocus
        />

        <Textarea
          label="Description"
          minRows={2}
          autosize
          maxRows={4}
          value={draft.description}
          onChange={(e) => {
            const description = e.currentTarget.value;
            setDraft((prev) => ({ ...prev, description }));
          }}
        />

        <Group grow align="flex-start">
          <TextInput
            label="Default language"
            placeholder="de"
            value={draft.lang}
            onChange={(e) => {
              const lang = e.currentTarget.value;
              setDraft((prev) => ({ ...prev, lang }));
            }}
          />
          <TextInput
            label="Default variant"
            placeholder="standard"
            value={draft.variant}
            onChange={(e) => {
              const variant = e.currentTarget.value;
              setDraft((prev) => ({ ...prev, variant }));
            }}
          />
        </Group>

        {!defaultsOk ? (
          <Text size="xs" c="var(--opt-accent)">
            Provide both language and variant, or leave both empty.
          </Text>
        ) : null}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} disabled={creating}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleCreate()}
            loading={creating || busy}
            disabled={!canCreate}
          >
            Choose location…
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
