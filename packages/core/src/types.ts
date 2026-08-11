import type { InlineContent } from "./textRuns.js";

export type { InlineContent, TextRun } from "./textRuns.js";

/** Canonical prayer document (model A — shared structure, per-block translations). */
export type Prayer = {
  id: string;
  type: string;
  book?: string;
  occasion?: string;
  tone?: number | null;
  /** Short summary of the prayer (not language-specific). */
  description?: string;
  variants: VariantMeta[];
  structure: Block[];
  meta?: {
    custom?: Record<string, string | number | boolean | null>;
  };
};

export type VariantMeta = {
  lang: string;
  variant: string;
  title: string;
  license: string;
  source: string;
};

export type Block = {
  id: string;
  kind: string;
  translations: Translation[];
};

/** Text payload: text-based kinds use `text`; verse uses `lines`. */
export type Translation = {
  lang: string;
  variant: string;
  /** Plain string or runs when inline notes are present. */
  text?: InlineContent;
  /** Each line is plain string or runs when inline notes are present. */
  lines?: InlineContent[];
};

/** Flat single-variant export for downstream consumers. */
export type FlatPrayer = {
  id: string;
  title: string;
  type: string;
  lang: string;
  variant: string;
  book?: string;
  occasion?: string;
  tone?: number | null;
  description?: string;
  license: string;
  source: string;
  structure: FlatBlock[];
  meta?: Prayer["meta"];
};

export type FlatBlock = {
  id: string;
  kind: string;
  text?: InlineContent;
  lines?: InlineContent[];
};

export type KindStyle = {
  fontSize: string;
  color: string;
  fontWeight: string;
  fontStyle: string;
  /** When `"true"`, the first letter uses Accent (liturgical initial). */
  initialCap?: string;
  /** Preferred HTML element for this kind when exporting HTML. */
  htmlTag?: string;
  [extra: string]: string | undefined;
};

export type StyleMap = Record<string, KindStyle>;

export type ValidationError = {
  path: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; prayer: Prayer }
  | { ok: false; errors: ValidationError[] };

export type LibraryManifest = {
  description?: string;
  defaultVariant?: {
    lang: string;
    variant: string;
  };
  /**
   * Style-name prefix stem for Layout export (without trailing `_`).
   * Empty/absent → app constant `opt` at resolution time.
   */
  stylePrefixStem?: string;
};

export type IdCollision = {
  id: string;
  paths: string[];
};

/** Recommended kind presets for the editor (not a schema enum). */
export const KIND_PRESETS = [
  "heading",
  "subheading",
  "annotation",
  "verse",
] as const;

export type KindPreset = (typeof KIND_PRESETS)[number];
