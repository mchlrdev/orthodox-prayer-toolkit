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
  type LayoutPairStory,
  type LayoutRun,
  type LayoutStory,
} from "./layoutModel.js";
import type { Prayer } from "./types.js";

/** Preferred grid (DXA). Word scales with 100% table width. */
const PARALLEL_COLUMN_DXA = 4680;
/** Narrow empty middle column when `gutterColumn` is on (~0.5 in). */
const PARALLEL_GUTTER_DXA = 720;
const PARALLEL_SIDE_WITH_GUTTER_DXA = 4320;

function runsToDocxChildren(
  lines: LayoutRun[][],
  noteStyleName: string,
): TextRun[] {
  const children: TextRun[] = [];
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

function paragraphFromLayout(
  paragraph: LayoutParagraph,
  noteStyleName: string,
): Paragraph {
  return new Paragraph({
    style: paragraph.styleName,
    children: runsToDocxChildren(paragraph.lines, noteStyleName),
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

function noteCharacterStyle(noteStyleName: string): ICharacterStyleOptions[] {
  return [
    {
      id: noteStyleName,
      name: noteStyleName,
      basedOn: "DefaultParagraphFont",
      quickFormat: true,
    },
  ];
}

function buildDocument(story: LayoutStory): Document {
  const children = story.paragraphs.map((p) =>
    paragraphFromLayout(p, story.noteStyleName),
  );

  return new Document({
    styles: {
      paragraphStyles: collectParagraphStyleNames(
        story.paragraphs.map((p) => p.styleName),
      ),
      characterStyles: noteCharacterStyle(story.noteStyleName),
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
): TableCell {
  return new TableCell({
    children: [paragraphFromLayout(paragraph, noteStyleName)],
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

  const columnWidths = gutterColumn
    ? [
        PARALLEL_SIDE_WITH_GUTTER_DXA,
        PARALLEL_GUTTER_DXA,
        PARALLEL_SIDE_WITH_GUTTER_DXA,
      ]
    : [PARALLEL_COLUMN_DXA, PARALLEL_COLUMN_DXA];

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths,
    rows: story.rows.map((row) => {
      const cells = [
        pairCell(row.left, story.noteStyleName),
        ...(gutterColumn ? [emptyGutterCell()] : []),
        pairCell(row.right, story.noteStyleName),
      ];
      return new TableRow({ children: cells });
    }),
  });

  return new Document({
    styles: {
      paragraphStyles: collectParagraphStyleNames(styleNames),
      characterStyles: noteCharacterStyle(story.noteStyleName),
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
