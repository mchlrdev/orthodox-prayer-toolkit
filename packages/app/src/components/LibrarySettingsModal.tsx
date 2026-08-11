import { useEffect, useMemo, useState } from "react";
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
import {
  isValidStylePrefixStem,
  type IndexedVariant,
  type LibraryManifest,
} from "@orthodox-prayer-toolkit/core";
import {
  parseVariantKey,
  variantKey,
  variantLabel,
} from "../variant";

type Props = {
  opened: boolean;
  onClose: () => void;
  manifest: LibraryManifest | null;
  /** lang/variant pairs discovered in the open library (and open drafts). */
  availableVariants: IndexedVariant[];
  busy?: boolean;
  onSave: (manifest: LibraryManifest) => void | Promise<void>;
};

type Draft = {
  description: string;
  /** `lang::variant`, or empty when no default. */
  defaultKey: string;
  stylePrefixStem: string;
};

function toDraft(manifest: LibraryManifest | null): Draft {
  const dv = manifest?.defaultVariant;
  return {
    description: manifest?.description ?? "",
    defaultKey: dv ? variantKey(dv) : "",
    stylePrefixStem: manifest?.stylePrefixStem ?? "",
  };
}

function toManifest(draft: Draft): LibraryManifest {
  const manifest: LibraryManifest = {};
  const description = draft.description.trim();
  if (description) manifest.description = description;

  const parsed = parseVariantKey(draft.defaultKey.trim());
  if (parsed) {
    manifest.defaultVariant = parsed;
  }

  const stem = draft.stylePrefixStem.trim();
  if (stem && isValidStylePrefixStem(stem)) {
    manifest.stylePrefixStem = stem;
  }

  return manifest;
}

export function LibrarySettingsModal({
  opened,
  onClose,
  manifest,
  availableVariants,
  busy = false,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(manifest));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (opened) setDraft(toDraft(manifest));
  }, [opened, manifest]);

  const selectData = useMemo(() => {
    const byKey = new Map(
      availableVariants.map((v) => [
        variantKey(v),
        { value: variantKey(v), label: variantLabel(v) },
      ]),
    );

    const current = parseVariantKey(draft.defaultKey);
    if (current) {
      const key = variantKey(current);
      if (!byKey.has(key)) {
        byKey.set(key, {
          value: key,
          label: `${variantLabel(current)} (not in library)`,
        });
      }
    }

    return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [availableVariants, draft.defaultKey]);

  const stemValid = isValidStylePrefixStem(draft.stylePrefixStem.trim());
  const canSave = stemValid;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(toManifest(draft));
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Library settings"
      size="md"
    >
      <Stack gap="sm">
        <Textarea
          label="Description"
          minRows={2}
          autosize
          maxRows={5}
          value={draft.description}
          onChange={(e) =>
            setDraft((prev) => ({
              ...prev,
              description: e.currentTarget.value,
            }))
          }
          data-autofocus
        />

        <Select
          label="Default language"
          placeholder={
            selectData.length === 0
              ? "No languages in library yet"
              : "None (first language per prayer)"
          }
          data={selectData}
          value={draft.defaultKey || null}
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, defaultKey: value ?? "" }))
          }
          searchable
          clearable
          nothingFoundMessage="No matching language"
          disabled={selectData.length === 0 && !draft.defaultKey}
        />

        <TextInput
          label="Layout style prefix"
          description="Stem only — underscore is added automatically (e.g. opt → opt_heading). Leave empty for the app default opt."
          value={draft.stylePrefixStem}
          onChange={(e) =>
            setDraft((prev) => ({
              ...prev,
              stylePrefixStem: e.currentTarget.value,
            }))
          }
          rightSection={
            <Text size="sm" c="dimmed" pr="xs">
              _
            </Text>
          }
          rightSectionPointerEvents="none"
          error={
            stemValid
              ? undefined
              : "Use letters/digits only, starting with a letter — or leave empty"
          }
        />

        {availableVariants.length === 0 && !draft.defaultKey ? (
          <Text size="xs" c="dimmed">
            Add a language to a prayer first, then pick a library default here.
          </Text>
        ) : null}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose} disabled={saving || busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            loading={saving || busy}
            disabled={!canSave}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
