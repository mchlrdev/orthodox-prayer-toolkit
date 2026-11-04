import {
  normalizeVariantMeta,
  type Prayer,
  type VariantMeta,
} from "@orthodox-prayer-toolkit/core";

function sameMeta(a: VariantMeta, b: VariantMeta): boolean {
  return (
    a.lang === b.lang &&
    a.variant === b.variant &&
    a.title === b.title &&
    a.license === b.license &&
    a.source === b.source &&
    a.rtl === b.rtl &&
    a.speakers === b.speakers
  );
}

/**
 * Patch one Variant's metadata. When language or edition changes, retarget
 * matching Block translations so the editor column keeps its text.
 */
export function patchVariantMeta(
  prayer: Prayer,
  index: number,
  patch: Partial<VariantMeta>,
): Prayer {
  const current = prayer.variants[index];
  if (!current) return prayer;
  const nextMeta = normalizeVariantMeta({ ...current, ...patch });
  if (sameMeta(current, nextMeta)) return prayer;
  const variants = prayer.variants.map((v, i) => (i === index ? nextMeta : v));
  const identityChanged =
    current.lang !== nextMeta.lang || current.variant !== nextMeta.variant;
  if (!identityChanged) {
    return { ...prayer, variants };
  }
  const structure = prayer.structure.map((block) => {
    let changed = false;
    const translations = block.translations.map((t) => {
      if (t.lang !== current.lang || t.variant !== current.variant) return t;
      changed = true;
      return { ...t, lang: nextMeta.lang, variant: nextMeta.variant };
    });
    return changed ? { ...block, translations } : block;
  });
  return { ...prayer, variants, structure };
}
