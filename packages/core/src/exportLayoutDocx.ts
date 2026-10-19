import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
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
/** Narrow empty gutter (~0.5 in). Language gap and speaker gutter share this. */
const PARALLEL_GUTTER_DXA = 720;
const PARALLEL_SIDE_WITH_GUTTER_DXA = 4320;
/**
 * Speaker column (~1 in) of the 9360 DXA text width. Layout DOCX column
 * placement: Speaker 1440 | Text 7920. Word table Own column:
 * neither gutter 1440 | 3960 | 3960;
 * language gutter 1440 | 3600 | 720 | 3600;
 * speaker gutter 1440 | 720 | 3600 | 3600;
 * both 1440 | 720 | 3240 | 720 | 3240.
 */
const SPEAKER_COLUMN_DXA = 1440;
const SPEAKER_TEXT_DXA = 7920;
const SPEAKER_PARALLEL_SIDE_DXA = 3960;
const SPEAKER_PARALLEL_SIDE_WITH_GUTTER_DXA = 3600;
const SPEAKER_PARALLEL_SIDE_BOTH_GUTTERS_DXA = 3240;

function cellWidth(size: number): { size: number; type: typeof WidthType.DXA } {
  return { size, type: WidthType.DXA };
}

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

function speakerCell(
  speaker: LayoutSpeaker | undefined,
  separator: string,
  width: number,
): TableCell {
  return new TableCell({
    width: cellWidth(width),
    children: [
      speaker
        ? new Paragraph({
            children: [
              new TextRun({
                text: inlineSpeakerText(speaker.label, separator),
                style: speaker.styleName,
              }),
            ],
          })
        : new Paragraph({}),
    ],
  });
}

/** Column placement: Speaker | Text, one row per block, no inline lead. */
function buildSpeakerColumnDocument(story: LayoutStory): Document {
  const columnWidths = [SPEAKER_COLUMN_DXA, SPEAKER_TEXT_DXA];
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    columnWidths,
    rows: story.paragraphs.map(
      (p) =>
        new TableRow({
          children: [
            speakerCell(p.speaker, story.speakerSeparator, columnWidths[0]!),
            new TableCell({
              width: cellWidth(columnWidths[1]!),
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
  width: number,
): TableCell {
  return new TableCell({
    width: cellWidth(width),
    children: [paragraphFromLayout(paragraph, noteStyleName, separator)],
  });
}

function emptyGutterCell(width: number): TableCell {
  return new TableCell({
    width: cellWidth(width),
    children: [new Paragraph({})],
  });
}

/** Speaker | [speaker gutter] | Left | [language gutter] | Right — 9360 DXA. */
function parallelColumnWidths(opts: {
  withSpeaker: boolean;
  languageGutter: boolean;
  speakerGutter: boolean;
}): number[] {
  if (!opts.withSpeaker) {
    return opts.languageGutter
      ? [
          PARALLEL_SIDE_WITH_GUTTER_DXA,
          PARALLEL_GUTTER_DXA,
          PARALLEL_SIDE_WITH_GUTTER_DXA,
        ]
      : [PARALLEL_COLUMN_DXA, PARALLEL_COLUMN_DXA];
  }
  if (opts.speakerGutter && opts.languageGutter) {
    return [
      SPEAKER_COLUMN_DXA,
      PARALLEL_GUTTER_DXA,
      SPEAKER_PARALLEL_SIDE_BOTH_GUTTERS_DXA,
      PARALLEL_GUTTER_DXA,
      SPEAKER_PARALLEL_SIDE_BOTH_GUTTERS_DXA,
    ];
  }
  if (opts.speakerGutter) {
    return [
      SPEAKER_COLUMN_DXA,
      PARALLEL_GUTTER_DXA,
      SPEAKER_PARALLEL_SIDE_WITH_GUTTER_DXA,
      SPEAKER_PARALLEL_SIDE_WITH_GUTTER_DXA,
    ];
  }
  if (opts.languageGutter) {
    return [
      SPEAKER_COLUMN_DXA,
      SPEAKER_PARALLEL_SIDE_WITH_GUTTER_DXA,
      PARALLEL_GUTTER_DXA,
      SPEAKER_PARALLEL_SIDE_WITH_GUTTER_DXA,
    ];
  }
  return [
    SPEAKER_COLUMN_DXA,
    SPEAKER_PARALLEL_SIDE_DXA,
    SPEAKER_PARALLEL_SIDE_DXA,
  ];
}

function buildPairDocument(
  story: LayoutPairStory,
  languageGutter: boolean,
  speakerGutter: boolean,
): Document {
  const styleNames = story.rows.flatMap((row) => [
    row.left.styleName,
    row.right.styleName,
  ]);

  const withSpeaker = story.speakerColumn;
  const useSpeakerGutter = withSpeaker && speakerGutter;
  const columnWidths = parallelColumnWidths({
    withSpeaker,
    languageGutter,
    speakerGutter: useSpeakerGutter,
  });

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    columnWidths,
    rows: story.rows.map((row) => {
      const cells: TableCell[] = [];
      let i = 0;
      if (withSpeaker) {
        cells.push(
          speakerCell(row.speaker, story.speakerSeparator, columnWidths[i++]!),
        );
        if (useSpeakerGutter) {
          cells.push(emptyGutterCell(columnWidths[i++]!));
        }
      }
      cells.push(
        pairCell(
          row.left,
          story.noteStyleName,
          story.speakerSeparator,
          columnWidths[i++]!,
        ),
      );
      if (languageGutter) {
        cells.push(emptyGutterCell(columnWidths[i++]!));
      }
      cells.push(
        pairCell(
          row.right,
          story.noteStyleName,
          story.speakerSeparator,
          columnWidths[i++]!,
        ),
      );
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
 * Word-only table (one structure block per row). Language gutter
 * (`gutterColumn`) is on by default; pass `false` to omit it. Own-column
 * speaker gutter (`speakerGutterColumn`) is on by default when placement is
 * `column`; ignored otherwise. Table chrome is the library default (½ pt
 * grid); cells keep blank named kind styles and explicit DXA widths so
 * empty gutters stay. Not for Affinity Place — tables do not flow as story
 * text.
 */
export async function exportLayoutDocxParallel(
  prayer: Prayer,
  options: ExportLayoutParallelOptions,
): Promise<Uint8Array> {
  const story = buildLayoutPairStory(prayer, options);
  const doc = buildPairDocument(
    story,
    options.gutterColumn !== false,
    story.speakerColumn && options.speakerGutterColumn !== false,
  );
  const arrayBuffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(arrayBuffer);
}
