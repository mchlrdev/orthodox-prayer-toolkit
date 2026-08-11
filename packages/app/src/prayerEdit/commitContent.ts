import {
  isRunArray,
  normalizeRuns,
  packInline,
  plainText,
  toRuns,
  type InlineContent,
  type Prayer,
  type Translation,
} from "@orthodox-prayer-toolkit/core";
import type { ActiveVariant } from "../variant";
import { getTranslation, setTranslation, usesLines } from "./translations";

function canonicalInline(content: InlineContent | null | undefined): string {
  if (content === null || content === undefined) return "";
  const packed = packInline(normalizeRuns(toRuns(content)));
  if (packed === null) return "";
  return typeof packed === "string"
    ? `\0s\0${packed}`
    : `\0r\0${JSON.stringify(packed)}`;
}

function linesContentEqual(a: InlineContent[], b: InlineContent[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((line, i) => canonicalInline(line) === canonicalInline(b[i]));
}

export function inlineContentEqual(
  a: InlineContent | null | undefined,
  b: InlineContent | null | undefined,
): boolean {
  return canonicalInline(a) === canonicalInline(b);
}

function normalizeCommittedLines(
  content: InlineContent | InlineContent[] | null,
): InlineContent[] {
  if (content === null) return [];
  if (typeof content === "string") {
    return plainText(content).length > 0 ? [content] : [];
  }
  if (isRunArray(content)) {
    return plainText(content).length > 0 ? [content] : [];
  }
  return (content as InlineContent[]).filter((l) => plainText(l).length > 0);
}

function normalizeCommittedText(
  content: InlineContent | InlineContent[] | null,
): InlineContent | null {
  if (content === null) return null;
  if (typeof content === "string") {
    return content.trim().length === 0 ? null : content;
  }
  if (isRunArray(content)) {
    return plainText(content).length === 0 ? null : content;
  }
  const parts = content as InlineContent[];
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  return parts.map((l) => plainText(l)).join("\n");
}

/** True when a commit would not change the stored translation. */
export function committedContentUnchanged(
  blockKind: string,
  current: Pick<Translation, "text" | "lines"> | undefined,
  content: InlineContent | InlineContent[] | null,
): boolean {
  if (usesLines(blockKind)) {
    const nextLines = normalizeCommittedLines(content);
    const currentLines = current?.lines ?? [];
    if (nextLines.length === 0 && currentLines.length === 0) return true;
    return linesContentEqual(currentLines, nextLines);
  }

  const nextText = normalizeCommittedText(content);
  const currentText = current?.text;
  if (nextText === null && currentText === undefined) return true;
  return inlineContentEqual(currentText, nextText);
}

/** Compare stored editor props with a fresh DOM serialization. */
export function editorCommitUnchanged(
  stored: InlineContent | InlineContent[],
  serialized: InlineContent | InlineContent[] | null,
  lineMode: boolean,
): boolean {
  const blockKind = lineMode ? "verse" : "rubric";
  if (lineMode) {
    const lines = stored as InlineContent[];
    const current =
      lines.length === 0
        ? undefined
        : ({ lines } as Pick<Translation, "lines">);
    return committedContentUnchanged(blockKind, current, serialized);
  }

  const text = stored as InlineContent;
  const current =
    plainText(text).trim().length === 0
      ? undefined
      : ({ text } as Pick<Translation, "text">);
  return committedContentUnchanged(blockKind, current, serialized);
}

function buildCommittedPayload(
  blockKind: string,
  content: InlineContent | InlineContent[] | null,
): Omit<Translation, "lang" | "variant"> | null {
  if (usesLines(blockKind)) {
    const lines = normalizeCommittedLines(content);
    return lines.length === 0 ? null : { lines };
  }

  const text = normalizeCommittedText(content);
  if (text === null) return null;

  return { text };
}

/** Commit editor content into a block translation (verse lines vs text). */
export function applyCommittedContent(
  prayer: Prayer,
  blockId: string,
  col: ActiveVariant,
  content: InlineContent | InlineContent[] | null,
): Prayer {
  const block = prayer.structure.find((b) => b.id === blockId);
  if (!block) return prayer;
  const tr = getTranslation(prayer, blockId, col);
  const payload = buildCommittedPayload(block.kind, content);

  if (committedContentUnchanged(block.kind, tr, content)) {
    return prayer;
  }

  return setTranslation(prayer, blockId, col, payload);
}
