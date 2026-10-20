import {
  filenameMatchesId,
  findIdCollisions,
  indexKinds,
  indexVariants,
  migratePrayer,
  rawPrayerKinds,
  resolveDisplayTitle,
  validate,
  type IndexedVariant,
  type Prayer,
  type PreferredVariant,
  type ValidationResult,
} from "@orthodox-prayer-toolkit/core";
import type { CatalogEntry, LibraryCatalog } from "./types";

/** Prayer `id` pattern from the schema — used for stub ids from filenames. */
const PRAYER_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseJsonSafe(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export type ReadPrayer =
  | { json: false }
  | {
      json: true;
      /** JSON as on disk (before migration). */
      data: unknown;
      /** Migration changed the prayer: the file is in the old format. */
      migrated: boolean;
      /** Validation of the migrated prayer. */
      result: ValidationResult;
    };

/**
 * Read prayer file text the way the app opens it: parse, migrate in memory
 * with the raw library `styles.json` (legacy speaker tokens), then validate.
 * Old files therefore open; disk bytes stay untouched.
 */
export function readPrayerText(text: string, rawStyles: unknown): ReadPrayer {
  const data = parseJsonSafe(text);
  if (data === null) return { json: false };
  const { prayer, changed } = migratePrayer(data as Prayer, {
    styles: rawStyles,
  });
  return { json: true, data, migrated: changed, result: validate(prayer) };
}

export function stubIdFromPath(path: string): string | null {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? path;
  if (!base.endsWith(".json")) return null;
  const stem = base.slice(0, -".json".length);
  return PRAYER_ID_RE.test(stem) ? stem : null;
}

export function stubEntry(path: string): CatalogEntry {
  return {
    path,
    id: stubIdFromPath(path),
    title: null,
    description: null,
    valid: true,
    errors: [],
    filenameMismatch: false,
    kinds: [],
    readable: true,
    needsMigration: false,
    variants: [],
    scanned: false,
  };
}

function stringId(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("id" in data)) {
    return null;
  }
  return typeof data.id === "string" ? data.id : null;
}

export function entryFromPrayer(
  path: string,
  prayer: Prayer,
  preferred: PreferredVariant | null,
  needsMigration = false,
): CatalogEntry {
  return {
    path,
    id: prayer.id,
    title: resolveDisplayTitle(prayer, preferred),
    description: prayer.description ?? null,
    valid: true,
    errors: [],
    filenameMismatch: !filenameMatchesId(path, prayer.id),
    kinds: indexKinds([prayer]),
    readable: true,
    needsMigration,
    variants: indexVariants([prayer]),
    scanned: true,
  };
}

export function entryFromText(
  path: string,
  text: string,
  preferred: PreferredVariant | null,
  rawStyles: unknown,
): CatalogEntry {
  const read = readPrayerText(text, rawStyles);
  if (!read.json) {
    return {
      path,
      id: null,
      title: null,
      description: null,
      valid: false,
      errors: [{ path: "/", message: "Invalid JSON" }],
      filenameMismatch: false,
      kinds: [],
      readable: false,
      needsMigration: false,
      variants: [],
      scanned: true,
    };
  }

  const { data, result } = read;
  if (!result.ok) {
    const maybeId = stringId(data);
    return {
      path,
      id: maybeId,
      title: null,
      description: null,
      valid: false,
      errors: result.errors,
      filenameMismatch: maybeId ? !filenameMatchesId(path, maybeId) : false,
      kinds: rawPrayerKinds(data),
      readable: true,
      needsMigration: read.migrated,
      variants: [],
      scanned: true,
    };
  }

  return entryFromPrayer(path, result.prayer, preferred, read.migrated);
}

export function upsertEntry(
  entries: CatalogEntry[],
  entry: CatalogEntry,
): CatalogEntry[] {
  const index = entries.findIndex((e) => e.path === entry.path);
  if (index === -1) return [...entries, entry];
  const next = entries.slice();
  next[index] = entry;
  return next;
}

function sortEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort((a, b) =>
    (a.id ?? a.path).localeCompare(b.id ?? b.path),
  );
}

function unionVariants(entries: CatalogEntry[]): IndexedVariant[] {
  const seen = new Map<string, IndexedVariant>();
  for (const entry of entries) {
    if (!entry.scanned) continue;
    for (const variant of entry.variants) {
      const key = `${variant.lang}::${variant.variant}`;
      if (!seen.has(key)) seen.set(key, variant);
    }
  }
  return [...seen.values()].sort(
    (a, b) =>
      a.lang.localeCompare(b.lang) || a.variant.localeCompare(b.variant),
  );
}

export function recomputeCatalogIndex(
  catalog: LibraryCatalog,
): LibraryCatalog {
  const entries = sortEntries(catalog.entries);
  return {
    ...catalog,
    entries,
    collisions: findIdCollisions(
      entries.map((e) => ({ path: e.path, id: e.id })),
    ),
    variants: unionVariants(entries),
  };
}
