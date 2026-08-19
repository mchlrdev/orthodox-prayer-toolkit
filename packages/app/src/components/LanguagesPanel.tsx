import { useState } from "react";
import { Accordion, Button, Group, Stack, Text } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { Prayer, VariantMeta } from "@orthodox-prayer-toolkit/core";
import { VariantMetaFields } from "./VariantMetaFields";

type ActiveVariant = { lang: string; variant: string };

type Props = {
  prayer: Prayer;
  activeVariant: ActiveVariant;
  onChange: (prayer: Prayer) => void;
  onActiveVariantChange: (v: ActiveVariant) => void;
};

function variantKey(v: { lang: string; variant: string }): string {
  return `${v.lang}::${v.variant}`;
}

function languagePanelValue(index: number): string {
  return String(index);
}

export function LanguagesPanel({
  prayer,
  activeVariant,
  onChange,
  onActiveVariantChange,
}: Props) {
  const [openedLanguage, setOpenedLanguage] = useState<string | null>(null);

  const updateVariantMeta = (index: number, patch: Partial<VariantMeta>) => {
    const variants = prayer.variants.map((v, i) =>
      i === index ? { ...v, ...patch } : v,
    );
    onChange({ ...prayer, variants });
    const updated = variants[index];
    if (
      updated &&
      prayer.variants[index] &&
      variantKey(prayer.variants[index]!) === variantKey(activeVariant)
    ) {
      onActiveVariantChange({ lang: updated.lang, variant: updated.variant });
    }
  };

  const addVariant = () => {
    const next: VariantMeta = {
      lang: "en",
      variant: `draft-${prayer.variants.length + 1}`,
      title: prayer.variants[0]?.title ?? "Untitled",
      license: "unknown",
      source: "draft",
    };
    const nextIndex = prayer.variants.length;
    onChange({ ...prayer, variants: [...prayer.variants, next] });
    setOpenedLanguage(languagePanelValue(nextIndex));
  };

  const removeVariant = (index: number) => {
    if (prayer.variants.length <= 1) return;
    const removed = prayer.variants[index];
    const variants = prayer.variants.filter((_, i) => i !== index);
    onChange({ ...prayer, variants });
    if (
      removed &&
      variantKey(removed) === variantKey(activeVariant) &&
      variants[0]
    ) {
      onActiveVariantChange({
        lang: variants[0].lang,
        variant: variants[0].variant,
      });
    }
    setOpenedLanguage((current) => {
      if (current === null) return null;
      const openIndex = Number(current);
      if (openIndex === index) return null;
      if (openIndex > index) return languagePanelValue(openIndex - 1);
      return current;
    });
  };

  return (
    <Stack gap="sm">
      <Accordion
        className="settings-accordion"
        variant="separated"
        radius="md"
        value={openedLanguage}
        onChange={setOpenedLanguage}
      >
        {prayer.variants.map((v, index) => {
          const value = languagePanelValue(index);
          const label = `${v.lang || "—"} / ${v.variant || "—"}`;
          return (
            <Accordion.Item key={value} value={value}>
              <Group wrap="nowrap" gap={0} align="stretch">
                <Accordion.Control style={{ flex: 1 }}>
                  <Text size="sm" fw={600}>
                    {label}
                  </Text>
                  {v.title ? (
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {v.title}
                    </Text>
                  ) : null}
                </Accordion.Control>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="accent"
                  disabled={prayer.variants.length <= 1}
                  leftSection={<IconTrash size={12} />}
                  onClick={() => removeVariant(index)}
                  style={{ alignSelf: "center", marginRight: 8 }}
                >
                  Remove
                </Button>
              </Group>
              <Accordion.Panel>
                <VariantMetaFields
                  value={v}
                  onChange={(patch) => updateVariantMeta(index, patch)}
                />
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
      <Button
        size="xs"
        leftSection={<IconPlus size={14} />}
        variant="light"
        onClick={addVariant}
        style={{ alignSelf: "flex-start" }}
      >
        Add language
      </Button>
    </Stack>
  );
}
