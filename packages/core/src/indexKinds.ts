import type { Prayer } from "./types.js";

export type IndexedVariant = {
  lang: string;
  variant: string;
};

/**
 * Union of all `kind` strings across a set of prayers, sorted.
 */
export function indexKinds(prayers: Iterable<Prayer>): string[] {
  const kinds = new Set<string>();
  for (const prayer of prayers) {
    for (const block of prayer.structure) {
      kinds.add(block.kind);
    }
  }
  return [...kinds].sort((a, b) => a.localeCompare(b));
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

/**
 * Rename a kind within a single prayer (does not touch other prayers).
 * Returns a new prayer object; input is not mutated.
 */
export function renameKind(
  prayer: Prayer,
  from: string,
  to: string,
): Prayer {
  if (from === to) return prayer;
  return {
    ...prayer,
    structure: prayer.structure.map((block) =>
      block.kind === from ? { ...block, kind: to } : block,
    ),
  };
}

/**
 * Remove a kind from a prayer by reassigning its blocks to `fallback`.
 * Returns a new prayer object; input is not mutated.
 */
export function deleteKind(
  prayer: Prayer,
  kind: string,
  fallback = "verse",
): Prayer {
  const target = kind === fallback ? "annotation" : fallback;
  return {
    ...prayer,
    structure: prayer.structure.map((block) =>
      block.kind === kind ? { ...block, kind: target } : block,
    ),
  };
}
