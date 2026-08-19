import {
  isLibraryManifest,
  isPrayerFilename,
  normalizeLibraryManifest,
  sanitizeStyles,
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

async function loadStyles(
  root: string,
  api: PrayerToolkitApi,
): Promise<{ libraryStyles: StyleMap; styleErrors: ValidationError[] }> {
  let libraryStyles: StyleMap = {};
  let styleErrors: ValidationError[] = [];
  const stylesRaw = await api.readLibraryStyles(root);
  if (stylesRaw) {
    const parsed = parseJsonSafe(stylesRaw);
    if (parsed !== null) {
      const sanitized = sanitizeStyles(parsed);
      libraryStyles = sanitized.styles;
      styleErrors = sanitized.errors;
    } else {
      styleErrors = [{ path: "/", message: "Invalid styles JSON" }];
    }
  }
  return { libraryStyles, styleErrors };
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
  const { libraryStyles, styleErrors } = await loadStyles(root, api);
  const preferred = manifest?.defaultVariant ?? null;
  const prayerFiles = files.filter(isPrayerFilename);

  const shell = {
    root,
    manifest,
    libraryStyles,
    styleErrors,
  };

  if (prayerFiles.length === 0) {
    yield recomputeCatalogIndex({
      ...shell,
      entries: [],
      collisions: [],
      kinds: [],
      variants: [],
      scanComplete: true,
    });
    return;
  }

  let catalog = recomputeCatalogIndex({
    ...shell,
    entries: prayerFiles.map(stubEntry),
    collisions: [],
    kinds: [],
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
      entries = upsertEntry(entries, entryFromText(path, text, preferred));
    }
    catalog = recomputeCatalogIndex({
      ...shell,
      entries,
      collisions: [],
      kinds: [],
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
  const entry = entryFromText(path, text, preferred);
  return recomputeCatalogIndex({
    ...catalog,
    entries: upsertEntry(catalog.entries, entry),
    scanComplete: catalog.scanComplete,
  });
}
