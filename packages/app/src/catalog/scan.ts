import {
  isLibraryManifest,
  isPrayerFilename,
  normalizeLibraryManifest,
  sanitizeStyles,
  sanitizeTemplates,
  type KindTemplate,
  type LibraryManifest,
  type StyleMap,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import {
  entryFromText,
  parseJsonSafe,
  recomputeCatalogIndex,
  stubEntry,
  upsertEntry,
} from "./build";
import {
  CATALOG_READ_CHUNK_SIZE,
  type LibraryCatalog,
  type ScanLibraryCatalogOptions,
} from "./types";

async function loadManifest(
  root: string,
  api: PrayerToolkitApi,
  files: string[],
): Promise<LibraryManifest | null> {
  if (!files.includes("manifest.json")) return null;
  const raw = await api.readText(root, "manifest.json");
  const data = parseJsonSafe(raw);
  if (data && isLibraryManifest(data)) {
    return normalizeLibraryManifest(data);
  }
  return null;
}

export type LibraryStylesState = {
  libraryStyles: StyleMap;
  styleErrors: ValidationError[];
  libraryStylesRaw: unknown;
};

/**
 * Parse `styles.json` text (null = no file); keeps the raw object for
 * migration (`undefined` = no file, `null` = not JSON).
 */
export function parseLibraryStyles(stylesRaw: string | null): LibraryStylesState {
  if (!stylesRaw) {
    return { libraryStyles: {}, styleErrors: [], libraryStylesRaw: undefined };
  }
  const parsed = parseJsonSafe(stylesRaw);
  if (parsed === null) {
    return {
      libraryStyles: {},
      styleErrors: [{ path: "/", message: "Invalid styles JSON" }],
      libraryStylesRaw: null,
    };
  }
  const sanitized = sanitizeStyles(parsed);
  return {
    libraryStyles: sanitized.styles,
    styleErrors: sanitized.errors,
    libraryStylesRaw: parsed,
  };
}

export type LibraryTemplatesState = {
  templates: KindTemplate[];
  templateErrors: ValidationError[];
  templatesRaw: unknown;
};

/** Parse `templates.json` text (null = no file). */
export function parseLibraryTemplates(
  templatesText: string | null,
): LibraryTemplatesState {
  if (templatesText === null) {
    return { templates: [], templateErrors: [], templatesRaw: undefined };
  }
  const parsed = parseJsonSafe(templatesText);
  if (parsed === null) {
    return {
      templates: [],
      templateErrors: [{ path: "/", message: "Invalid templates JSON" }],
      templatesRaw: null,
    };
  }
  const { templates, errors } = sanitizeTemplates(parsed);
  return { templates, templateErrors: errors, templatesRaw: parsed };
}

export async function* scanLibraryCatalog(
  root: string,
  api: PrayerToolkitApi,
  options?: ScanLibraryCatalogOptions,
): AsyncGenerator<LibraryCatalog> {
  const chunkSize = Math.max(
    1,
    options?.chunkSize ?? CATALOG_READ_CHUNK_SIZE,
  );
  const files = await api.listJsonFiles(root);
  const manifest = await loadManifest(root, api, files);
  const styles = parseLibraryStyles(await api.readLibraryStyles(root));
  const templates = parseLibraryTemplates(await api.readLibraryTemplates(root));
  const preferred = manifest?.defaultVariant ?? null;
  const prayerFiles = files.filter(isPrayerFilename);

  const shell = {
    root,
    manifest,
    ...styles,
    ...templates,
  };

  if (prayerFiles.length === 0) {
    yield recomputeCatalogIndex({
      ...shell,
      entries: [],
      collisions: [],
      variants: [],
      scanComplete: true,
    });
    return;
  }

  let catalog = recomputeCatalogIndex({
    ...shell,
    entries: prayerFiles.map(stubEntry),
    collisions: [],
    variants: [],
    scanComplete: false,
  });
  yield catalog;

  const paths = catalog.entries.map((e) => e.path);
  let entries = catalog.entries;

  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    const texts = await api.readTexts(root, chunk);
    const byPath = new Map(texts.map((row) => [row.path, row.text]));
    for (const path of chunk) {
      const text = byPath.get(path);
      if (text === undefined) {
        throw new Error(`readTexts omitted ${path}`);
      }
      entries = upsertEntry(
        entries,
        entryFromText(path, text, preferred, styles.libraryStylesRaw),
      );
    }
    catalog = recomputeCatalogIndex({
      ...shell,
      entries,
      collisions: [],
      variants: [],
      scanComplete: i + chunkSize >= paths.length,
    });
    yield catalog;
  }
}

export async function collectCatalog(
  gen: AsyncIterable<LibraryCatalog>,
): Promise<LibraryCatalog> {
  let last: LibraryCatalog | undefined;
  for await (const catalog of gen) {
    last = catalog;
  }
  if (!last) {
    throw new Error("Library catalog scan produced no result");
  }
  return last;
}

export async function scanCatalogFile(
  catalog: LibraryCatalog,
  api: PrayerToolkitApi,
  path: string,
): Promise<LibraryCatalog> {
  const rows = await api.readTexts(catalog.root, [path]);
  const text = rows[0]?.text;
  if (text === undefined) {
    throw new Error(`Failed to read ${path}`);
  }
  const preferred = catalog.manifest?.defaultVariant ?? null;
  const entry = entryFromText(path, text, preferred, catalog.libraryStylesRaw);
  return recomputeCatalogIndex({
    ...catalog,
    entries: upsertEntry(catalog.entries, entry),
    scanComplete: catalog.scanComplete,
  });
}
