import {
  isAllowedHtmlTag,
  isAllowedWrapperTag,
} from "@orthodox-prayer-toolkit/core";

const STORAGE_KEY = "orthodox-prayer-toolkit.export-prefs";

/** HTML-specific fields remembered after a successful HTML export. */
export type HtmlExportPrefs = {
  tagMap: Record<string, string>;
  wrapperEnabled: boolean;
  wrapperTag: string;
  wrapperAttributes: string;
};

export type LayoutFormat = "docx" | "rtf";

/** Per-prayer export preferences (cross-format + format-specific). */
export type ExportPrefs = {
  includeBlocksWithoutTranslation?: boolean;
  tagMap?: Record<string, string>;
  wrapperEnabled?: boolean;
  wrapperTag?: string;
  wrapperAttributes?: string;
  layoutFormat?: LayoutFormat;
  /** Empty string means bare kind names (no prefix). */
  layoutPrefixStem?: string;
};

/** Fields written on a successful export; merged onto existing prefs. */
export type ExportPrefsPatch = {
  includeBlocksWithoutTranslation: boolean;
  html?: HtmlExportPrefs;
  layout?: {
    layoutFormat: LayoutFormat;
    layoutPrefixStem: string;
  };
};

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

function isPrefs(value: unknown): value is ExportPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;

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

  const hasHtmlKeys =
    p.tagMap !== undefined ||
    p.wrapperEnabled !== undefined ||
    p.wrapperTag !== undefined ||
    p.wrapperAttributes !== undefined;
  if (hasHtmlKeys && !hasValidHtmlFields(p)) return false;

  return (
    p.includeBlocksWithoutTranslation !== undefined ||
    hasHtmlKeys ||
    p.layoutFormat !== undefined ||
    p.layoutPrefixStem !== undefined
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
 * Merge a successful-export patch into per-prayer prefs.
 * Always writes include-empty; HTML/Layout fields only when provided in the patch.
 */
export function saveExportPrefs(
  libraryRoot: string,
  path: string,
  patch: ExportPrefsPatch,
): void {
  const store = readStore();
  const existing = store[libraryRoot]?.[path] ?? {};
  const next: ExportPrefs = clonePrefs(existing);
  next.includeBlocksWithoutTranslation = patch.includeBlocksWithoutTranslation;

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

  const byPath = { ...(store[libraryRoot] ?? {}) };
  byPath[path] = next;
  store[libraryRoot] = byPath;
  writeStore(store);
}
