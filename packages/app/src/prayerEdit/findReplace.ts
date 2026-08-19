import {
  isRunArray,
  plainText,
  replaceRangeInInline,
  type InlineContent,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import type { ActiveVariant } from "../variant";
import { applyCommittedContent } from "./commitContent";
import { getTranslation, translationEditorContent, usesLines } from "./translations";
import { mapOffsetToLine } from "../inlineDom";

export type FindReplaceOptions = {
  matchCase: boolean;
  wholeWord: boolean;
};

export type FindMatch = {
  blockId: string;
  col: ActiveVariant;
  start: number;
  end: number;
  lineMode: boolean;
};

function asLines(content: InlineContent | InlineContent[]): InlineContent[] {
  if (typeof content === "string" || isRunArray(content)) return [content];
  return content;
}

/** Plain text shown in the editor for one block cell. */
export function editorPlainText(
  content: InlineContent | InlineContent[],
  lineMode: boolean,
): string {
  if (lineMode) {
    return asLines(content)
      .map((line) => plainText(line))
      .join("\n");
  }
  if (typeof content === "string" || isRunArray(content)) {
    return plainText(content);
  }
  return content.map((line) => plainText(line)).join("\n");
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_']/u.test(ch);
}

function isWholeWordMatch(
  text: string,
  start: number,
  end: number,
): boolean {
  const before = start > 0 ? text[start - 1]! : "";
  const after = end < text.length ? text[end]! : "";
  if (before && isWordChar(before)) return false;
  if (after && isWordChar(after)) return false;
  return true;
}

function findInText(
  text: string,
  query: string,
  options: FindReplaceOptions,
): Array<{ start: number; end: number }> {
  if (query.length === 0) return [];
  const haystack = options.matchCase ? text : text.toLocaleLowerCase();
  const needle = options.matchCase ? query : query.toLocaleLowerCase();
  const hits: Array<{ start: number; end: number }> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    const end = index + needle.length;
    if (!options.wholeWord || isWholeWordMatch(text, index, end)) {
      hits.push({ start: index, end });
    }
    from = index + (needle.length === 0 ? 1 : needle.length);
  }
  return hits;
}

export function findMatchesInPrayer(
  prayer: Prayer,
  visibleVariants: ActiveVariant[],
  query: string,
  options: FindReplaceOptions,
): FindMatch[] {
  if (query.length === 0) return [];
  const matches: FindMatch[] = [];
  for (const block of prayer.structure) {
    const lineMode = usesLines(block.kind);
    for (const col of visibleVariants) {
      const tr = getTranslation(prayer, block.id, col);
      const content = translationEditorContent(block.kind, tr);
      const text = editorPlainText(content, lineMode);
      for (const hit of findInText(text, query, options)) {
        matches.push({
          blockId: block.id,
          col,
          start: hit.start,
          end: hit.end,
          lineMode,
        });
      }
    }
  }
  return matches;
}

function replaceSingleLine(
  lines: InlineContent[],
  lineIndex: number,
  localStart: number,
  localEnd: number,
  replacement: string,
): InlineContent[] {
  const line = lines[lineIndex];
  if (line === undefined) return lines;
  const nextLine = replaceRangeInInline(line, localStart, localEnd, replacement);
  const next = [...lines];
  if (plainText(nextLine).length === 0) {
    next.splice(lineIndex, 1);
  } else {
    next[lineIndex] = nextLine;
  }
  return next;
}

export function replaceInEditorContent(
  content: InlineContent | InlineContent[],
  lineMode: boolean,
  start: number,
  end: number,
  replacement: string,
): InlineContent | InlineContent[] | null {
  if (!lineMode) {
    const inline =
      typeof content === "string" || isRunArray(content)
        ? content
        : content.map((line) => plainText(line)).join("\n");
    const next = replaceRangeInInline(inline, start, end, replacement);
    return plainText(next).length === 0 ? null : next;
  }

  const lines = asLines(content);
  if (lines.length === 0) {
    return replacement.length === 0 ? null : replacement.split("\n");
  }

  const startMap = mapOffsetToLine(lines, start);
  const endMap = mapOffsetToLine(lines, end);

  if (startMap.lineIndex === endMap.lineIndex) {
    const nextLines = replaceSingleLine(
      lines,
      startMap.lineIndex,
      startMap.local,
      endMap.local,
      replacement,
    );
    return nextLines.length === 0 ? null : nextLines;
  }

  const plain = editorPlainText(content, true);
  const newPlain = plain.slice(0, start) + replacement + plain.slice(end);
  if (newPlain.length === 0) return null;
  return newPlain.split("\n").map((line) => line as InlineContent);
}

export function replaceMatchInPrayer(
  prayer: Prayer,
  match: FindMatch,
  replacement: string,
): Prayer {
  const block = prayer.structure.find((b) => b.id === match.blockId);
  if (!block) return prayer;
  const tr = getTranslation(prayer, match.blockId, match.col);
  const content = translationEditorContent(block.kind, tr);
  const nextContent = replaceInEditorContent(
    content,
    match.lineMode,
    match.start,
    match.end,
    replacement,
  );
  return applyCommittedContent(
    prayer,
    match.blockId,
    match.col,
    nextContent,
  );
}

export function replaceAllMatchesInPrayer(
  prayer: Prayer,
  matches: FindMatch[],
  replacement: string,
): Prayer {
  const blockOrder = new Map(
    prayer.structure.map((block, index) => [block.id, index]),
  );
  const sorted = [...matches].sort((a, b) => {
    const blockDelta =
      (blockOrder.get(b.blockId) ?? 0) - (blockOrder.get(a.blockId) ?? 0);
    if (blockDelta !== 0) return blockDelta;
    return b.start - a.start;
  });
  return sorted.reduce(
    (next, match) => replaceMatchInPrayer(next, match, replacement),
    prayer,
  );
}

export function summarizeReplaceAll(matches: FindMatch[]): {
  count: number;
  blockCount: number;
} {
  const blocks = new Set(matches.map((m) => m.blockId));
  return { count: matches.length, blockCount: blocks.size };
}
