import type {
  IdCollision,
  IndexedVariant,
  LibraryManifest,
  StyleMap,
  ValidationError,
} from "@orthodox-prayer-toolkit/core";

export type CatalogEntry = {
  path: string;
  id: string | null;
  title: string | null;
  description: string | null;
  valid: boolean;
  errors: ValidationError[];
  filenameMismatch: boolean;
  /** Block kinds in this prayer; empty if not yet scanned. */
  kinds: string[];
  /** From prayer.variants; empty if not yet scanned. */
  variants: IndexedVariant[];
  scanned: boolean;
};

export type LibraryCatalog = {
  root: string;
  entries: CatalogEntry[];
  collisions: IdCollision[];
  /** Union of scanned entry kinds (library style keys stay in libraryStyles). */
  kinds: string[];
  /** Union of scanned entry variants. */
  variants: IndexedVariant[];
  manifest: LibraryManifest | null;
  libraryStyles: StyleMap;
  styleErrors: ValidationError[];
  scanComplete: boolean;
};

export const CATALOG_READ_CHUNK_SIZE = 25;

export type ScanLibraryCatalogOptions = {
  chunkSize?: number;
};
