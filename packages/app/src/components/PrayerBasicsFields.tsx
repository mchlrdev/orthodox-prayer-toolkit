import { useRef } from "react";
import { Group, NumberInput, Textarea, TextInput, Stack } from "@mantine/core";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import { useSettingsDraft } from "./useSettingsDraft";

type Props = {
  prayer: Prayer;
  onChange: (prayer: Prayer, options?: { coalesceKey?: string }) => void;
  autoFocusId?: boolean;
  /** Keep typing local until idle/blur. Off in New prayer so Create sees the id. */
  deferCommit?: boolean;
};

export function PrayerBasicsFields({
  prayer,
  onChange,
  autoFocusId = false,
  deferCommit = false,
}: Props) {
  const live = !deferCommit;
  const prayerRef = useRef(prayer);
  prayerRef.current = prayer;
  const idDraft = useSettingsDraft(
    prayer.id,
    (next) =>
      onChange(
        { ...prayerRef.current, id: next },
        { coalesceKey: "prayer-basics:id" },
      ),
    { live },
  );
  const description = useSettingsDraft(
    prayer.description ?? "",
    (next) =>
      onChange(
        { ...prayerRef.current, description: next || undefined },
        { coalesceKey: "prayer-basics:description" },
      ),
    { live },
  );
  const type = useSettingsDraft(prayer.type, (next) =>
    onChange(
      { ...prayerRef.current, type: next },
      { coalesceKey: "prayer-basics:type" },
    ),
    { live },
  );
  const book = useSettingsDraft(prayer.book ?? "", (next) =>
    onChange(
      { ...prayerRef.current, book: next || undefined },
      { coalesceKey: "prayer-basics:book" },
    ),
    { live },
  );
  const occasion = useSettingsDraft(prayer.occasion ?? "", (next) =>
    onChange(
      { ...prayerRef.current, occasion: next || undefined },
      { coalesceKey: "prayer-basics:occasion" },
    ),
    { live },
  );

  return (
    <Stack gap="sm">
      <TextInput
        label="File name"
        {...idDraft}
        error={idDraft.value.trim().length > 0 ? undefined : "Required"}
        data-autofocus={autoFocusId || undefined}
      />
      <Textarea
        label="Description"
        minRows={2}
        autosize
        maxRows={5}
        {...description}
      />
      <Group grow>
        <TextInput
          label="Type"
          description="e.g. prayer, troparion"
          {...type}
        />
        <NumberInput
          label="Tone"
          description="1–8, optional"
          min={1}
          max={8}
          allowDecimal={false}
          hideControls
          value={prayer.tone ?? ""}
          onChange={(value) =>
            onChange({
              ...prayerRef.current,
              tone: typeof value === "number" ? value : null,
            })
          }
        />
      </Group>
      <Group grow>
        <TextInput
          label="Book"
          placeholder="horologion, menaion…"
          {...book}
        />
        <TextInput
          label="Occasion"
          placeholder="Optional"
          {...occasion}
        />
      </Group>
    </Stack>
  );
}
