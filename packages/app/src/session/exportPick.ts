import type { Prayer } from "@orthodox-prayer-toolkit/core";
import type { ActiveVariant } from "../variant";

/** Prefill for the export modal: library default when present, else first variant. */
export function pickExportVariant(
  prayer: Prayer,
  libraryDefault: { lang: string; variant: string } | undefined,
): ActiveVariant | null {
  const match = libraryDefault
    ? prayer.variants.find(
        (v) =>
          v.lang === libraryDefault.lang &&
          v.variant === libraryDefault.variant,
      )
    : undefined;
  const pick = match ?? prayer.variants[0];
  return pick ? { lang: pick.lang, variant: pick.variant } : null;
}
