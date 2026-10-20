import type { Prayer } from "@orthodox-prayer-toolkit/core";
import {
  entryFromPrayer,
  entryFromText,
  recomputeCatalogIndex,
  upsertEntry,
} from "./build";
import type { CatalogEntry, LibraryCatalog } from "./types";

/**
 * Patch one entry from an in-memory prayer. `needsMigration`: the file on
 * disk is still in the old format (default false — e.g. just written).
 */
export function patchCatalogPrayer(
  catalog: LibraryCatalog,
  path: string,
  prayer: Prayer,
  options?: { needsMigration?: boolean },
): LibraryCatalog {
  const preferred = catalog.manifest?.defaultVariant ?? null;
  const entry = entryFromPrayer(
    path,
    prayer,
    preferred,
    options?.needsMigration ?? false,
  );
  return recomputeCatalogIndex({
    ...catalog,
    entries: upsertEntry(catalog.entries, entry),
  });
}

export function removeCatalogPath(
  catalog: LibraryCatalog,
  path: string,
): LibraryCatalog {
  return recomputeCatalogIndex({
    ...catalog,
    entries: catalog.entries.filter((e) => e.path !== path),
  });
}

/** Scanned entries whose prayer uses or declares `kind`. */
export function entriesUsingKind(
  catalog: LibraryCatalog,
  kind: string,
): CatalogEntry[] {
  return catalog.entries.filter((e) => e.scanned && e.kinds.includes(kind));
}

/** Patch one catalog entry from file text (valid or invalid). */
export function patchCatalogText(
  catalog: LibraryCatalog,
  path: string,
  text: string,
): LibraryCatalog {
  const preferred = catalog.manifest?.defaultVariant ?? null;
  const entry = entryFromText(path, text, preferred, catalog.libraryStylesRaw);
  return recomputeCatalogIndex({
    ...catalog,
    entries: upsertEntry(catalog.entries, entry),
  });
}

/**
 * Combine catalogs for the same library root.
 * `overlay` wins when both entries are scanned; `base` fills stubs and extra
 * paths (e.g. a Prayer opened while a scan is still yielding).
 * `omitPaths` are not restored from `base` (renames / deletes).
 */
export function mergeCatalogs(
  overlay: LibraryCatalog,
  base: LibraryCatalog | null,
  options?: { omitPaths?: Iterable<string> },
): LibraryCatalog {
  if (!base || base.root !== overlay.root) return overlay;
  const omit = new Set(options?.omitPaths ?? []);
  let entries = overlay.entries;
  for (const other of base.entries) {
    if (omit.has(other.path)) continue;
    const mine = entries.find((e) => e.path === other.path);
    if (!mine) {
      entries = upsertEntry(entries, other);
    } else if (!mine.scanned && other.scanned) {
      entries = upsertEntry(entries, other);
    }
  }
  return recomputeCatalogIndex({
    ...overlay,
    entries,
    scanComplete: overlay.scanComplete || base.scanComplete,
  });
}
