import {
  buildLayoutStory,
  type ExportLayoutOptions,
  type LayoutRun,
  type LayoutStory,
} from "./layoutModel.js";
import type { Prayer } from "./types.js";

function escapeRtfChar(ch: string): string {
  if (ch === "\\") return "\\\\";
  if (ch === "{") return "\\{";
  if (ch === "}") return "\\}";
  const code = ch.codePointAt(0);
  if (code === undefined) return "";
  if (code <= 127) return ch;
  // RTF \uN uses signed 16-bit
  const signed = code > 32767 ? code - 65536 : code;
  return `\\u${signed}?`;
}

function escapeRtf(text: string): string {
  return [...text].map(escapeRtfChar).join("");
}

function renderRuns(
  runs: LayoutRun[],
  noteCs: number,
): string {
  return runs
    .map((run) => {
      const escaped = escapeRtf(run.v);
      if (run.t === "note") {
        return `{\\cs${noteCs} ${escaped}}`;
      }
      return escaped;
    })
    .join("");
}

function serializeRtf(story: LayoutStory): string {
  const styleIds = new Map<string, number>();
  let nextPara = 1;
  for (const p of story.paragraphs) {
    if (!styleIds.has(p.styleName)) {
      styleIds.set(p.styleName, nextPara++);
    }
  }
  const noteCs = 10;

  const stylesheetLines: string[] = [];
  for (const [name, id] of styleIds) {
    stylesheetLines.push(`{\\s${id} ${escapeRtf(name)};}`);
  }
  stylesheetLines.push(`{\\*\\cs${noteCs} ${escapeRtf(story.noteStyleName)};}`);

  const bodyLines: string[] = [];
  for (const p of story.paragraphs) {
    const sid = styleIds.get(p.styleName)!;
    const inner = p.lines
      .map((line) => renderRuns(line, noteCs))
      .join("\\line ");
    bodyLines.push(`{\\pard\\s${sid} ${inner}\\par}`);
  }

  return [
    "{\\rtf1\\ansi\\uc1\\deff0",
    "{\\fonttbl{\\f0\\fnil;}}",
    "{\\stylesheet",
    ...stylesheetLines,
    "}",
    ...bodyLines,
    "}",
    "",
  ].join("\n");
}

/**
 * Export a Place-friendly RTF story: blank named styles, soft breaks for
 * `lines`, character style for notes, no document meta/title.
 */
export function exportLayoutRtf(
  prayer: Prayer,
  options: ExportLayoutOptions,
): string {
  return serializeRtf(buildLayoutStory(prayer, options));
}
