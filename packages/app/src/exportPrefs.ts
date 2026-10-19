import {
  isAllowedHtmlTag,
  isAllowedWrapperTag,
} from "@orthodox-prayer-toolkit/core";
import type { ActiveVariant } from "./variant";

const STORAGE_KEY = "orthodox-prayer-toolkit.export-prefs";

export type ExportFormat = "flat-json" | "html" | "layout" | "docx-parallel";

/** HTML-specific fields remembered with the rest of the Export form. */
export type HtmlExportPrefs = {
  tagMap: Record<string, string>;
  wrapperEnabled: boolean;
  wrapperTag: string;
  wrapperAttributes: string;
};

export type LayoutFormat = "docx" | "rtf";

export type SpeakerPlacement = "inline" | "column" | "off";
export type ParallelSpeakerPlacement =
  | "inline-left"
  | "inline-both"
  | "column"
  | "off";
export type SpeakerForm = "name" | "short";

const EXPORT_FORMATS: readonly string[] = [
  "flat-json",
  "html",
  "layout",
  "docx-parallel",
];
const SINGLE_PLACEMENTS: readonly string[] = ["inline", "column", "off"];
const PARALLEL_PLACEMENTS: readonly string[] = [
  "inline-left",
  "inline-both",
  "column",
  "off",
];

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && EXPORT_FORMATS.includes(value);
}

/** Per-prayer export preferences (cross-format + format-specific). */
export type ExportPrefs = {
  format?: ExportFormat;
  variant?: ActiveVariant;
  includeBlocksWithoutTranslation?: boolean;
  tagMap?: Record<string, string>;
  wrapperEnabled?: boolean;
  wrapperTag?: string;
  wrapperAttributes?: string;
  layoutFormat?: LayoutFormat;
  /** Empty string means bare kind names (no prefix). */
  layoutPrefixStem?: string;
  parallelLeft?: ActiveVariant;
  parallelRight?: ActiveVariant;
  parallelGutterColumn?: boolean;
  /** Empty column after Speaker when Word table Placement is Own column. */
  parallelSpeakerGutterColumn?: boolean;
  /** Placement for HTML / Layout exports. */
  speakerPlacement?: SpeakerPlacement;
  /** Placement for the Word table (different value set). */
  speakerParallelPlacement?: ParallelSpeakerPlacement;
  speakerForm?: SpeakerForm;
  /** Raw separator string (e.g. ": ", ". ", ""). */
  speakerSeparator?: string;
};

/** Fields written on export or dialog close; merged onto existing prefs. */
export type ExportPrefsPatch = {
  format?: ExportFormat;
  variant?: ActiveVariant;
  includeBlocksWithoutTranslation?: boolean;
  html?: HtmlExportPrefs;
  layout?: {
    layoutFormat: LayoutFormat;
    layoutPrefixStem: string;
  };
  parallel?: {
    left?: ActiveVariant;
    right?: ActiveVariant;
    gutterColumn?: boolean;
    speakerGutterColumn?: boolean;
  };
  speakers?: {
    placement?: SpeakerPlacement;
    parallelPlacement?: ParallelSpeakerPlacement;
    form: SpeakerForm;
    separator: string;
  };
};

/** Current Export dialog fields — persist the whole form, not a format slice. */
export type ExportFormFields = {
  format: ExportFormat;
  variant?: ActiveVariant | null;
  includeBlocksWithoutTranslation: boolean;
  html: HtmlExportPrefs;
  layout: {
    layoutFormat: LayoutFormat;
    layoutPrefixStem: string;
  };
  parallelLeft?: ActiveVariant | null;
  parallelRight?: ActiveVariant | null;
  gutterColumn: boolean;
  speakerGutterColumn: boolean;
  speakers: {
    placement: SpeakerPlacement;
    parallelPlacement: ParallelSpeakerPlacement;
    form: SpeakerForm;
    separator: string;
  };
};

/** Full-form patch so switching format does not drop the other families' fields. */
export function exportPrefsPatchFromForm(
  form: ExportFormFields,
): ExportPrefsPatch {
  return {
    format: form.format,
    variant: form.variant ?? undefined,
    includeBlocksWithoutTranslation: form.includeBlocksWithoutTranslation,
    html: {
      tagMap: { ...form.html.tagMap },
      wrapperEnabled: form.html.wrapperEnabled,
      wrapperTag: form.html.wrapperTag,
      wrapperAttributes: form.html.wrapperAttributes,
    },
    layout: { ...form.layout },
    parallel: {
      ...(form.parallelLeft ? { left: form.parallelLeft } : {}),
      ...(form.parallelRight ? { right: form.parallelRight } : {}),
      gutterColumn: form.gutterColumn,
      speakerGutterColumn: form.speakerGutterColumn,
    },
    speakers: { ...form.speakers },
  };
}

