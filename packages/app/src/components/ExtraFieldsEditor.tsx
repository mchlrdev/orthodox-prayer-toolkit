import { Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import type { Prayer } from "@orthodox-prayer-toolkit/core";

type Props = {
  prayer: Prayer;
  onChange: (prayer: Prayer) => void;
};

export function ExtraFieldsEditor({ prayer, onChange }: Props) {
  const customEntries = Object.entries(prayer.meta?.custom ?? {});

  const setCustom = (key: string, value: string) => {
    const custom = { ...(prayer.meta?.custom ?? {}) };
    if (value.trim() === "") {
      delete custom[key];
    } else {
      custom[key] = value;
    }
    onChange({
      ...prayer,
      meta: {
        ...prayer.meta,
        custom: Object.keys(custom).length > 0 ? custom : undefined,
      },
    });
  };

  const renameCustomKey = (from: string, to: string) => {
    const nextKey = to.trim();
    if (!nextKey || nextKey === from) return;
    const custom = { ...(prayer.meta?.custom ?? {}) };
    const value = custom[from];
    delete custom[from];
    custom[nextKey] = value ?? "";
    onChange({
      ...prayer,
      meta: { ...prayer.meta, custom },
    });
  };

  const addCustomField = () => {
    const custom = { ...(prayer.meta?.custom ?? {}) };
    let n = 1;
    let key = `field_${n}`;
    while (key in custom) {
      n += 1;
      key = `field_${n}`;
    }
    custom[key] = "";
    onChange({
      ...prayer,
      meta: { ...prayer.meta, custom },
    });
  };

  const removeCustomField = (key: string) => {
    const custom = { ...(prayer.meta?.custom ?? {}) };
    delete custom[key];
    onChange({
      ...prayer,
      meta: {
        ...prayer.meta,
        custom: Object.keys(custom).length > 0 ? custom : undefined,
      },
    });
  };

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        Extra fields
      </Text>
      {customEntries.length === 0 ? (
        <Text size="sm" c="dimmed">
          No extra fields yet.
        </Text>
      ) : (
        customEntries.map(([key, value]) => (
          <Group key={key} align="flex-end" wrap="nowrap" gap="xs">
            <TextInput
              label="Name"
              defaultValue={key}
              key={`key-${key}`}
              style={{ flex: 1 }}
              onBlur={(e) => renameCustomKey(key, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  renameCustomKey(key, e.currentTarget.value);
                  e.currentTarget.blur();
                }
              }}
            />
            <TextInput
              label="Value"
              value={value == null ? "" : String(value)}
              style={{ flex: 1.4 }}
              onChange={(e) => setCustom(key, e.currentTarget.value)}
            />
            <Button
              color="accent"
              variant="subtle"
              px="xs"
              onClick={() => removeCustomField(key)}
              aria-label={`Remove ${key}`}
            >
              <IconTrash size={16} />
            </Button>
          </Group>
        ))
      )}
      <Button
        size="xs"
        variant="light"
        leftSection={<IconPlus size={14} />}
        onClick={addCustomField}
        style={{ alignSelf: "flex-start" }}
      >
        Add field
      </Button>
    </Stack>
  );
}
