import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  IconFolder,
  IconPalette,
  IconTemplate,
} from "@tabler/icons-react";
import {
  isValidStylePrefixStem,
  type IndexedVariant,
  type KindTemplate,
  type LibraryManifest,
  type KindStyle,
  type StyleMap,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";
import type { TemplateEdit } from "../session";
import { KindTemplatesPanel } from "./KindTemplatesPanel";
import { LibraryStylesPanel } from "./LibraryStylesPanel";
import {
  parseVariantKey,
  variantKey,
  variantLabel,
} from "../variant";

export type LibrarySettingsPane = "library" | "templates" | "styles";

type Props = {
  opened: boolean;
  onClose: () => void;
  pane: LibrarySettingsPane;
  onPaneChange: (pane: LibrarySettingsPane) => void;
  manifest: LibraryManifest | null;
  /** lang/variant pairs discovered in the open library (and open drafts). */
  availableVariants: IndexedVariant[];
  busy?: boolean;
  onSave: (manifest: LibraryManifest) => void | Promise<void>;
  /** Old-format files remain (the prompt was declined or partly failed). */
  migrationNeeded: boolean;
  /** Why the migration cannot run yet (shown instead of "Migrate…"). */
  migrationBlocked: string | null;
  onMigrate: () => void;
  templates: {
    templates: readonly KindTemplate[];
    templateErrors: readonly ValidationError[];
    onCreate: (input: { label: string }) => Promise<string | null>;
    onUpdate: (id: string, edit: TemplateEdit) => void;
    onDelete: (id: string) => void;
  };
  styles: {
    libraryKinds: string[];
    resolved: StyleMap;
    unusedStyleKeys: string[];
    onPatchStyle: (kind: string, partial: Partial<KindStyle>) => void;
    onRemoveStyle: (kind: string) => void;
  };
};

const NAV: {
  id: LibrarySettingsPane;
  label: string;
  icon: typeof IconFolder;
}[] = [
  { id: "library", label: "Library", icon: IconFolder },
  { id: "templates", label: "Kind templates", icon: IconTemplate },
  { id: "styles", label: "Kind styles", icon: IconPalette },
];

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
  pane,
  onPaneChange,
  manifest,
  availableVariants,
  busy = false,
  onSave,
  migrationNeeded,
  migrationBlocked,
  onMigrate,
  templates,
  styles,
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

  const section = (id: LibrarySettingsPane) => ({
    className: "settings-hub-pane-section",
    "data-active": pane === id ? "true" : undefined,
    "aria-hidden": pane !== id,
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Library settings"
      size={760}
      padding={0}
      className="settings-hub-modal"
      styles={{
        body: { padding: 0 },
        content: { overflow: "hidden" },
      }}
    >
      <div className="settings-hub">
        <nav className="settings-hub-nav" aria-label="Library settings">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pane === item.id;
            return (
              <UnstyledButton
                key={item.id}
                className="settings-hub-nav-item"
                data-active={active ? "true" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={() => onPaneChange(item.id)}
              >
                <Icon size={16} stroke={1.75} />
                <span>{item.label}</span>
              </UnstyledButton>
            );
          })}
        </nav>
        <div className="settings-hub-pane">
          <div {...section("library")}>
            <Stack gap="sm">
              {migrationNeeded ? (
                <Alert color="gray" variant="light" title="Old file format">
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <Text size="xs">
                      {migrationBlocked
                        ? `Some files still use the old kind format (they open fine, migrated in memory). Migration waits: ${migrationBlocked}`
                        : "Some files still use the old kind format (they open fine, migrated in memory)."}
                    </Text>
                    <Button
                      size="compact-xs"
                      variant="default"
                      onClick={onMigrate}
                      disabled={migrationBlocked !== null}
                    >
                      Migrate…
                    </Button>
                  </Group>
                </Alert>
              ) : null}
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
                description="Leave empty for the app default (opt_)."
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
          </div>
          <div {...section("templates")}>
            <KindTemplatesPanel
              templates={templates.templates}
              templateErrors={templates.templateErrors}
              libraryKinds={styles.libraryKinds}
              onCreate={templates.onCreate}
              onUpdate={templates.onUpdate}
              onDelete={templates.onDelete}
            />
          </div>
          <div {...section("styles")}>
            <LibraryStylesPanel
              libraryKinds={styles.libraryKinds}
              resolved={styles.resolved}
              unusedStyleKeys={styles.unusedStyleKeys}
              onPatchStyle={styles.onPatchStyle}
              onRemoveStyle={styles.onRemoveStyle}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
