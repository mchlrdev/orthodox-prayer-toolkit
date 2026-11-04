import { Checkbox, Group, Stack, TextInput } from "@mantine/core";
import type { VariantMeta } from "@orthodox-prayer-toolkit/core";
import { useSettingsDraft } from "./useSettingsDraft";

type Props = {
  value: VariantMeta;
  onChange: (patch: Partial<VariantMeta>) => void;
};

export function VariantMetaFields({ value, onChange }: Props) {
  const lang = useSettingsDraft(
    value.lang,
    (next) => onChange({ lang: next }),
    { idle: false },
  );
  const edition = useSettingsDraft(
    value.variant,
    (next) => onChange({ variant: next }),
    { idle: false },
  );
  const title = useSettingsDraft(value.title, (next) =>
    onChange({ title: next }),
  );
  const license = useSettingsDraft(value.license, (next) =>
    onChange({ license: next }),
  );
  const source = useSettingsDraft(value.source, (next) =>
    onChange({ source: next }),
  );

  return (
    <Stack gap="xs">
      <Group grow>
        <TextInput label="Language Code" {...lang} />
        <TextInput label="Edition" {...edition} />
      </Group>
      <TextInput label="Display title" {...title} />
      <Group grow>
        <TextInput label="License" {...license} />
        <TextInput label="Source" {...source} />
      </Group>
      <Checkbox
        mt="sm"
        label="Right to Left"
        checked={value.rtl === true}
        onChange={(e) =>
          onChange(
            e.currentTarget.checked ? { rtl: true } : { rtl: undefined },
          )
        }
      />
    </Stack>
  );
}
