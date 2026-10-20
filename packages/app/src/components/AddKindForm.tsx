import { useCallback, useState } from "react";
import { Autocomplete, Button, Checkbox, Group, Stack } from "@mantine/core";
import { useClickOutside } from "@mantine/hooks";
import { IconPlus } from "@tabler/icons-react";
import { sanitizeKindIdInput, type KindDef } from "@orthodox-prayer-toolkit/core";
import { kindAddChoices, kindAddIssue } from "../prayerEdit";

type Props = {
  /** Kinds already in the list (a prayer's `kinds` or a template's). */
  listed: readonly KindDef[];
  /** Every kind the library knows: offered as suggestions. */
  libraryKinds: readonly string[];
  onAdd: (def: KindDef) => void;
  disabled?: boolean;
  /** Dropdown z-index when shown inside a stacked modal. */
  dropdownZIndex?: number;
};

/**
 * "Add kind": pick a kind the library already knows or type a new id
 * (validated like every kind id), optionally allowing speakers.
 */
export function AddKindForm({
  listed,
  libraryKinds,
  onAdd,
  disabled = false,
  dropdownZIndex,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [speaker, setSpeaker] = useState(false);

  const cancel = useCallback(() => {
    setAdding(false);
    setValue("");
    setSpeaker(false);
  }, []);
  const formRef = useClickOutside<HTMLDivElement>(cancel);

  const choices = kindAddChoices(libraryKinds, listed);
  const issue = kindAddIssue(value, listed.map((k) => k.id));

  const commit = () => {
    if (issue) return;
    const id = value.trim();
    onAdd(speaker ? { id, speaker: true } : { id });
    cancel();
  };

  if (!adding) {
    return (
      <Button
        size="xs"
        variant="light"
        leftSection={<IconPlus size={14} />}
        onClick={() => setAdding(true)}
        disabled={disabled}
        style={{ alignSelf: "flex-start" }}
      >
        Add kind
      </Button>
    );
  }

  return (
    <Stack ref={formRef} gap="xs">
      <Autocomplete
        size="xs"
        placeholder={choices.length > 0 ? "Pick a library kind or type a new one" : "new-kind"}
        data={choices}
        value={value}
        onChange={(v) => setValue(sanitizeKindIdInput(v))}
        comboboxProps={{ zIndex: dropdownZIndex, withinPortal: false }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          }
        }}
        error={value.trim() && issue ? issue : undefined}
        autoFocus
      />
      <Checkbox
        size="xs"
        label="Allows speakers"
        checked={speaker}
        onChange={(e) => setSpeaker(e.currentTarget.checked)}
      />
      <Group gap="xs" wrap="nowrap">
        <Button size="xs" onClick={commit} disabled={Boolean(issue)}>
          Add
        </Button>
        <Button size="xs" variant="default" onClick={cancel}>
          Cancel
        </Button>
      </Group>
    </Stack>
  );
}
