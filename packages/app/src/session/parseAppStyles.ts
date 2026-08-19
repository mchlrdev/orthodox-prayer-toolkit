import {
  DEFAULT_KIND_STYLES,
  sanitizeStyles,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";

export function parseAppStyles(raw: string | null): StyleMap {
  if (!raw) return { ...DEFAULT_KIND_STYLES };
  try {
    const parsed: unknown = JSON.parse(raw);
    const { styles } = sanitizeStyles(parsed);
    const merged: StyleMap = { ...DEFAULT_KIND_STYLES };
    for (const [kind, style] of Object.entries(styles)) {
      const base = DEFAULT_KIND_STYLES[kind];
      merged[kind] = base ? { ...base, ...style } : style;
    }
    return merged;
  } catch {
    return { ...DEFAULT_KIND_STYLES };
  }
}
