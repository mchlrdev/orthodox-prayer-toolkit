import { Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import type {
  KindTemplate,
  Prayer,
  VariantMeta,
} from "@orthodox-prayer-toolkit/core";
import { PrayerBasicsFields } from "./PrayerBasicsFields";
import { VariantMetaFields } from "./VariantMetaFields";

type ActiveVariant = { lang: string; variant: string };

type Props = {
  opened: boolean;
  onClose: () => void;
  onCreate: () => void;
  busy?: boolean;
  prayer: Prayer;
  activeVariant: ActiveVariant;
  onChange: (prayer: Prayer) => void;
  onActiveVariantChange: (v: ActiveVariant) => void;
  /** Library kind templates; the chosen one is stamped into the prayer. */
  templates: readonly KindTemplate[];
  templateId: string | null;
  onTemplateChange: (templateId: string | null) => void;
};

// Not a valid template id (slug), so it cannot collide.
const NO_TEMPLATE = "__none__";

/** Options for the Kind template select ("No template" first). */
export function templateSelectData(
  templates: readonly KindTemplate[],
): { value: string; label: string }[] {
  return [
    { value: NO_TEMPLATE, label: "No template (built-in kinds only)" },
    ...templates.map((t) => ({
      value: t.id,
      label:
        t.kinds.length === 0
          ? t.label
          : `${t.label} — ${t.kinds.map((k) => k.id).join(", ")}`,
    })),
  ];
}

export function NewPrayerModal({
  opened,
  onClose,
  onCreate,
  busy = false,
  prayer,
  activeVariant,
  onChange,
  onActiveVariantChange,
  templates,
  templateId,
  onTemplateChange,
}: Props) {
  const first = prayer.variants[0];
  const idOk = prayer.id.trim().length > 0;

  const updateFirstVariant = (patch: Partial<VariantMeta>) => {
    if (!first) return;
    const variants = prayer.variants.map((v, i) =>
      i === 0 ? { ...v, ...patch } : v,
    );
    onChange({ ...prayer, variants });
    const updated = variants[0];
    if (!updated) return;
    if (variantKey(first) === variantKey(activeVariant)) {
      onActiveVariantChange({ lang: updated.lang, variant: updated.variant });
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="New prayer"
      size="lg"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <Stack gap="lg">
        <PrayerBasicsFields
          prayer={prayer}
          onChange={onChange}
          autoFocusId
        />
        {first ? (
          <Stack gap="sm">
            <Text size="sm" fw={600}>
              Language
            </Text>
            <VariantMetaFields value={first} onChange={updateFirstVariant} />
          </Stack>
        ) : null}
        <Select
          label="Kind template"
          description={
            templates.length === 0
              ? "Create kind templates in Library settings"
              : "Copies the template’s custom kinds into the new prayer"
          }
          data={templateSelectData(templates)}
          value={templateId ?? NO_TEMPLATE}
          allowDeselect={false}
          disabled={templates.length === 0}
          onChange={(v) => onTemplateChange(v && v !== NO_TEMPLATE ? v : null)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onCreate} loading={busy} disabled={!idOk}>
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function variantKey(v: { lang: string; variant: string }): string {
  return `${v.lang}::${v.variant}`;
}
