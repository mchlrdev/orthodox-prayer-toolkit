import { useEffect, useState } from "react";
import { Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import {
  FALLBACK_KIND_STYLE,
  type KindStyle,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { KindStyleFields } from "./KindStyleFields";

type Props = {
  opened: boolean;
  onClose: () => void;
  kinds: string[];
  resolved: StyleMap;
  appStyles: StyleMap;
  libraryStyles: StyleMap;
  target: "app" | "library";
  onTargetChange: (t: "app" | "library") => void;
  libraryEnabled: boolean;
  onChangeApp: (next: StyleMap) => void;
  onChangeLibrary: (next: StyleMap) => void;
};

export function StylesModal({
  opened,
  onClose,
  kinds,
  resolved,
  appStyles,
  libraryStyles,
  target,
  onTargetChange,
  libraryEnabled,
  onChangeApp,
  onChangeLibrary,
}: Props) {
  const [selected, setSelected] = useState<string | null>(kinds[0] ?? null);

  useEffect(() => {
    if (selected && kinds.includes(selected)) return;
    setSelected(kinds[0] ?? null);
  }, [kinds, selected]);

  const current: KindStyle =
    (selected
      ? target === "app"
        ? appStyles[selected]
        : libraryStyles[selected]
      : undefined) ??
    (selected ? resolved[selected] : undefined) ??
    FALLBACK_KIND_STYLE;

  const patch = (partial: Partial<KindStyle>) => {
    if (!selected) return;
    const nextStyle: KindStyle = {
      ...current,
      ...partial,
      fontSize: partial.fontSize ?? current.fontSize,
      color: partial.color ?? current.color,
      fontWeight: partial.fontWeight ?? current.fontWeight,
      fontStyle: partial.fontStyle ?? current.fontStyle,
    };
    if (!nextStyle.htmlTag) {
      delete nextStyle.htmlTag;
    }
    if (target === "app") {
      onChangeApp({ ...appStyles, [selected]: nextStyle });
    } else {
      onChangeLibrary({ ...libraryStyles, [selected]: nextStyle });
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Kind styles" size="md">
      <Stack gap="sm">
        {selected ? (
          <KindStyleFields
            style={current}
            onChange={patch}
            leading={
              <>
                <Select
                  label="Apply to"
                  data={[
                    { value: "app", label: "App defaults" },
                    {
                      value: "library",
                      label: "Library override",
                      disabled: !libraryEnabled,
                    },
                  ]}
                  value={target}
                  allowDeselect={false}
                  onChange={(v) => {
                    if (v === "app" || v === "library") onTargetChange(v);
                  }}
                />
                <Select
                  label="Kind"
                  searchable
                  data={kinds}
                  value={selected}
                  allowDeselect={false}
                  onChange={setSelected}
                />
              </>
            }
          />
        ) : (
          <Text size="sm" c="dimmed">
            Open a library to discover kinds.
          </Text>
        )}
        <Group justify="flex-end" mt="md">
          <Button onClick={onClose}>Done</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
