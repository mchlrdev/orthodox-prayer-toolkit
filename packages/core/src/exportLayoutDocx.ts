import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ICharacterStyleOptions,
  type IParagraphStyleOptions,
} from "docx";
import {
  buildLayoutPairStory,
  buildLayoutStory,
  type ExportLayoutOptions,
  type ExportLayoutParallelOptions,
  type LayoutParagraph,
  type LayoutSpeaker,
  type LayoutPairStory,
  type LayoutRun,
  type LayoutStory,
} from "./layoutModel.js";
import {
  INLINE_SPEAKER_GAP,
  inlineSpeakerText,
} from "./speakerExport.js";
import type { Prayer } from "./types.js";

/** Preferred grid (DXA). Word scales with 100% table width. */
const PARALLEL_COLUMN_DXA = 4680;
/** Narrow empty middle column when `gutterColumn` is on (~0.5 in). */
const PARALLEL_GUTTER_DXA = 720;
const PARALLEL_SIDE_WITH_GUTTER_DXA = 4320;
/**
 * Speaker column (~1 in) of the 9360 DXA text width. Layout DOCX column
 * placement: Speaker 1440 | Text 7920. Word table column placement keeps the
 * same Speaker width and shrinks the sides: 1440 | 3960 | 3960, or with
 * gutter 1440 | 3600 | 720 | 3600.
 */
const SPEAKER_COLUMN_DXA = 1440;
const SPEAKER_TEXT_DXA = 7920;
const SPEAKER_PARALLEL_SIDE_DXA = 3960;
const SPEAKER_PARALLEL_SIDE_WITH_GUTTER_DXA = 3600;

function runsToDocxChildren(
  lines: LayoutRun[][],
  noteStyleName: string,
  inline?: { speaker: LayoutSpeaker; separator: string },
): TextRun[] {
  const children: TextRun[] = [];
  if (inline) {
    children.push(
      new TextRun({
        text: inlineSpeakerText(inline.speaker.label, inline.separator),
        style: inline.speaker.styleName,
      }),
      new TextRun({ text: INLINE_SPEAKER_GAP }),
    );
  }
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      children.push(new TextRun({ break: 1 }));
    }
    for (const run of line) {
      if (run.t === "note") {
        children.push(
          new TextRun({
            text: run.v,
            style: noteStyleName,
          }),
        );
      } else {
        children.push(new TextRun({ text: run.v }));
      }
    }
  });
  return children;
}

/** `separator` set -> inline speaker lead; undefined -> no speaker run. */
function paragraphFromLayout(
  paragraph: LayoutParagraph,
  noteStyleName: string,
  separator?: string,
): Paragraph {
  return new Paragraph({
    style: paragraph.styleName,
    children: runsToDocxChildren(
      paragraph.lines,
      noteStyleName,
      paragraph.speaker && separator !== undefined
        ? { speaker: paragraph.speaker, separator }
        : undefined,
    ),
  });
}

function collectParagraphStyleNames(
  names: Iterable<string>,
): IParagraphStyleOptions[] {
  return [...new Set(names)].map((name) => ({
    id: name,
    name,
    basedOn: "Normal",
    next: "Normal",
    quickFormat: true,
  }));
}

function characterStyleDefs(names: string[]): ICharacterStyleOptions[] {
  return names.map((name) => ({
    id: name,
    name,
    basedOn: "DefaultParagraphFont",
    quickFormat: true,
  }));
}

function speakerCell(speaker: LayoutSpeaker | undefined): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: speaker
          ? [new TextRun({ text: speaker.label, style: speaker.styleName })]
          : [],
      }),
    ],
  });
}

