import type { KindStyle, StyleMap } from "./types.js";

/** Fallback when a custom kind has no library style. */
export const FALLBACK_KIND_STYLE: KindStyle = {
  fontSize: "1rem",
  color: "base",
  fontWeight: "400",
  fontStyle: "normal",
};

/** Recommended defaults for preset kinds. */
export const DEFAULT_KIND_STYLES: StyleMap = {
  heading: {
    fontSize: "1.125rem",
    color: "accent",
    fontWeight: "400",
    fontStyle: "normal",
    htmlTag: "h2",
    indicate: "true",
  },
  subheading: {
    fontSize: "1rem",
    color: "accent",
    fontWeight: "400",
    fontStyle: "normal",
    htmlTag: "h3",
  },
  annotation: {
    fontSize: "1rem",
    color: "accent",
    fontWeight: "400",
    fontStyle: "normal",
    htmlTag: "p",
    textAlign: "justify",
  },
  verse: {
    fontSize: "1rem",
    color: "base",
    fontWeight: "400",
    fontStyle: "normal",
    initialCap: "true",
    htmlTag: "p",
    textAlign: "justify",
  },
};

export type ResolveStylesOptions = {
  /** Kinds discovered in the opened library (and/or current prayer). */
  discoveredKinds: string[];
  /** Library `styles.json` (sanitized); wins over the built-in defaults. */
  libraryOverrides?: StyleMap;
  /** Style assigned to newly discovered unknown kinds. */
  defaultPreset?: KindStyle;
};

/**
 * Resolve kind styles: library overrides on top of `DEFAULT_KIND_STYLES`
 * (presets) or `defaultPreset`. Every discovered kind gets an entry.
 */
export function resolveStyles(options: ResolveStylesOptions): StyleMap {
  const {
    discoveredKinds,
    libraryOverrides,
    defaultPreset = FALLBACK_KIND_STYLE,
  } = options;

  const kindSet = new Set([
    ...discoveredKinds,
    ...Object.keys(libraryOverrides ?? {}),
    ...Object.keys(DEFAULT_KIND_STYLES),
  ]);

  const resolved: StyleMap = {};
  for (const kind of kindSet) {
    const base = DEFAULT_KIND_STYLES[kind] ?? defaultPreset;
    const override = libraryOverrides?.[kind];
    resolved[kind] = override ? { ...base, ...override } : { ...base };
  }

  return resolved;
}
