import type { Prayer } from "./types.js";

export type PreferredVariant = {
  lang: string;
  variant: string;
};

/**
 * Human-facing title for lists and headers.
 * Prefers `preferred` (e.g. library defaultVariant or active column) when present;
 * otherwise the first configured variant. Falls back to `id`.
 */
export function resolveDisplayTitle(
  prayer: Pick<Prayer, "id" | "variants">,
  preferred?: PreferredVariant | null,
): string {
  if (preferred) {
    const match = prayer.variants.find(
      (v) => v.lang === preferred.lang && v.variant === preferred.variant,
    );
    if (match?.title) return match.title;
  }
  const first = prayer.variants[0];
  return first?.title || prayer.id;
}