/** Column placement: Speaker | Text, one row per block, no inline lead. */
function buildSpeakerColumnDocument(story: LayoutStory): Document {
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [SPEAKER_COLUMN_DXA, SPEAKER_TEXT_DXA],
    rows: story.paragraphs.map(
      (p) =>
        new TableRow({
          children: [
            speakerCell(p.speaker),
            new TableCell({
              children: [paragraphFromLayout(p, story.noteStyleName)],
            }),
          ],
        }),
    ),
  });
  return new Document({
    styles: {
      paragraphStyles: collectParagraphStyleNames(
        story.paragraphs.map((p) => p.styleName),
      ),
      characterStyles: characterStyleDefs(story.characterStyles),
    },
    sections: [{ properties: {}, children: [table] }],
  });
}

function buildDocument(story: LayoutStory): Document {
  if (story.speakerColumn) return buildSpeakerColumnDocument(story);
  const children = story.paragraphs.map((p) =>
    paragraphFromLayout(p, story.noteStyleName, story.speakerSeparator),
  );

  return new Document({
    styles: {
      paragraphStyles: collectParagraphStyleNames(
        story.paragraphs.map((p) => p.styleName),
      ),
      characterStyles: characterStyleDefs(story.characterStyles),
    },
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });
}

function pairCell(
  paragraph: LayoutParagraph,
  noteStyleName: string,
  separator: string,
): TableCell {
  return new TableCell({
    children: [paragraphFromLayout(paragraph, noteStyleName, separator)],
  });
}

function emptyGutterCell(): TableCell {
  return new TableCell({
    children: [new Paragraph({})],
  });
}

function buildPairDocument(
  story: LayoutPairStory,
  gutterColumn: boolean,
): Document {
  const styleNames = story.rows.flatMap((row) => [
    row.left.styleName,
    row.right.styleName,
  ]);

  const withSpeaker = story.speakerColumn;
  const side = withSpeaker
    ? gutterColumn
      ? SPEAKER_PARALLEL_SIDE_WITH_GUTTER_DXA
      : SPEAKER_PARALLEL_SIDE_DXA
    : gutterColumn
      ? PARALLEL_SIDE_WITH_GUTTER_DXA
      : PARALLEL_COLUMN_DXA;
  const columnWidths = [
    ...(withSpeaker ? [SPEAKER_COLUMN_DXA] : []),
    side,
    ...(gutterColumn ? [PARALLEL_GUTTER_DXA] : []),
    side,
  ];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths,
    rows: story.rows.map((row) => {
      const cells = [
        ...(withSpeaker ? [speakerCell(row.speaker)] : []),
        pairCell(row.left, story.noteStyleName, story.speakerSeparator),
        ...(gutterColumn ? [emptyGutterCell()] : []),
        pairCell(row.right, story.noteStyleName, story.speakerSeparator),
      ];
      return new TableRow({ children: cells });
    }),
  });

  return new Document({
    styles: {
      paragraphStyles: collectParagraphStyleNames(styleNames),
      characterStyles: characterStyleDefs(story.characterStyles),
    },
    sections: [
      {
        properties: {},
        children: [table],
      },
    ],
  });
}

/**
 * Export a Place-friendly DOCX story: blank named kind paragraph styles,
 * character style for notes, soft breaks, no document meta/title.
 */
export async function exportLayoutDocx(
  prayer: Prayer,
  options: ExportLayoutOptions,
): Promise<Uint8Array> {
  const story = buildLayoutStory(prayer, options);
  const doc = buildDocument(story);
  const arrayBuffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(arrayBuffer);
}

/**
 * Word-only table (one structure block per row). Optional empty middle
 * column (`gutterColumn`) so the gap can be dragged in Word.
 * Table chrome is the library default (½ pt grid); cells keep blank named
 * kind styles. Not for Affinity Place — tables do not flow as story text.
 */
export async function exportLayoutDocxParallel(
  prayer: Prayer,
  options: ExportLayoutParallelOptions,
): Promise<Uint8Array> {
  const story = buildLayoutPairStory(prayer, options);
  const doc = buildPairDocument(story, options.gutterColumn === true);
  const arrayBuffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(arrayBuffer);
}
