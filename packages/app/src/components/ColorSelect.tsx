import { useState } from "react";
import {
  Input,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
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
    <Input.Wrapper label={label} style={{ width: "100%", minWidth: 0 }}>
      <Popover
        opened={opened}
        onChange={setOpened}
        position="bottom-start"
        width="target"
        withinPortal={withinPortal}
        zIndex={dropdownZIndex}
      >
        <Popover.Target>
          <Input
            component="button"
            type="button"
            pointer
            w="100%"
            classNames={{ input: "color-select-trigger" }}
            onClick={() => setOpened((o) => !o)}
            leftSection={
              <span
                className="color-swatch"
                style={{ background: matched.css }}
              />
            }
            rightSection={<IconChevronDown size={14} />}
            rightSectionPointerEvents="none"
          >
            {matched.name}
          </Input>
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
    </Input.Wrapper>
  );
}
