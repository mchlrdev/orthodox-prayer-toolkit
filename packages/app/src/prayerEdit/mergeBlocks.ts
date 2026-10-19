import {
  packInline,
  plainText,
  toRuns,
  type InlineContent,
  type Prayer,
  type TextRun,
  type Translation,
} from "@orthodox-prayer-toolkit/core";
import { sameVariant, type ActiveVariant } from "../variant";
import { applyCommittedContent } from "./commitContent";
import { usesLines } from "./translations";

/** Which of the two Blocks the caret was in; its Kind and id survive. */
export type MergeKeep = "upper" | "lower";

export type MergeResult = {
  prayer: Prayer;
  /** The merged Block (id of the Block that kept its identity). */
  blockId: string;
  /** Plain-text caret offset at the seam in the column the user typed in. */
  caret: number;
};

function inlineToLines(content: InlineContent): InlineContent[] {
  const lines: TextRun[][] = [[]];
  for (const run of toRuns(content)) {
    const parts = run.v.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]!.push({ ...run, v: part });
    });
  }
  return lines.map((runs) => packInline(runs) ?? "");
}

function linesToInline(lines: InlineContent[]): InlineContent {
  const runs: TextRun[] = [];
  lines.forEach((line, i) => {
    if (i > 0) runs.push({ t: "text", v: "\n" });
    runs.push(...toRuns(line));
  });
  return packInline(runs) ?? "";
}

/** A translation's content in line form (verse) or inline form (text Kinds). */
function contentAs(
  tr: Translation | undefined,
  lineMode: boolean,
): InlineContent | InlineContent[] {
  if (lineMode) {
    const lines = tr?.lines ?? (tr?.text !== undefined ? inlineToLines(tr.text) : []);
    return lines.filter((l) => plainText(l).length > 0);
  }
  if (tr?.text !== undefined) return tr.text;
  if (tr?.lines && tr.lines.length > 0) return linesToInline(tr.lines);
  return "";
}

function joinInline(head: InlineContent, tail: InlineContent): InlineContent {
  return packInline([...toRuns(head), ...toRuns(tail)]) ?? "";
}

/** Caret where it was: start of the tail (Backspace) or end of the head (Delete). */
function lineCaret(
  head: InlineContent[],
  tail: InlineContent[],
  keep: MergeKeep,
): number {
  if (head.length === 0) return 0;
  const sum = head.reduce<number>((a, l) => a + plainText(l).length, 0);
  // Lines render with one "\n" separator each.
  const endOfHead = sum + head.length - 1;
  return keep === "lower" && tail.length > 0 ? endOfHead + 1 : endOfHead;
}

/**
 * Merge Block `upperIndex + 1` into Block `upperIndex`, in every Variant.
 * The Block named by `keep` (where the caret was) keeps its Kind and id; the
 * result sits at the upper position. Inline text joins with no separator;
 * verse keeps lines separate. Between verse and text Kinds the payload is
 * reshaped like a Kind change (lines ↔ "\n"), notes kept.
 */
export function mergeBlocks(
  prayer: Prayer,
  upperIndex: number,
  keep: MergeKeep,
  col: ActiveVariant,
): MergeResult | null {
  const upper = prayer.structure[upperIndex];
  const lower = prayer.structure[upperIndex + 1];
  if (!upper || !lower) return null;
  const survivor = keep === "upper" ? upper : lower;
  const lineMode = usesLines(survivor.kind);

  const variants: ActiveVariant[] = [];
  for (const tr of [...upper.translations, ...lower.translations]) {
    if (!variants.some((v) => sameVariant(v, tr))) {
      variants.push({ lang: tr.lang, variant: tr.variant });
    }
  }

  // A speaker-less survivor inherits the other block's speaker when both share
  // a kind, so split-then-join round-trips (the split-off block has none).
  const other = keep === "upper" ? lower : upper;
  const speaker =
    survivor.speaker ?? (other.kind === survivor.kind ? other.speaker : undefined);

  const structure = [...prayer.structure];
  structure.splice(upperIndex, 2, {
    ...survivor,
    ...(speaker !== undefined ? { speaker } : {}),
    translations: [],
  });
  let next: Prayer = { ...prayer, structure };
  let caret = 0;

  const find = (block: typeof upper, v: ActiveVariant) =>
    block.translations.find((t) => sameVariant(t, v));

  for (const v of variants) {
    const head = contentAs(find(upper, v), lineMode);
    const tail = contentAs(find(lower, v), lineMode);
    let joined: InlineContent | InlineContent[];
    let seam: number;
    if (lineMode) {
      const h = head as InlineContent[];
      const t = tail as InlineContent[];
      joined = [...h, ...t];
      seam = lineCaret(h, t, keep);
    } else {
      joined = joinInline(head as InlineContent, tail as InlineContent);
      seam = plainText(head as InlineContent).length;
    }
    if (sameVariant(v, col)) caret = seam;
    next = applyCommittedContent(next, survivor.id, v, joined);
  }

  if (!variants.some((v) => sameVariant(v, col))) caret = 0;
  return { prayer: next, blockId: survivor.id, caret };
}
