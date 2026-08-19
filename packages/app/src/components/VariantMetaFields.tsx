import { Group, Stack, TextInput } from "@mantine/core";
import type { VariantMeta } from "@orthodox-prayer-toolkit/core";

type Props = {
  value: VariantMeta;
  onChange: (patch: Partial<VariantMeta>) => void;
};

export function VariantMetaFields({ value, onChange }: Props) {
  return (
    <Stack gap="xs">
      <Group grow>
        <TextInput
          label="Language Code"
          value={value.lang}
          onChange={(e) => onChange({ lang: e.currentTarget.value })}
        />
        <TextInput
          label="Edition"
          value={value.variant}
          onChange={(e) => onChange({ variant: e.currentTarget.value })}
        />
      </Group>
      <TextInput
        label="Display title"
        value={value.title}
        onChange={(e) => onChange({ title: e.currentTarget.value })}
      />
      <Group grow>
        <TextInput
          label="License"
          value={value.license}
          onChange={(e) => onChange({ license: e.currentTarget.value })}
        />
        <TextInput
          label="Source"
          value={value.source}
          onChange={(e) => onChange({ source: e.currentTarget.value })}
        />
      </Group>
    </Stack>
  );
}
