import { Group, NumberInput, Textarea, TextInput, Stack } from "@mantine/core";
import type { Prayer } from "@orthodox-prayer-toolkit/core";

type Props = {
  prayer: Prayer;
  onChange: (prayer: Prayer) => void;
  autoFocusId?: boolean;
};

export function PrayerBasicsFields({
  prayer,
  onChange,
  autoFocusId = false,
}: Props) {
  const idOk = prayer.id.trim().length > 0;

  return (
    <Stack gap="sm">
      <TextInput
        label="File name"
        value={prayer.id}
        onChange={(e) => onChange({ ...prayer, id: e.currentTarget.value })}
        error={!idOk ? "Required" : undefined}
        data-autofocus={autoFocusId || undefined}
      />
      <Textarea
        label="Description"
        minRows={2}
        autosize
        maxRows={5}
        value={prayer.description ?? ""}
        onChange={(e) =>
          onChange({
            ...prayer,
            description: e.currentTarget.value || undefined,
          })
        }
      />
      <Group grow>
        <TextInput
          label="Type"
          description="e.g. prayer, troparion"
          value={prayer.type}
          onChange={(e) =>
            onChange({ ...prayer, type: e.currentTarget.value })
          }
        />
        <NumberInput
          label="Tone"
          description="1–8, optional"
          min={1}
          max={8}
          allowDecimal={false}
          value={prayer.tone ?? ""}
          onChange={(value) =>
            onChange({
              ...prayer,
              tone: typeof value === "number" ? value : null,
            })
          }
        />
      </Group>
      <Group grow>
        <TextInput
          label="Book"
          placeholder="horologion, menaion…"
          value={prayer.book ?? ""}
          onChange={(e) =>
            onChange({
              ...prayer,
              book: e.currentTarget.value || undefined,
            })
          }
        />
        <TextInput
          label="Occasion"
          placeholder="Optional"
          value={prayer.occasion ?? ""}
          onChange={(e) =>
            onChange({
              ...prayer,
              occasion: e.currentTarget.value || undefined,
            })
          }
        />
      </Group>
    </Stack>
  );
}
