import type { StyleMap, VariantMeta } from "./types.js";

export type TextDir = "ltr" | "rtl";

/** Kind override in `styles.json`: omit = inherit from the variant. */
export type KindDir = "ltr" | "rtl";

export function isKindDir(value: string | undefined): value is KindDir {
  return value === "ltr" || value === "rtl";
}

/**
 * Effective writing direction for a block.
 * A kind `dir` of `rtl` or `ltr` wins; otherwise the variant flag decides.
 * Missing or false `rtl` on the variant is LTR.
 */
export function resolveDir(
  variantRtl: boolean | undefined,
  kindDir?: string,
): TextDir {
  if (isKindDir(kindDir)) return kindDir;
  return variantRtl === true ? "rtl" : "ltr";
}

export function variantIsRtl(rtl: boolean | undefined): boolean {
  return rtl === true;
}

export function resolveBlockDir(
  variant: Pick<VariantMeta, "rtl">,
  kind: string,
  styles?: StyleMap,
): TextDir {
  return resolveDir(variant.rtl, styles?.[kind]?.dir);
}

/** Drop `rtl` unless it is exactly `true` (LTR editions omit the field). */
export function normalizeVariantMeta<T extends VariantMeta>(meta: T): T {
  if (meta.rtl === true) return meta;
  if (!("rtl" in meta)) return meta;
  const { rtl: _rtl, ...rest } = meta;
  return rest as T;
}

export function normalizePrayerVariants<T extends { variants: VariantMeta[] }>(
  prayer: T,
): T {
  let changed = false;
  const variants = prayer.variants.map((v) => {
    const next = normalizeVariantMeta(v);
    if (next !== v) changed = true;
    return next;
  });
  return changed ? { ...prayer, variants } : prayer;
}
