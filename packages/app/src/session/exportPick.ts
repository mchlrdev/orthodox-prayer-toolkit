import type { Prayer } from "@orthodox-prayer-toolkit/core";
import { sameVariant, type ActiveVariant } from "../variant";

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

function asRef(v: { lang: string; variant: string }): ActiveVariant {
  return { lang: v.lang, variant: v.variant };
}

function existsOnPrayer(prayer: Prayer, col: ActiveVariant): boolean {
  return prayer.variants.some((v) => sameVariant(v, col));
}

function uniqueRefs(cols: ActiveVariant[]): ActiveVariant[] {
  const next: ActiveVariant[] = [];
  for (const col of cols) {
    if (!next.some((v) => sameVariant(v, col))) next.push(col);
  }
  return next;
}

/** First other variant when `taken` is already chosen for the opposite column. */
export function pickOtherExportColumn(
  prayer: Prayer,
  taken: ActiveVariant,
  preferred?: ActiveVariant | null,
): ActiveVariant | null {
  if (
    preferred &&
    !sameVariant(preferred, taken) &&
    existsOnPrayer(prayer, preferred)
  ) {
    return preferred;
  }
  const other = prayer.variants.find((v) => !sameVariant(v, taken));
  return other ? asRef(other) : null;
}

/**
 * Left/right prefill for Word table export: saved pair, else the first two
 * visible editor columns, else library default + another variant.
 */
export function pickExportParallelColumns(
  prayer: Prayer,
  options: {
    libraryDefault?: { lang: string; variant: string };
    visible?: ActiveVariant[];
    saved?: { left: ActiveVariant; right: ActiveVariant } | null;
  } = {},
): [ActiveVariant, ActiveVariant] | null {
  if (prayer.variants.length < 2) return null;

  const saved = options.saved;
  if (
    saved &&
    existsOnPrayer(prayer, saved.left) &&
    existsOnPrayer(prayer, saved.right) &&
    !sameVariant(saved.left, saved.right)
  ) {
    return [saved.left, saved.right];
  }

  const visible = uniqueRefs(
    (options.visible ?? []).filter((col) => existsOnPrayer(prayer, col)),
  );
  if (visible.length >= 2) {
    return [visible[0]!, visible[1]!];
  }

  const left = visible[0] ?? pickExportVariant(prayer, options.libraryDefault);
  if (!left) return null;
  const right = pickOtherExportColumn(prayer, left);
  return right ? [left, right] : null;
}
