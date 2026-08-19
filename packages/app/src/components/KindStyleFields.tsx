import type { ReactNode } from "react";
import {
  Checkbox,
  Group,
  Input,
  SegmentedControl,
  Select,
  Stack,
} from "@mantine/core";
import {
  HTML_TAG_ALLOWLIST,
  type KindStyle,
} from "@orthodox-prayer-toolkit/core";
import { ColorSelect } from "./ColorSelect";

/** Above KindSelect's edit modal (400), below its confirm dialog (500). */
export const KIND_FIELD_DROPDOWN_Z = 450;

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
  /**
   * Keep lists inside a stacked modal. KindSelect's edit dialog uses
   * `false` so Size / Color / HTML tag aren't painted behind it.
   */
  portalDropdowns?: boolean;
};

export function KindStyleFields({
  style,
  onChange,
  leading,
  portalDropdowns = true,
}: Props) {
  const size = nearestFontSize(style.fontSize);
  const bold = isBoldWeight(style.fontWeight);
  const italic = style.fontStyle === "italic";
  const comboboxProps = {
    withinPortal: portalDropdowns,
    zIndex: portalDropdowns ? KIND_FIELD_DROPDOWN_Z : undefined,
  };

  const textAlign =
    style.textAlign === "center" || style.textAlign === "justify"
      ? style.textAlign
      : "left";

  return (
    <Stack gap="sm">
      {leading}
      <div className="kind-style-pair">
        <Select
          label="Size"
          w="100%"
          data={[...FONT_SIZE_OPTIONS]}
          value={size}
          allowDeselect={false}
          onChange={(v) => v && onChange({ fontSize: v })}
          comboboxProps={comboboxProps}
        />
        <ColorSelect
          label="Color"
          value={style.color}
          onChange={(color) => onChange({ color })}
          withinPortal={portalDropdowns}
          dropdownZIndex={portalDropdowns ? KIND_FIELD_DROPDOWN_Z : undefined}
        />
      </div>
      <Stack gap={4}>
        <Input.Label>Align</Input.Label>
        <SegmentedControl
          fullWidth
          size="xs"
          aria-label="Text align"
          value={textAlign}
          onChange={(v) => onChange({ textAlign: v })}
          data={[
            { label: "Left", value: "left" },
            { label: "Center", value: "center" },
            { label: "Justified", value: "justify" },
          ]}
        />
      </Stack>
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
        <Checkbox
          label="Indicate"
          checked={style.indicate === "true"}
          onChange={(e) =>
            onChange({
              indicate: e.currentTarget.checked ? "true" : "false",
            })
          }
        />
      </Group>
      <Select
        label="HTML tag for export"
        data={HTML_TAG_ALLOWLIST.map((tag) => ({ value: tag, label: tag }))}
        value={style.htmlTag ?? null}
        onChange={(v) => onChange({ htmlTag: v ?? "" })}
        comboboxProps={comboboxProps}
        clearable
        placeholder="Default (div)"
      />
    </Stack>
  );
}
