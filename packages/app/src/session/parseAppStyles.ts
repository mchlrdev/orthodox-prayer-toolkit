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
    return { ...DEFAULT_KIND_STYLES, ...styles };
  } catch {
    return { ...DEFAULT_KIND_STYLES };
  }
}