type PrefsStore = Record<string, Record<string, ExportPrefs>>;

function isTagMap(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([kind, tag]) =>
      typeof kind === "string" &&
      typeof tag === "string" &&
      isAllowedHtmlTag(tag),
  );
}

function hasValidHtmlFields(p: Record<string, unknown>): boolean {
  return (
    isTagMap(p.tagMap) &&
    typeof p.wrapperEnabled === "boolean" &&
    typeof p.wrapperTag === "string" &&
    isAllowedWrapperTag(p.wrapperTag) &&
    typeof p.wrapperAttributes === "string"
  );
}

function isLayoutFormat(value: unknown): value is LayoutFormat {
  return value === "docx" || value === "rtf";
}

function isVariantRef(value: unknown): value is ActiveVariant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.lang === "string" &&
    v.lang.length > 0 &&
    typeof v.variant === "string" &&
    v.variant.length > 0
  );
}

function isPrefs(value: unknown): value is ExportPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;

  if (p.format !== undefined && !isExportFormat(p.format)) {
    return false;
  }
  if (p.variant !== undefined && !isVariantRef(p.variant)) {
    return false;
  }
  if (
    p.includeBlocksWithoutTranslation !== undefined &&
    typeof p.includeBlocksWithoutTranslation !== "boolean"
  ) {
    return false;
  }
  if (p.layoutFormat !== undefined && !isLayoutFormat(p.layoutFormat)) {
    return false;
  }
  if (
    p.layoutPrefixStem !== undefined &&
    typeof p.layoutPrefixStem !== "string"
  ) {
    return false;
  }
  if (p.parallelLeft !== undefined && !isVariantRef(p.parallelLeft)) {
    return false;
  }
  if (p.parallelRight !== undefined && !isVariantRef(p.parallelRight)) {
    return false;
  }
  if (
    p.parallelGutterColumn !== undefined &&
    typeof p.parallelGutterColumn !== "boolean"
  ) {
    return false;
  }
  if (
    p.parallelSpeakerGutterColumn !== undefined &&
    typeof p.parallelSpeakerGutterColumn !== "boolean"
  ) {
    return false;
  }

  if (
    p.speakerPlacement !== undefined &&
    !SINGLE_PLACEMENTS.includes(p.speakerPlacement as string)
  ) {
    return false;
  }
  if (
    p.speakerParallelPlacement !== undefined &&
    !PARALLEL_PLACEMENTS.includes(p.speakerParallelPlacement as string)
  ) {
    return false;
  }
  if (
    p.speakerForm !== undefined &&
    p.speakerForm !== "name" &&
    p.speakerForm !== "short"
  ) {
    return false;
  }
  if (
    p.speakerSeparator !== undefined &&
    typeof p.speakerSeparator !== "string"
  ) {
    return false;
  }

  const hasHtmlKeys =
    p.tagMap !== undefined ||
    p.wrapperEnabled !== undefined ||
    p.wrapperTag !== undefined ||
    p.wrapperAttributes !== undefined;
  if (hasHtmlKeys && !hasValidHtmlFields(p)) return false;

  return (
    p.format !== undefined ||
    p.variant !== undefined ||
    p.includeBlocksWithoutTranslation !== undefined ||
    hasHtmlKeys ||
    p.layoutFormat !== undefined ||
    p.layoutPrefixStem !== undefined ||
    p.parallelLeft !== undefined ||
    p.parallelRight !== undefined ||
    p.parallelGutterColumn !== undefined ||
    p.parallelSpeakerGutterColumn !== undefined ||
    p.speakerPlacement !== undefined ||
    p.speakerParallelPlacement !== undefined ||
    p.speakerForm !== undefined ||
    p.speakerSeparator !== undefined
  );
}

function readStore(): PrefsStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const store: PrefsStore = {};
    for (const [root, prayers] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!prayers || typeof prayers !== "object" || Array.isArray(prayers)) {
        continue;
      }
      const byPath: Record<string, ExportPrefs> = {};
      for (const [path, prefs] of Object.entries(
        prayers as Record<string, unknown>,
      )) {
        if (isPrefs(prefs)) byPath[path] = prefs;
      }
      if (Object.keys(byPath).length > 0) store[root] = byPath;
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: PrefsStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota / private mode — ignore; export prefs are best-effort UX.
  }
}

