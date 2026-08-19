import { useState } from "react";
import {
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { BUILTIN_COLORS, matchColor } from "../colors";

type Props = {
  value: string;
  onChange: (token: string) => void;
  label?: string;
  withinPortal?: boolean;
  dropdownZIndex?: number;
};

export function ColorSelect({
  value,
  onChange,
  label,
  withinPortal = true,
  dropdownZIndex,
}: Props) {
  const [opened, setOpened] = useState(false);
  const matched = matchColor(value);

  return (
    <Stack gap={4}>
      {label ? (
        <Text size="xs" c="dimmed" fw={500}>
          {label}
        </Text>
      ) : null}
      <Popover
        opened={opened}
        onChange={setOpened}
        position="bottom-start"
        width={200}
        withinPortal={withinPortal}
        zIndex={dropdownZIndex}
      >
        <Popover.Target>
          <UnstyledButton
            onClick={() => setOpened((o) => !o)}
            className="option-row"
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--opt-border)",
              background: "var(--opt-bg)",
            }}
          >
            <span
              className="color-swatch"
              style={{ background: matched.css }}
            />
            <Text size="sm" style={{ flex: 1 }}>
              {matched.name}
            </Text>
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown p={6}>
          <Stack gap={2}>
            {BUILTIN_COLORS.map((color) => {
              const selected = matched.id === color.id;
              return (
                <UnstyledButton
                  key={color.id}
                  className="option-row"
                  onClick={() => {
                    onChange(color.id);
                    setOpened(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: selected
                      ? "color-mix(in srgb, var(--opt-base) 6%, transparent)"
                      : "transparent",
                  }}
                >
                  <span
                    className="color-swatch"
                    style={{ background: color.css }}
                  />
                  <Text size="sm" style={{ flex: 1 }}>
                    {color.name}
                  </Text>
                  {selected ? <IconCheck size={14} /> : null}
                </UnstyledButton>
              );
            })}
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Stack>
  );
}
