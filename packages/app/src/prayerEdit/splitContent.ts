import {
  isRunArray,
  plainText,
  splitInline,
  type InlineContent,
} from "@orthodox-prayer-toolkit/core";

function asLines(
  content: InlineContent | InlineContent[],
): InlineContent[] {
  if (typeof content === "string" || isRunArray(content)) {
    return [content];
  }
  return content;
}

/** Map a plain offset to line index + local offset (`\\n` separators). */
function mapOffsetToLine(
  lines: InlineContent[],
  offset: number,
): { lineIndex: number; local: number } {
  let remaining = offset;
  for (let i = 0; i < lines.length; i++) {
    const len = plainText(lines[i]!).length;
    if (remaining <= len) {
      return { lineIndex: i, local: remaining };
    }
    remaining -= len;
    if (i < lines.length - 1) {
      if (remaining === 0) {
        return { lineIndex: i + 1, local: 0 };
      }
      remaining -= 1;
    }
  }
  const last = Math.max(0, lines.length - 1);
  return {
    lineIndex: last,
    local: plainText(lines[last] ?? "").length,
  };
}

/**
 * Split serialized editor content at plain-text offsets.
 * `end` may be greater than `start` to drop a selection.
 * Empty sides are null. At the end of the text, `after` is null.
 */
export function splitEditorContent(
  content: InlineContent | InlineContent[] | null,
  start: number,
  end: number,
  lineMode: boolean,
): {
  before: InlineContent | InlineContent[] | null;
  after: InlineContent | InlineContent[] | null;
} {
  if (content === null) {
    return { before: null, after: null };
  }

  if (!lineMode) {
    const inline =
      typeof content === "string" || isRunArray(content)
        ? content
        : content.map((line) => plainText(line)).join("\n");
    return splitInline(inline, start, end);
  }

  const lines = asLines(content);
  if (lines.length === 0) {
    return { before: null, after: null };
  }

  const startMap = mapOffsetToLine(lines, start);
  const endMap = mapOffsetToLine(lines, end);
  const beforeLines: InlineContent[] = [];
  const afterLines: InlineContent[] = [];

  for (let i = 0; i < startMap.lineIndex; i++) {
    beforeLines.push(lines[i]!);
  }

  if (startMap.lineIndex === endMap.lineIndex) {
    const line = lines[startMap.lineIndex];
    if (line !== undefined) {
      const { before, after } = splitInline(
        line,
        startMap.local,
        endMap.local,
      );
      if (before !== null) beforeLines.push(before);
      if (after !== null) afterLines.push(after);
    }
  } else {
    const startLine = lines[startMap.lineIndex];
    if (startLine !== undefined) {
      const { before } = splitInline(startLine, startMap.local);
      if (before !== null) beforeLines.push(before);
    }
    const endLine = lines[endMap.lineIndex];
    if (endLine !== undefined) {
      const { after } = splitInline(endLine, endMap.local);
      if (after !== null) afterLines.push(after);
    }
  }

  for (let i = endMap.lineIndex + 1; i < lines.length; i++) {
    afterLines.push(lines[i]!);
  }

  return {
    before: beforeLines.length === 0 ? null : beforeLines,
    after: afterLines.length === 0 ? null : afterLines,
  };
}
