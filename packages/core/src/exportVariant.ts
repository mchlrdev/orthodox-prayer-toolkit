import type { FlatBlock, FlatPrayer, Prayer, Translation } from "./types.js";

export type ExportVariantOptions = {
  lang: string;
  variant: string;
  /**
   * When true, blocks without a translation for the chosen variant are kept
   * as empty slots (`text: ""`). Default / absent: omit them.
   */
  includeBlocksWithoutTranslation?: boolean;
};

function flattenTranslation(tr: Translation): Omit<FlatBlock, "id" | "kind"> {
  const payload: Omit<FlatBlock, "id" | "kind"> = {};
  if (tr.text !== undefined) {
    payload.text = Array.isArray(tr.text) ? [...tr.text] : tr.text;
  }
  if (Array.isArray(tr.lines)) {
    payload.lines = tr.lines.map((line) =>
      Array.isArray(line) ? [...line] : line,
    );
  }
  return payload;
}

/** Empty slot shape from any existing translation on the block; else `text: ""`. */
function emptyPayloadForBlock(
  block: Prayer["structure"][number],
): Omit<FlatBlock, "id" | "kind"> {
  for (const tr of block.translations) {
    if (Array.isArray(tr.lines)) return { lines: [] };
    if (tr.text !== undefined) return { text: "" };
  }
  return { text: "" };
}

/**
 * Export a single language/variant as a flat prayer document.
 * Blocks without a translation for the chosen variant are omitted
 * unless `includeBlocksWithoutTranslation` is true.
 */
export function exportVariant(
  prayer: Prayer,
  options: ExportVariantOptions,
): FlatPrayer {
  const meta = prayer.variants.find(
    (v) => v.lang === options.lang && v.variant === options.variant,
  );
  if (!meta) {
    throw new Error(
      `Variant not found: lang="${options.lang}" variant="${options.variant}"`,
    );
  }

  const includeEmpty = options.includeBlocksWithoutTranslation === true;
  const structure: FlatBlock[] = [];
  for (const block of prayer.structure) {
    const tr = block.translations.find(
      (t) => t.lang === options.lang && t.variant === options.variant,
    );
    if (!tr) {
      if (!includeEmpty) continue;
      structure.push({
        id: block.id,
        kind: block.kind,
        ...emptyPayloadForBlock(block),
      });
      continue;
    }
    structure.push({
      id: block.id,
      kind: block.kind,
      ...flattenTranslation(tr),
    });
  }

  const flat: FlatPrayer = {
    id: prayer.id,
    title: meta.title,
    type: prayer.type,
    lang: options.lang,
    variant: options.variant,
    license: meta.license,
    source: meta.source,
    structure,
  };

  if (prayer.book !== undefined) flat.book = prayer.book;
  if (prayer.occasion !== undefined) flat.occasion = prayer.occasion;
  if (prayer.tone !== undefined) flat.tone = prayer.tone;
  if (prayer.description !== undefined) flat.description = prayer.description;
  if (prayer.meta !== undefined) flat.meta = prayer.meta;

  return flat;
}
