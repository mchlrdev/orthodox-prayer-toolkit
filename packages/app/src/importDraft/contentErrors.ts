import {
  validate,
  type Prayer,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";

/**
 * Errors of the draft's content alone: the metadata the Save dialog asks
 * for (id, title, licence, source) is filled with placeholders.
 */
export function importContentErrors(prayer: Prayer): ValidationError[] {
  const filled: Prayer = {
    ...prayer,
    id: prayer.id || "draft",
    type: prayer.type || "prayer",
    variants: prayer.variants.map((v) => ({
      ...v,
      title: v.title || "-",
      license: v.license || "-",
      source: v.source || "-",
    })),
  };
  const result = validate(filled);
  return result.ok ? [] : result.errors;
}
