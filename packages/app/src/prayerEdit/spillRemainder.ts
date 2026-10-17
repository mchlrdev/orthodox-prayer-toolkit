import {
  isRunArray,
  packInline,
  plainText,
  toRuns,
  type InlineContent,
  type Prayer,
  type TextRun,
} from "@orthodox-prayer-toolkit/core";
import type { ActiveVariant } from "../variant";
import { applyCommittedContent } from "./commitContent";
import {
  getTranslation,
  translationEditorContent,
  usesLines,
} from "./translations";

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

function joinInline(head: InlineContent, tail: InlineContent): InlineContent {
  return packInline([...toRuns(head), ...toRuns(tail)]) ?? "";
}

/** Reshape editor content to the next Block's verse-vs-text payload. */
function toEditorShape(
  content: InlineContent | InlineContent[] | null,
  lineMode: boolean,
): InlineContent | InlineContent[] {
  if (content === null) return lineMode ? [] : "";

  if (lineMode) {
    if (typeof content === "string" || isRunArray(content)) {
      return inlineToLines(content).filter((l) => plainText(l).length > 0);
    }
    return content.filter((l) => plainText(l).length > 0);
  }

  if (typeof content === "string" || isRunArray(content)) return content;
  return linesToInline(content);
}

function remainderEmpty(
  content: InlineContent | InlineContent[],
  lineMode: boolean,
): boolean {
  if (lineMode) {
    return (content as InlineContent[]).length === 0;
  }
  return plainText(content as InlineContent).length === 0;
}

/**
 * Keep `before` in this Block's column and prepend `after` onto the next
 * Block in the same column. Structure and other variants stay put.
 * Returns null when there is no next Block.
 */
export function moveRemainderToNext(
  prayer: Prayer,
  index: number,
  col: ActiveVariant,
  before: InlineContent | InlineContent[] | null,
  after: InlineContent | InlineContent[] | null,
): Prayer | null {
  const current = prayer.structure[index];
  const next = prayer.structure[index + 1];
  if (!current || !next) return null;

  let updated = applyCommittedContent(prayer, current.id, col, before);
  const head = toEditorShape(after, usesLines(next.kind));
  if (remainderEmpty(head, usesLines(next.kind))) return updated;

  const existing = translationEditorContent(
    next.kind,
    getTranslation(updated, next.id, col),
  );
  const tail = toEditorShape(existing, usesLines(next.kind));
  const joined = usesLines(next.kind)
    ? [...(head as InlineContent[]), ...(tail as InlineContent[])]
    : joinInline(head as InlineContent, tail as InlineContent);
  return applyCommittedContent(updated, next.id, col, joined);
}
