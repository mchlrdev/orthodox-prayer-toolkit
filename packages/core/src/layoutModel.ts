import { toRuns, type InlineContent } from "./textRuns.js";
import { styleNameWithPrefix } from "./stylePrefix.js";
import type { Prayer, Translation } from "./types.js";

export type ExportLayoutOptions = {
  lang: string;
  variant: string;
  /**
   * Style-name prefix stem. Empty string → bare `kind` / `note` names.
   * Callers resolve library/prefs chain before passing this.
   */
  prefixStem?: string;
  includeBlocksWithoutTranslation?: boolean;
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
  noteStyleName: string;
  paragraphs: LayoutParagraph[];
};

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

  const meta = prayer.variants.find(
    (v) => v.lang === lang && v.variant === variant,
  );
  if (!meta) {
    throw new Error(
      `Variant not found: lang="${lang}" variant="${variant}"`,
    );
  }

  const noteStyleName = styleNameWithPrefix(prefixStem, "note");
  const paragraphs: LayoutParagraph[] = [];

  for (const block of prayer.structure) {
    const tr =
      block.translations.find(
        (t) => t.lang === lang && t.variant === variant,
      ) ?? null;
    if (!tr && !includeEmpty) continue;

    paragraphs.push({
      kind: block.kind,
      styleName: styleNameWithPrefix(prefixStem, block.kind),
      lines: linesFromTranslation(tr),
    });
  }

  return { noteStyleName, paragraphs };
}
