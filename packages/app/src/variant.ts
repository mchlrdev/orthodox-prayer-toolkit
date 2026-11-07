export type ActiveVariant = { lang: string; variant: string };

export function variantKey(v: ActiveVariant): string {
  return `${v.lang}::${v.variant}`;
}

export function sameVariant(a: ActiveVariant, b: ActiveVariant): boolean {
  return a.lang === b.lang && a.variant === b.variant;
}

export function parseVariantKey(value: string): ActiveVariant | null {
  const at = value.indexOf("::");
  if (at <= 0 || at + 2 >= value.length) return null;
  return { lang: value.slice(0, at), variant: value.slice(at + 2) };
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
  if (next.length > 0) {
    // Keep the same array when nothing dropped, so title-only metadata
    // edits do not look like a column change to the editor.
    if (next.length === columns.length) return columns;
    return next;
  }
  if (fallback && prayerVariants.some((v) => sameVariant(v, fallback))) {
    return [fallback];
  }
  const first = prayerVariants[0];
  return first ? [{ lang: first.lang, variant: first.variant }] : [];
}
