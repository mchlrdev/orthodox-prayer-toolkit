import type {
  IdCollision,
  IndexedVariant,
  KindTemplate,
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
  /**
   * Kinds used on blocks or declared in `kinds` (also for files that parse
   * but do not validate); empty if not yet scanned or not JSON.
   */
  kinds: string[];
  /** The file is JSON. False: invalid JSON — its kinds are unknown. */
  readable: boolean;
  /**
   * The file on disk is in the old format (undeclared custom kinds); it was
   * migrated in memory on read. Writing it (save / library migration) clears it.
   */
  needsMigration: boolean;
  /** From prayer.variants; empty if not yet scanned. */
  variants: IndexedVariant[];
  scanned: boolean;
};

export type LibraryCatalog = {
  root: string;
  entries: CatalogEntry[];
  collisions: IdCollision[];
  /** Union of scanned entry variants. */
  variants: IndexedVariant[];
  manifest: LibraryManifest | null;
  libraryStyles: StyleMap;
  styleErrors: ValidationError[];
  /**
   * Parsed `styles.json` as on disk (may still hold legacy `speaker` tokens
   * that migration needs): `undefined` = no file, `null` = not JSON (the app
   * then refuses to rewrite it).
   */
  libraryStylesRaw: unknown;
  /** Kind templates from `templates.json` (sanitized). */
  templates: KindTemplate[];
  /** Problems in `templates.json`; while non-empty the app does not rewrite it. */
  templateErrors: ValidationError[];
  /**
   * Parsed `templates.json` as on disk: `undefined` = no file, `null` = not
   * JSON. Passed to Core `planLibraryMigration`.
   */
  templatesRaw: unknown;
  scanComplete: boolean;
};

export const CATALOG_READ_CHUNK_SIZE = 25;

export type ScanLibraryCatalogOptions = {
  chunkSize?: number;
};
