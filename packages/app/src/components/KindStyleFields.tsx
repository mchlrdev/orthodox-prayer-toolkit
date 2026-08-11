import type { ReactNode } from "react";
import { Checkbox, Group, Select, Stack } from "@mantine/core";
import {
  HTML_TAG_ALLOWLIST,
  type KindStyle,
} from "@orthodox-prayer-toolkit/core";
import { ColorSelect } from "./ColorSelect";

/** T-shirt sizes → CSS font-size values stored on KindStyle. */
export const FONT_SIZE_OPTIONS = [
  { value: "0.875rem", label: "S" },
  { value: "1rem", label: "M" },
  { value: "1.125rem", label: "L" },
  { value: "1.35rem", label: "XL" },
] as const;

const SIZE_VALUES = FONT_SIZE_OPTIONS.map((o) => o.value);

function parseRem(value: string): number | null {
  const m = /^([\d.]+)\s*rem$/i.exec(value.trim());
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Map an arbitrary CSS size to the nearest t-shirt option. */
export function nearestFontSize(value: string): string {
  if (SIZE_VALUES.includes(value as (typeof SIZE_VALUES)[number])) {
    return value;
  }
  const rem = parseRem(value);
  if (rem === null) return "1rem";

  let best = SIZE_VALUES[1]!; // M
  let bestDist = Infinity;
  for (const option of SIZE_VALUES) {
    const optionRem = parseRem(option);
    if (optionRem === null) continue;
    const dist = Math.abs(optionRem - rem);
    if (dist < bestDist) {
      bestDist = dist;
      best = option;
    }
  }
  return best;
}

export function isBoldWeight(weight: string): boolean {
  const n = Number(weight);
  if (Number.isFinite(n)) return n >= 600;
  return weight === "bold" || weight === "bolder";
}

type Props = {
  style: KindStyle;
  onChange: (partial: Partial<KindStyle>) => void;
  /** Optional controls rendered above the shared fields (target, kind, …). */
  leading?: ReactNode;
};

export function KindStyleFields({ style, onChange, leading }: Props) {
  const size = nearestFontSize(style.fontSize);
  const bold = isBoldWeight(style.fontWeight);
  const italic = style.fontStyle === "italic";

  return (
    <Stack gap="sm">
      {leading}
      <Select
        label="Size"
        data={[...FONT_SIZE_OPTIONS]}
        value={size}
        allowDeselect={false}
        onChange={(v) => v && onChange({ fontSize: v })}
      />
      <ColorSelect
        label="Color"
        value={style.color}
        onChange={(color) => onChange({ color })}
      />
      <Group gap="lg">
        <Checkbox
          label="Bold"
          checked={bold}
          onChange={(e) =>
            onChange({ fontWeight: e.currentTarget.checked ? "700" : "400" })
          }
        />
        <Checkbox
          label="Italic"
          checked={italic}
          onChange={(e) =>
            onChange({
              fontStyle: e.currentTarget.checked ? "italic" : "normal",
            })
          }
        />
        <Checkbox
          label="Accent initial"
          checked={style.initialCap === "true"}
          onChange={(e) =>
            onChange({
              initialCap: e.currentTarget.checked ? "true" : "false",
            })
          }
        />
      </Group>
      <Select
        label="HTML tag"
        description="Element used when exporting this kind as HTML"
        data={HTML_TAG_ALLOWLIST.map((tag) => ({ value: tag, label: tag }))}
        value={style.htmlTag ?? null}
        onChange={(v) => onChange({ htmlTag: v ?? "" })}
        clearable
        placeholder="Default (div)"
      />
    </Stack>
  );
}
