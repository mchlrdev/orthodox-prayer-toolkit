import { toRuns, type InlineContent } from "./textRuns.js";
import { paragraphStyleName, styleNameWithPrefix } from "./stylePrefix.js";
import { resolveBlockDir } from "./resolveDir.js";
import type { Prayer, StyleMap, Translation, VariantMeta } from "./types.js";

export type LayoutColumnRef = {
  lang: string;
  variant: string;
};

export type ExportLayoutOptions = {
  lang: string;
  variant: string;
  /**
   * Style-name prefix stem. Empty string → bare `kind` / `note` names.
   * Callers resolve library/prefs chain before passing this.
   */
  prefixStem?: string;
  includeBlocksWithoutTranslation?: boolean;
  /** Resolved kind styles; `dir` on a kind overrides the variant RTL flag. */
  styles?: StyleMap;
};

/** Two variants of the same prayer, aligned on the shared structure. */
export type ExportLayoutParallelOptions = {
  columns: [LayoutColumnRef, LayoutColumnRef];
  prefixStem?: string;
  includeBlocksWithoutTranslation?: boolean;
  styles?: StyleMap;
};

export type LayoutRun = {
  t: "text" | "note";
  v: string;
};

/** One structure block as a single paragraph (soft breaks between lines). */
export type LayoutParagraph = {
  kind: string;
  styleName: string;
  /** Each entry is one visual line; serializers join with soft breaks. */
  lines: LayoutRun[][];
};

export type LayoutStory = {
  /** Character style for inline note runs only. */
  noteStyleName: string;
  paragraphs: LayoutParagraph[];
};

/** One structure block, both column texts, so DOCX can keep them in one table row. */
export type LayoutPairRow = {
  kind: string;
  left: LayoutParagraph;
  right: LayoutParagraph;
};

export type LayoutPairStory = {
  noteStyleName: string;
  rows: LayoutPairRow[];
};

function requireVariant(
  prayer: Prayer,
  lang: string,
  variant: string,
): VariantMeta {
  const meta = prayer.variants.find(
    (v) => v.lang === lang && v.variant === variant,
  );
  if (!meta) {
    throw new Error(`Variant not found: lang="${lang}" variant="${variant}"`);
  }
  return meta;
}

function translationFor(
  block: Prayer["structure"][number],
  lang: string,
  variant: string,
): Translation | null {
  return (
    block.translations.find((t) => t.lang === lang && t.variant === variant) ??
    null
  );
}

function paragraphForBlock(
  block: Prayer["structure"][number],
  meta: VariantMeta,
  tr: Translation | null,
  prefixStem: string,
  styles: StyleMap | undefined,
): LayoutParagraph {
  return {
    kind: block.kind,
    styleName: paragraphStyleName(
      prefixStem,
      block.kind,
      resolveBlockDir(meta, block.kind, styles),
    ),
    lines: linesFromTranslation(tr),
  };
}

function runsFromContent(content: InlineContent): LayoutRun[] {
  return toRuns(content).map((r) => ({ t: r.t, v: r.v }));
}

function linesFromTranslation(tr: Translation | null): LayoutRun[][] {
  if (!tr) return [[]];
  if (Array.isArray(tr.lines)) {
    return tr.lines.map((line) => runsFromContent(line));
  }
  if (tr.text !== undefined) {
    return [runsFromContent(tr.text)];
  }
  return [[]];
}

/**
 * Build the blank-styled Place story model shared by RTF and DOCX serializers.
 */
export function buildLayoutStory(
  prayer: Prayer,
  options: ExportLayoutOptions,
): LayoutStory {
  const { lang, variant } = options;
  const prefixStem = options.prefixStem ?? "";
  const includeEmpty = options.includeBlocksWithoutTranslation === true;
  const styles = options.styles;
  const meta = requireVariant(prayer, lang, variant);
  const noteStyleName = styleNameWithPrefix(prefixStem, "note");
  const paragraphs: LayoutParagraph[] = [];

  for (const block of prayer.structure) {
    const tr = translationFor(block, lang, variant);
    if (!tr && !includeEmpty) continue;
    paragraphs.push(paragraphForBlock(block, meta, tr, prefixStem, styles));
  }

  return { noteStyleName, paragraphs };
}

/**
 * Align two variants on the shared block skeleton.
 * A row is kept when either column has a translation (or when empty blocks
 * are requested). Missing text becomes an empty styled paragraph so Word
 * table rows stay paired.
 */
export function buildLayoutPairStory(
  prayer: Prayer,
  options: ExportLayoutParallelOptions,
): LayoutPairStory {
  const [leftRef, rightRef] = options.columns;
  const prefixStem = options.prefixStem ?? "";
  const includeEmpty = options.includeBlocksWithoutTranslation === true;
  const styles = options.styles;
  const leftMeta = requireVariant(prayer, leftRef.lang, leftRef.variant);
  const rightMeta = requireVariant(prayer, rightRef.lang, rightRef.variant);
  const noteStyleName = styleNameWithPrefix(prefixStem, "note");
  const rows: LayoutPairRow[] = [];

  for (const block of prayer.structure) {
    const leftTr = translationFor(block, leftRef.lang, leftRef.variant);
    const rightTr = translationFor(block, rightRef.lang, rightRef.variant);
    if (!leftTr && !rightTr && !includeEmpty) continue;
    rows.push({
      kind: block.kind,
      left: paragraphForBlock(block, leftMeta, leftTr, prefixStem, styles),
      right: paragraphForBlock(block, rightMeta, rightTr, prefixStem, styles),
    });
  }

  return { noteStyleName, rows };
}
