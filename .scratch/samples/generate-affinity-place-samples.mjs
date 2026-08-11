/**
 * One-off samples for Affinity / InDesign Place testing.
 * Paragraph styles = prayer kind names; character style "note" for inline notes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
} from "docx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "affinity-place-test");

function escapeRtf(text) {
  return [...text]
    .map((ch) => {
      const code = ch.codePointAt(0);
      if (ch === "\\") return "\\\\";
      if (ch === "{") return "\\{";
      if (ch === "}") return "\\}";
      if (code > 127) return `\\u${code}?`;
      return ch;
    })
    .join("");
}

function writeRtf() {
  // Style sheet: s1=heading, s2=annotation, s3=verse; cs10=note (char)
  const rtf = `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0 Times New Roman;}}
{\\stylesheet
{\\s1\\f0\\fs28 heading;}
{\\s2\\f0\\fs20\\i annotation;}
{\\s3\\f0\\fs24 verse;}
{\\*\\cs10\\i note;}
}
{\\pard\\s1\\f0\\fs28 ${escapeRtf("Trisagion")}\\par}
{\\pard\\s2\\f0\\fs20\\i ${escapeRtf("Dreimal:")}\\par}
{\\pard\\s3\\f0\\fs24 ${escapeRtf("Heiliger Gott,")}\\par}
{\\pard\\s3\\f0\\fs24 ${escapeRtf("heiliger ")}{\\cs10\\i ${escapeRtf("Starker")}}${escapeRtf(",")}\\par}
{\\pard\\s3\\f0\\fs24 ${escapeRtf("heiliger Unsterblicher, erbarme dich unser.")}\\par}
}
`;
  fs.writeFileSync(path.join(outDir, "html-sample.de.standard.rtf"), rtf, "utf8");
}

async function writeDocx() {
  const doc = new Document({
    styles: {
      default: {
        document: {
          styles: [
            {
              id: "Normal",
              name: "Normal",
              run: { font: "Times New Roman", size: 24 },
            },
          ],
        },
      },
      paragraphStyles: [
        {
          id: "heading",
          name: "heading",
          basedOn: "Normal",
          next: "Normal",
          quickStyle: true,
          run: { font: "Times New Roman", size: 28, bold: true },
          paragraph: { spacing: { after: 120 } },
        },
        {
          id: "annotation",
          name: "annotation",
          basedOn: "Normal",
          next: "Normal",
          quickStyle: true,
          run: { font: "Times New Roman", size: 20, italics: true },
          paragraph: { spacing: { after: 80 } },
        },
        {
          id: "verse",
          name: "verse",
          basedOn: "Normal",
          next: "Normal",
          quickStyle: true,
          run: { font: "Times New Roman", size: 24 },
          paragraph: { spacing: { after: 60 } },
        },
      ],
      characterStyles: [
        {
          id: "note",
          name: "note",
          basedOn: "DefaultParagraphFont",
          run: { italics: true },
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            style: "heading",
            children: [new TextRun("Trisagion")],
          }),
          new Paragraph({
            style: "annotation",
            children: [new TextRun("Dreimal:")],
          }),
          new Paragraph({
            style: "verse",
            children: [new TextRun("Heiliger Gott,")],
          }),
          new Paragraph({
            style: "verse",
            children: [
              new TextRun("heiliger "),
              new TextRun({ text: "Starker", style: "note", italics: true }),
              new TextRun(","),
            ],
          }),
          new Paragraph({
            style: "verse",
            children: [
              new TextRun("heiliger Unsterblicher, erbarme dich unser."),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(
    path.join(outDir, "html-sample.de.standard.docx"),
    buffer,
  );
}

fs.mkdirSync(outDir, { recursive: true });
writeRtf();
await writeDocx();

const readme = `# Affinity / InDesign Place test samples

Generated from the HTML-export sample prayer (Trisagion fragment).

## Files

| File | Format |
| --- | --- |
| \`html-sample.de.standard.docx\` | Word DOCX with paragraph styles \`heading\`, \`annotation\`, \`verse\` and character style \`note\` |
| \`html-sample.de.standard.rtf\` | RTF with the same style names |

## What to check in Affinity

1. Open **Affinity** (Studio / Affinity.app) or **Affinity Publisher 2**.
2. Create a text frame.
3. **File → Place** each file into the frame (try DOCX first, then RTF).
4. In Affinity Studio: Document Setup → Resources → enable **Import text as linked** if you want update-on-change; then Place again.
5. Inspect **Text Styles / Paragraph Styles**:
   - Are styles named \`heading\`, \`annotation\`, \`verse\` present?
   - Is inline \`note\` (italic "Starker") preserved?
6. Optionally open the same files in **InDesign** via Place + Show Import Options → Preserve Styles.

## Regenerating

\`\`\`bash
node samples/generate-affinity-place-samples.mjs
\`\`\`
`;

fs.writeFileSync(path.join(outDir, "README.md"), readme);
console.log("Wrote samples to", outDir);
