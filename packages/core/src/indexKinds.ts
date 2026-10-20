import { isKindPreset, type Prayer } from "./types.js";
import type { KindTemplate } from "./templates.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type IndexedVariant = {
  lang: string;
  variant: string;
};

/**
 * Union of all kinds across a set of prayers (used on blocks or declared in
 * `kinds`), sorted.
 */
export function indexKinds(prayers: Iterable<Prayer>): string[] {
  const kinds = new Set<string>();
  for (const prayer of prayers) {
    for (const block of prayer.structure) {
      kinds.add(block.kind);
    }
    for (const def of prayer.kinds ?? []) {
      kinds.add(def.id);
    }
  }
  return [...kinds].sort((a, b) => a.localeCompare(b));
}

/** Where a library's kinds come from (all optional). */
export type LibraryKindSources = {
  /** Per prayer: the kinds it uses or declares (e.g. `indexKinds([prayer])`). */
  prayerKinds?: Iterable<Iterable<string>>;
  /** Kind templates (`templates.json`). */
  templates?: Iterable<Pick<KindTemplate, "kinds">>;
  /** Style map or raw `styles.json` object: its keys are kinds. */
  styles?: unknown;
};

function sortedKinds(kinds: Iterable<string>): string[] {
  return [...new Set(kinds)].sort((a, b) => a.localeCompare(b));
}

function styleKinds(styles: unknown): string[] {
  return isPlainObject(styles) ? Object.keys(styles) : [];
}

/** Kinds the library's prayers and templates use or declare (no style keys), sorted. */
export function libraryKindsInUse(sources: LibraryKindSources): string[] {
  const kinds = new Set<string>();
  for (const list of sources.prayerKinds ?? []) {
    for (const kind of list) kinds.add(kind);
  }
  for (const template of sources.templates ?? []) {
    for (const def of template.kinds) kinds.add(def.id);
  }
  return sortedKinds(kinds);
}

/**
 * Every kind the library knows: prayers, templates and style keys, sorted.
 * Feeds the Kind styles list (`resolveStyles` `discoveredKinds`) and the
 * "already exists" check of a library-wide kind rename.
 */
export function discoverKinds(sources: LibraryKindSources): string[] {
  return sortedKinds([
    ...libraryKindsInUse(sources),
    ...styleKinds(sources.styles),
  ]);
}

/**
 * Custom style keys whose kind is in no prayer and no template, sorted.
 * Only meaningful when `prayerKinds` covers every prayer of the library.
 */
export function unusedStyleKeys(sources: LibraryKindSources): string[] {
  const used = new Set(libraryKindsInUse(sources));
  return sortedKinds(
    styleKinds(sources.styles).filter(
      (kind) => !isKindPreset(kind) && !used.has(kind),
    ),
  );
}

/**
 * Best effort on unvalidated prayer JSON: kinds named on `structure` blocks
 * and in `kinds` entries (string values only), sorted. For files that parse
 * but do not validate, so their kinds still count as used.
 */
export function rawPrayerKinds(data: unknown): string[] {
  const kinds = new Set<string>();
  if (!isPlainObject(data)) return [];
  if (Array.isArray(data.structure)) {
    for (const block of data.structure) {
      if (isPlainObject(block) && typeof block.kind === "string") kinds.add(block.kind);
    }
  }
  if (Array.isArray(data.kinds)) {
    for (const def of data.kinds) {
      if (isPlainObject(def) && typeof def.id === "string") kinds.add(def.id);
    }
  }
  return sortedKinds(kinds);
}

/**
 * Unique lang/variant pairs across a set of prayers, sorted by lang then variant.
 */
export function indexVariants(
  prayers: Iterable<Pick<Prayer, "variants">>,
): IndexedVariant[] {
  const seen = new Map<string, IndexedVariant>();
  for (const prayer of prayers) {
    for (const v of prayer.variants) {
      const key = `${v.lang}::${v.variant}`;
      if (!seen.has(key)) {
        seen.set(key, { lang: v.lang, variant: v.variant });
      }
    }
  }
  return [...seen.values()].sort(
    (a, b) =>
      a.lang.localeCompare(b.lang) || a.variant.localeCompare(b.variant),
  );
}
