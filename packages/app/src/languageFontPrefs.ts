import { plainText, type Prayer } from "@orthodox-prayer-toolkit/core";
import { parseVariantKey, variantKey } from "./variant";

/**
 * Reading settings for the editor only (App settings, this computer): how wide
 * a column gets and which font and size each Variant shows in. Never in the
 * Prayer JSON, styles.json or an export.
 */

export type ColumnWidth = "narrow" | "medium" | "wide";

export const DEFAULT_COLUMN_WIDTH: ColumnWidth = "medium";

/** In em of the editor text size, so the line length stays when the text grows. */
const COLUMN_WIDTH_EM: Record<ColumnWidth, number> = { narrow: 32, medium: 44, wide: 64 };

export function columnWidthCss(width: ColumnWidth): string {
  return `${COLUMN_WIDTH_EM[width]}em`;
}

export function isColumnWidth(value: unknown): value is ColumnWidth {
  return value === "narrow" || value === "medium" || value === "wide";
}

export type VariantFont = {
  /** Font installed on this computer; none = the Prayer font. */
  family?: string;
  /** Size in percent of the editor text size. */
  size: number;
};

/** By `variantKey`; matched exactly against the Variants of the Prayer on screen. */
export type VariantFonts = Record<string, VariantFont>;

export const VARIANT_FONT_SIZE_MIN = 50;
export const VARIANT_FONT_SIZE_MAX = 250;

function clampSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(VARIANT_FONT_SIZE_MAX, Math.max(VARIANT_FONT_SIZE_MIN, Math.round(n)));
}

/** What localStorage holds, without anything broken. */
export function readVariantFonts(value: unknown): VariantFonts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fonts: VariantFonts = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!parseVariantKey(key) || !raw || typeof raw !== "object") continue;
    const { family, size } = raw as { family?: unknown; size?: unknown };
    fonts[key] = {
      ...(typeof family === "string" && family.trim() ? { family: family.trim() } : {}),
      size: clampSize(size),
    };
  }
  return fonts;
}

/** A quoted CSS string; font names are free text, the rule must stay one rule. */
function cssString(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&").replace(/[\n\r\f<>{}]/g, " ")}"`;
}

/** An attribute value in a selector: free text that must still match exactly. */
function cssAttribute(value: string): string {
  return `"${value.replace(/[\\"\n\r\f<>{}]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`;
}

/** The rules for one Variant: the cell sets the size (Kind sizes are em), the text the font. */
export function variantFontCss(fonts: VariantFonts): string {
  const rules: string[] = [];
  for (const [key, font] of Object.entries(fonts)) {
    const parsed = parseVariantKey(key);
    if (!parsed) continue;
    const cell = `.split-cell[data-lang=${cssAttribute(parsed.lang)}][data-variant=${cssAttribute(parsed.variant)}]`;
    if (font.size !== 100) rules.push(`${cell} { font-size: ${clampSize(font.size)}%; }`);
    if (font.family) rules.push(`${cell} .inline-content { font-family: ${cssString(font.family)}, var(--opt-prayer-font); }`);
  }
  return rules.join("\n");
}

const SAMPLE_LENGTH = 120;

/** A line to try a font on: each Variant's first text in the open Prayer, by `variantKey`. */
export function variantSamples(prayer: Prayer | null): Map<string, string> {
  const samples = new Map<string, string>();
  for (const block of prayer?.structure ?? []) {
    for (const t of block.translations) {
      const key = variantKey(t);
      if (samples.has(key)) continue;
      const text = [t.text, ...(t.lines ?? [])]
        .map((content) => (content === undefined ? "" : plainText(content).trim()))
        .find(Boolean);
      if (text) samples.set(key, text.slice(0, SAMPLE_LENGTH));
    }
  }
  return samples;
}
