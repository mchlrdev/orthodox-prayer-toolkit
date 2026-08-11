import type { Prayer } from "@orthodox-prayer-toolkit/core";
import { loadPrayerView } from "../viewPrefs";
import {
  reconcileVisibleVariants,
  type ActiveVariant,
} from "../variant";

export function pickDefaultVariant(
  prayer: Prayer,
  preferred: { lang: string; variant: string } | undefined,
): ActiveVariant[] {
  const first = prayer.variants[0];
  const match = preferred
    ? prayer.variants.find(
        (v) => v.lang === preferred.lang && v.variant === preferred.variant,
      )
    : undefined;
  const pick = match ?? first;
  return pick ? [{ lang: pick.lang, variant: pick.variant }] : [];
}

/** Restore last columns for this prayer, else library/default pick. */
export function resolveVisibleVariants(
  prayer: Prayer,
  libraryRoot: string,
  path: string,
  preferred: { lang: string; variant: string } | undefined,
): ActiveVariant[] {
  const saved = loadPrayerView(libraryRoot, path);
  if (saved) {
    const reconciled = reconcileVisibleVariants(saved, prayer.variants, null);
    if (reconciled.length > 0) return reconciled;
  }
  return pickDefaultVariant(prayer, preferred);
}