function clonePrefs(prefs: ExportPrefs): ExportPrefs {
  const next: ExportPrefs = {};
  if (prefs.format !== undefined) next.format = prefs.format;
  if (prefs.variant !== undefined) next.variant = { ...prefs.variant };
  if (prefs.includeBlocksWithoutTranslation !== undefined) {
    next.includeBlocksWithoutTranslation =
      prefs.includeBlocksWithoutTranslation;
  }
  if (prefs.tagMap !== undefined) next.tagMap = { ...prefs.tagMap };
  if (prefs.wrapperEnabled !== undefined) {
    next.wrapperEnabled = prefs.wrapperEnabled;
  }
  if (prefs.wrapperTag !== undefined) next.wrapperTag = prefs.wrapperTag;
  if (prefs.wrapperAttributes !== undefined) {
    next.wrapperAttributes = prefs.wrapperAttributes;
  }
  if (prefs.layoutFormat !== undefined) next.layoutFormat = prefs.layoutFormat;
  if (prefs.layoutPrefixStem !== undefined) {
    next.layoutPrefixStem = prefs.layoutPrefixStem;
  }
  if (prefs.parallelLeft !== undefined) {
    next.parallelLeft = { ...prefs.parallelLeft };
  }
  if (prefs.parallelRight !== undefined) {
    next.parallelRight = { ...prefs.parallelRight };
  }
  if (prefs.parallelGutterColumn !== undefined) {
    next.parallelGutterColumn = prefs.parallelGutterColumn;
  }
  if (prefs.parallelSpeakerGutterColumn !== undefined) {
    next.parallelSpeakerGutterColumn = prefs.parallelSpeakerGutterColumn;
  }
  if (prefs.speakerPlacement !== undefined) {
    next.speakerPlacement = prefs.speakerPlacement;
  }
  if (prefs.speakerParallelPlacement !== undefined) {
    next.speakerParallelPlacement = prefs.speakerParallelPlacement;
  }
  if (prefs.speakerForm !== undefined) next.speakerForm = prefs.speakerForm;
  if (prefs.speakerSeparator !== undefined) {
    next.speakerSeparator = prefs.speakerSeparator;
  }
  return next;
}

export function loadExportPrefs(
  libraryRoot: string,
  path: string,
): ExportPrefs | null {
  const prefs = readStore()[libraryRoot]?.[path];
  return prefs ? clonePrefs(prefs) : null;
}

/**
 * Merge a patch into per-prayer prefs.
 * Format, variant, include-empty, HTML, Layout, and Word-table fields only
 * when provided — a Word-table close must not drop earlier HTML prefs.
 */
export function saveExportPrefs(
  libraryRoot: string,
  path: string,
  patch: ExportPrefsPatch,
): void {
  const store = readStore();
  const existing = store[libraryRoot]?.[path] ?? {};
  const next: ExportPrefs = clonePrefs(existing);
  if (patch.format !== undefined) next.format = patch.format;
  if (patch.variant !== undefined) next.variant = { ...patch.variant };
  if (patch.includeBlocksWithoutTranslation !== undefined) {
    next.includeBlocksWithoutTranslation = patch.includeBlocksWithoutTranslation;
  }

  if (patch.html) {
    next.tagMap = { ...patch.html.tagMap };
    next.wrapperEnabled = patch.html.wrapperEnabled;
    next.wrapperTag = patch.html.wrapperTag;
    next.wrapperAttributes = patch.html.wrapperAttributes;
  }

  if (patch.layout) {
    next.layoutFormat = patch.layout.layoutFormat;
    next.layoutPrefixStem = patch.layout.layoutPrefixStem;
  }

  if (patch.parallel) {
    if (patch.parallel.left !== undefined) {
      next.parallelLeft = { ...patch.parallel.left };
    }
    if (patch.parallel.right !== undefined) {
      next.parallelRight = { ...patch.parallel.right };
    }
    if (patch.parallel.gutterColumn !== undefined) {
      next.parallelGutterColumn = patch.parallel.gutterColumn;
    }
    if (patch.parallel.speakerGutterColumn !== undefined) {
      next.parallelSpeakerGutterColumn = patch.parallel.speakerGutterColumn;
    }
  }

  if (patch.speakers) {
    if (patch.speakers.placement !== undefined) {
      next.speakerPlacement = patch.speakers.placement;
    }
    if (patch.speakers.parallelPlacement !== undefined) {
      next.speakerParallelPlacement = patch.speakers.parallelPlacement;
    }
    next.speakerForm = patch.speakers.form;
    next.speakerSeparator = patch.speakers.separator;
  }

  const byPath = { ...(store[libraryRoot] ?? {}) };
  byPath[path] = next;
  store[libraryRoot] = byPath;
  writeStore(store);
}
