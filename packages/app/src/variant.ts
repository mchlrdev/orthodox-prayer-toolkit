export type ActiveVariant = { lang: string; variant: string };

export function variantKey(v: ActiveVariant): string {
  return `${v.lang}::${v.variant}`;
}

export function sameVariant(a: ActiveVariant, b: ActiveVariant): boolean {
  return a.lang === b.lang && a.variant === b.variant;
}

export function parseVariantKey(value: string): ActiveVariant | null {
  const [lang, variant] = value.split("::");
  if (!lang || !variant) return null;
  return { lang, variant };
}

export function variantLabel(v: ActiveVariant): string {
  return `${v.lang} / ${v.variant}`;
}

/** Drop columns whose variants no longer exist; fall back to a valid pick. */
export function reconcileVisibleVariants(
  columns: ActiveVariant[],
  prayerVariants: { lang: string; variant: string }[],
  fallback: ActiveVariant | null,
): ActiveVariant[] {
  const next = columns.filter((col) =>
    prayerVariants.some((v) => sameVariant(v, col)),
  );
  if (next.length > 0) return next;
  if (fallback && prayerVariants.some((v) => sameVariant(v, fallback))) {
    return [fallback];
  }
  const first = prayerVariants[0];
  return first ? [{ lang: first.lang, variant: first.variant }] : [];
}
