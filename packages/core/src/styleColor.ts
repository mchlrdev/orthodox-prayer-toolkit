/** Semantic kind text colors — resolved to CSS vars in the app. */
export type StyleColorToken = "base" | "accent";

/** Legacy Accent hex — used only for migrating old style configs. */
export const LEGACY_ACCENT_HEX = "#8b2942";

function expandShortHex(hex: string): string {
  // #rgb → #rrggbb
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    const r = hex[1]!;
    const g = hex[2]!;
    const b = hex[3]!;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return hex.toLowerCase();
}

function canonicalizeHex(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(t)) return expandShortHex(t);
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  if (/^[0-9a-f]{3}$/.test(t)) return expandShortHex(`#${t}`);
  return null;
}

/**
 * Map a style color value to a token.
 * - `base` / `accent` pass through
 * - known Accent hex → `accent`
 * - any other safe hex → `base` (legacy migration)
 * - otherwise null (invalid)
 */
export function normalizeStyleColor(value: string): StyleColorToken | null {
  const t = value.trim().toLowerCase();
  if (t === "base" || t === "accent") return t;

  const hex = canonicalizeHex(t);
  if (!hex) return null;
  if (hex === LEGACY_ACCENT_HEX) return "accent";
  return "base";
}

export function isStyleColorToken(value: string): value is StyleColorToken {
  return value === "base" || value === "accent";
}
