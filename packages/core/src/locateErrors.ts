import type { Prayer, ValidationError } from "./types.js";

/** Where in a prayer a validation error points, for UI markers. */
export type ValidationErrorLocation = {
  error: ValidationError;
  /** Block the error belongs to (`/structure/{i}/…`), when it resolves. */
  blockId: string | null;
  /** Translation (column) inside that block, when the path names one. */
  variant: { lang: string; variant: string } | null;
};

const STRUCTURE_PATH = /^\/structure\/(\d+)(?:\/translations\/(\d+))?(?:\/|$)/;

/**
 * Map JSON-pointer error paths from {@link validate} onto block ids and
 * translation variants of `prayer`. Errors outside `structure` (id, variants,
 * meta …) get `blockId: null`.
 */
export function locateValidationErrors(
  prayer: Prayer,
  errors: ValidationError[],
): ValidationErrorLocation[] {
  return errors.map((error) => {
    const match = STRUCTURE_PATH.exec(error.path);
    if (!match) return { error, blockId: null, variant: null };
    const block = prayer.structure?.[Number(match[1])];
    if (!block || typeof block.id !== "string") {
      return { error, blockId: null, variant: null };
    }
    const tr =
      match[2] !== undefined
        ? block.translations?.[Number(match[2])]
        : undefined;
    const variant =
      tr && typeof tr.lang === "string" && typeof tr.variant === "string"
        ? { lang: tr.lang, variant: tr.variant }
        : null;
    return { error, blockId: block.id, variant };
  });
}
