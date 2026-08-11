import type { StyleColorToken } from "@orthodox-prayer-toolkit/core";
import { normalizeStyleColor } from "@orthodox-prayer-toolkit/core";

export type NamedColor = {
  id: StyleColorToken;
  name: string;
  /** CSS color for swatches — always a theme var, never a raw hex. */
  css: string;
};

export const BUILTIN_COLORS: NamedColor[] = [
  { id: "base", name: "Base", css: "var(--opt-base)" },
  { id: "accent", name: "Accent", css: "var(--opt-accent)" },
];

/** Map a kind style color (token or legacy hex) to a CSS var for painting. */
export function styleColorToCss(color: string): string {
  const token = normalizeStyleColor(color) ?? "base";
  return token === "accent" ? "var(--opt-accent)" : "var(--opt-base)";
}

export function matchColor(value: string): NamedColor {
  const token = normalizeStyleColor(value) ?? "base";
  return BUILTIN_COLORS.find((c) => c.id === token) ?? BUILTIN_COLORS[0]!;
}
