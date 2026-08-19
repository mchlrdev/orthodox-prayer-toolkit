import {
  KIND_PRESETS,
  isKindPreset,
  isValidKindId,
  plainText,
  type InlineContent,
  type Prayer,
  type Translation,
} from "@orthodox-prayer-toolkit/core";
import type { ActiveVariant } from "../variant";

export function usesLines(kind: string): boolean {
  return kind === "verse";
}

/**
 * What the editor shows for a translation. Verse is line-mode and reads
 * `lines`; if a file only has `text` on verse, treat it as one line.
 */
export function translationEditorContent(
  kind: string,
  tr: Translation | undefined,
): InlineContent | InlineContent[] {
  if (usesLines(kind)) {
    if (tr?.lines && tr.lines.length > 0) return tr.lines;
    if (tr?.text !== undefined) return [tr.text];
    return [];
  }
  return tr?.text ?? "";
}

/** Presets first (stable order), custom kinds sorted at the bottom. */
export function orderKinds(options: Iterable<string>): string[] {
  const unique = [...new Set(options)];
  const presets = KIND_PRESETS.filter((k) => unique.includes(k));
  const custom = unique
    .filter((k) => !isKindPreset(k))
    .sort((a, b) => a.localeCompare(b));
  return [...presets, ...custom];
}

export function kindOptions(
  prayer: Prayer,
  extra: readonly string[] = [],
): string[] {
  return orderKinds([
    ...KIND_PRESETS,
    ...prayer.structure.map((b) => b.kind),
    ...extra,
  ]);
}

/** Why a kind rename cannot proceed, or null if it is valid. */
export function kindRenameIssue(
  from: string,
  to: string,
  existing: Iterable<string>,
): string | null {
  const next = to.trim();
  if (!next) return "Required";
  if (next === from) return null;
  if (isKindPreset(from)) return "Built-in kinds cannot be renamed";
  if (!isValidKindId(next)) {
    return "Use a letter, then letters, digits, _ or -";
  }
  if (isKindPreset(next)) return "That name is reserved";
  for (const kind of existing) {
    if (kind === next) return "Already exists";
  }
  return null;
}

export function getTranslation(
  prayer: Prayer,
  blockId: string,
  active: ActiveVariant,
): Translation | undefined {
  const block = prayer.structure.find((b) => b.id === blockId);
  return block?.translations.find(
    (t) => t.lang === active.lang && t.variant === active.variant,
  );
}

export function setTranslation(
  prayer: Prayer,
  blockId: string,
  active: ActiveVariant,
  payload: Omit<Translation, "lang" | "variant"> | null,
): Prayer {
  return {
    ...prayer,
    structure: prayer.structure.map((block) => {
      if (block.id !== blockId) return block;
      const others = block.translations.filter(
        (t) => !(t.lang === active.lang && t.variant === active.variant),
      );
      if (payload === null) {
        return { ...block, translations: others };
      }
      return {
        ...block,
        translations: [
          ...others,
          { lang: active.lang, variant: active.variant, ...payload },
        ],
      };
    }),
  };
}

export function isTranslationFilled(
  prayer: Prayer,
  blockId: string,
  col: ActiveVariant,
): boolean {
  const block = prayer.structure.find((b) => b.id === blockId);
  if (!block) return false;
  const tr = getTranslation(prayer, blockId, col);
  if (!tr) return false;
  if (usesLines(block.kind)) {
    const lines = translationEditorContent(block.kind, tr) as InlineContent[];
    return lines.some((l) => plainText(l).trim().length > 0);
  }
  return tr.text !== undefined && plainText(tr.text).trim().length > 0;
}

/** True when every declared prayer variant has no content for this block. */
export function isBlockEmptyAcrossVariants(
  prayer: Prayer,
  blockId: string,
  options?: { treatAsEmpty?: ActiveVariant },
): boolean {
  if (!prayer.structure.some((b) => b.id === blockId)) return true;
  const ignore = options?.treatAsEmpty;
  return prayer.variants.every((v) => {
    if (
      ignore &&
      v.lang === ignore.lang &&
      v.variant === ignore.variant
    ) {
      return true;
    }
    return !isTranslationFilled(prayer, blockId, {
      lang: v.lang,
      variant: v.variant,
    });
  });
}

export function fillPercent(
  prayer: Prayer,
  col: ActiveVariant,
): { filled: number; total: number; percent: number } {
  const total = prayer.structure.length;
  if (total === 0) return { filled: 0, total: 0, percent: 100 };
  const filled = prayer.structure.filter((b) =>
    isTranslationFilled(prayer, b.id, col),
  ).length;
  return {
    filled,
    total,
    percent: Math.round((filled / total) * 100),
  };
}
