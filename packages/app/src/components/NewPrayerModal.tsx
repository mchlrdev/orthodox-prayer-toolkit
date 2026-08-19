import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { Prayer, VariantMeta } from "@orthodox-prayer-toolkit/core";
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
};

export function NewPrayerModal({
  opened,
  onClose,
  onCreate,
  busy = false,
  prayer,
  activeVariant,
  onChange,
  onActiveVariantChange,
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
