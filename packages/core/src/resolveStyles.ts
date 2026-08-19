import type { KindStyle, StyleMap } from "./types.js";

/** Fallback when a kind has no app or library style. */
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
  /** App-persisted defaults (partial; missing kinds use DEFAULT_KIND_STYLES / FALLBACK). */
  appDefaults?: StyleMap;
  /** Library override file; wins over app defaults. */
  libraryOverrides?: StyleMap;
  /** Style assigned to newly discovered unknown kinds. */
  defaultPreset?: KindStyle;
};

function baseForKind(
  kind: string,
  appDefaults: StyleMap | undefined,
  defaultPreset: KindStyle,
): KindStyle {
  const builtin = DEFAULT_KIND_STYLES[kind] ?? defaultPreset;
  const app = appDefaults?.[kind];
  return app ? { ...builtin, ...app } : { ...builtin };
}

/**
 * Resolve kind styles: library overrides win over app defaults.
 * Every discovered kind gets an entry (unknown → defaultPreset).
 */
export function resolveStyles(options: ResolveStylesOptions): StyleMap {
  const {
    discoveredKinds,
    appDefaults,
    libraryOverrides,
    defaultPreset = FALLBACK_KIND_STYLE,
  } = options;

  const kindSet = new Set([
    ...discoveredKinds,
    ...Object.keys(appDefaults ?? {}),
    ...Object.keys(libraryOverrides ?? {}),
    ...Object.keys(DEFAULT_KIND_STYLES),
  ]);

  const resolved: StyleMap = {};
  for (const kind of kindSet) {
    const base = baseForKind(kind, appDefaults, defaultPreset);
    const override = libraryOverrides?.[kind];
    resolved[kind] = override ? { ...base, ...override } : { ...base };
  }

  return resolved;
}
