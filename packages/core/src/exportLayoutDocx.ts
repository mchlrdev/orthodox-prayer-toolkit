import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphStyleOptions,
  type ICharacterStyleOptions,
} from "docx";
import {
  buildLayoutStory,
  type ExportLayoutOptions,
  type LayoutRun,
  type LayoutStory,
} from "./layoutModel.js";
import type { Prayer } from "./types.js";

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

function buildDocument(story: LayoutStory): Document {
  const paraNames = [...new Set(story.paragraphs.map((p) => p.styleName))];

  const paragraphStyles: IParagraphStyleOptions[] = paraNames.map((name) => ({
    id: name,
    name,
    basedOn: "Normal",
    next: "Normal",
    quickFormat: true,
  }));

  const characterStyles: ICharacterStyleOptions[] = [
    {
      id: story.noteStyleName,
      name: story.noteStyleName,
      basedOn: "DefaultParagraphFont",
      quickFormat: true,
    },
  ];

  const children = story.paragraphs.map(
    (p) =>
      new Paragraph({
        style: p.styleName,
        children: runsToDocxChildren(p.lines, story.noteStyleName),
      }),
  );

  return new Document({
    styles: {
      paragraphStyles,
      characterStyles,
    },
    sections: [
      {
        properties: {},
        children,
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
