import {
  buildLayoutStory,
  type ExportLayoutOptions,
  type LayoutRun,
  type LayoutStory,
} from "./layoutModel.js";
import {
  INLINE_SPEAKER_GAP,
  inlineSpeakerText,
} from "./speakerExport.js";
import type { Prayer } from "./types.js";

/** First character style id; note keeps 10, speakers follow in first-use order. */
const FIRST_CS_ID = 10;

function escapeRtfChar(ch: string): string {
  if (ch === "\\") return "\\\\";
  if (ch === "{") return "\\{";
  if (ch === "}") return "\\}";
  const code = ch.codePointAt(0);
  if (code === undefined) return "";
  if (code <= 127) return ch;
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
  const csIds = new Map<string, number>();
  story.characterStyles.forEach((name, i) => csIds.set(name, FIRST_CS_ID + i));
  const noteCs = csIds.get(story.noteStyleName)!;

  const stylesheetLines: string[] = [];
  for (const [name, id] of styleIds) {
    stylesheetLines.push(`{\\s${id} ${escapeRtf(name)};}`);
  }
  for (const [name, id] of csIds) {
    stylesheetLines.push(`{\\*\\cs${id} ${escapeRtf(name)};}`);
  }

  const bodyLines: string[] = [];
  for (const p of story.paragraphs) {
    const sid = styleIds.get(p.styleName)!;
    const lead = p.speaker
      ? `{\\cs${csIds.get(p.speaker.styleName)!} ${escapeRtf(
          inlineSpeakerText(p.speaker.label, story.speakerSeparator),
        )}}${INLINE_SPEAKER_GAP}`
      : "";
    const inner =
      lead +
      p.lines.map((line) => renderRuns(line, noteCs)).join("\\line ");
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
 * Export a Place-friendly RTF story: blank named kind paragraph styles,
 * character style for notes, soft breaks, no document meta/title.
 */
export function exportLayoutRtf(
  prayer: Prayer,
  options: ExportLayoutOptions,
): string {
  return serializeRtf(buildLayoutStory(prayer, options));
}
