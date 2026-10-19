import { toRuns, type InlineContent } from "./textRuns.js";
import { paragraphStyleName, styleNameWithPrefix } from "./stylePrefix.js";
import { resolveBlockDir } from "./resolveDir.js";
import type { Prayer, StyleMap, Translation, VariantMeta } from "./types.js";
import {
  blockSpeakerLabel,
  resolveParallelSpeakerExport,
  resolveSpeakerExport,
  speakerStyleName,
  type ParallelSpeakerExportOptions,
  type SpeakerExportOptions,
} from "./speakerExport.js";

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
  /** Speaker labels; default inline, name form, `": "` separator. */
  speakers?: Partial<SpeakerExportOptions>;
};

/** Two variants of the same prayer, aligned on the shared structure. */
export type ExportLayoutParallelOptions = {
  columns: [LayoutColumnRef, LayoutColumnRef];
  prefixStem?: string;
  includeBlocksWithoutTranslation?: boolean;
  styles?: StyleMap;
  /**
   * Empty middle table column so Word can set the gap by dragging.
   * Default / absent: two columns only.
   */
  gutterColumn?: boolean;
  /** Speaker labels; default `inline-left`, name form, `": "` separator. */
  speakers?: Partial<ParallelSpeakerExportOptions>;
};

/** Speaker of a block as exported for one variant. */
export type LayoutSpeaker = {
  id: string;
  /** Printed label (variant name/short), without separator. */
  label: string;
  /** Character style name (`<stem>_speaker_<id>`, never `_rtl`). */
  styleName: string;
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
  /** Present when the block has a speaker and placement is not `off`. */
  speaker?: LayoutSpeaker;
};

export type LayoutStory = {
  /** Character style for inline note runs. */
  noteStyleName: string;
  /**
   * All character styles used: note first, then speaker styles in
   * first-use order (distinct).
   */
  characterStyles: string[];
  /** Separator for inline speaker labels (see `inlineSpeakerText`). */
  speakerSeparator: string;
  /**
   * True when a speaker column is requested AND at least one paragraph has a
   * speaker. RTF ignores this (inline); layout DOCX then emits a table.
   */
  speakerColumn: boolean;
  paragraphs: LayoutParagraph[];
};

/** One structure block, both column texts, so DOCX can keep them in one table row. */
export type LayoutPairRow = {
  kind: string;
  left: LayoutParagraph;
  right: LayoutParagraph;
  /** Column placement only: speaker label of the left variant. */
  speaker?: LayoutSpeaker;
};

export type LayoutPairStory = {
  noteStyleName: string;
  /** Note first, then speaker styles in first-use order. */
  characterStyles: string[];
  speakerSeparator: string;
  /** True when placement is `column` and at least one row has a speaker. */
  speakerColumn: boolean;
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
  speaker?: LayoutSpeaker,
): LayoutParagraph {
  const p: LayoutParagraph = {
    kind: block.kind,
    styleName: paragraphStyleName(
      prefixStem,
      block.kind,
      resolveBlockDir(meta, block.kind, styles),
    ),
    lines: linesFromTranslation(tr),
  };
  if (speaker) p.speaker = speaker;
  return p;
}

function layoutSpeaker(
  prayer: Prayer,
  block: Prayer["structure"][number],
  lang: string,
  variant: string,
  form: "name" | "short",
  prefixStem: string,
): LayoutSpeaker | undefined {
  const label = blockSpeakerLabel(prayer, block, lang, variant, form);
  if (label === null) return undefined;
  return {
    id: block.speaker!,
    label,
    styleName: speakerStyleName(prefixStem, block.speaker!),
  };
}

function characterStylesOf(
  noteStyleName: string,
  speakers: Iterable<LayoutSpeaker | undefined>,
): string[] {
  const out = [noteStyleName];
  for (const sp of speakers) {
    if (sp && !out.includes(sp.styleName)) out.push(sp.styleName);
  }
  return out;
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
  const sp = resolveSpeakerExport(options.speakers);
  const paragraphs: LayoutParagraph[] = [];

  for (const block of prayer.structure) {
    const tr = translationFor(block, lang, variant);
    if (!tr && !includeEmpty) continue;
    const speaker =
      sp.placement === "off"
        ? undefined
        : layoutSpeaker(prayer, block, lang, variant, sp.form, prefixStem);
    paragraphs.push(
      paragraphForBlock(block, meta, tr, prefixStem, styles, speaker),
    );
  }

  return {
    noteStyleName,
    characterStyles: characterStylesOf(
      noteStyleName,
      paragraphs.map((p) => p.speaker),
    ),
    speakerSeparator: sp.separator,
    speakerColumn:
      sp.placement === "column" && paragraphs.some((p) => p.speaker),
    paragraphs,
  };
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
  const sp = resolveParallelSpeakerExport(options.speakers);
  const rows: LayoutPairRow[] = [];

  for (const block of prayer.structure) {
    const leftTr = translationFor(block, leftRef.lang, leftRef.variant);
    const rightTr = translationFor(block, rightRef.lang, rightRef.variant);
    if (!leftTr && !rightTr && !includeEmpty) continue;
    const leftSp =
      sp.placement === "off"
        ? undefined
        : layoutSpeaker(
            prayer, block, leftRef.lang, leftRef.variant, sp.form, prefixStem,
          );
    const rightSp =
      sp.placement === "inline-both"
        ? layoutSpeaker(
            prayer, block, rightRef.lang, rightRef.variant, sp.form, prefixStem,
          )
        : undefined;
    const inlineLeft =
      sp.placement === "inline-left" || sp.placement === "inline-both";
    const row: LayoutPairRow = {
      kind: block.kind,
      left: paragraphForBlock(
        block, leftMeta, leftTr, prefixStem, styles,
        inlineLeft ? leftSp : undefined,
      ),
      right: paragraphForBlock(
        block, rightMeta, rightTr, prefixStem, styles, rightSp,
      ),
    };
    if (sp.placement === "column" && leftSp) row.speaker = leftSp;
    rows.push(row);
  }

  return {
    noteStyleName,
    characterStyles: characterStylesOf(
      noteStyleName,
      rows.flatMap((r) => [r.speaker, r.left.speaker, r.right.speaker]),
    ),
    speakerSeparator: sp.separator,
    speakerColumn: sp.placement === "column" && rows.some((r) => r.speaker),
    rows,
  };
}
