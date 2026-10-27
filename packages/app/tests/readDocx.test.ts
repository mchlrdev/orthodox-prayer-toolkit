// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Source } from "@orthodox-prayer-toolkit/core";
import { DocxWithoutDocumentError, readDocx } from "../src/importDraft/readDocx";
import { makeDocx, stylesXml } from "./fixtures/makeDocx";

/** Styles like a prayer book manuscript: heading, rubric, body text. */
const STYLES = stylesXml(
  `<w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/></w:style>
   <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Standard"/>
     <w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
   <w:style w:type="paragraph" w:styleId="Rubrik"><w:name w:val="Rubrik"/><w:basedOn w:val="Standard"/>
     <w:rPr><w:i/><w:color w:val="C00000"/><w:sz w:val="20"/></w:rPr></w:style>
   <w:style w:type="character" w:styleId="RotZeichen"><w:name w:val="Rot"/><w:rPr><w:color w:val="C00000"/></w:rPr></w:style>`,
  `<w:sz w:val="24"/><w:lang w:val="en-US"/>`,
);

const p = (runs: string, style?: string, pPr = "") =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${pPr}</w:pPr>${runs}</w:p>`;
const r = (text: string, rPr = "") =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;

async function read(body: string, styles: string | null = STYLES): Promise<Source> {
  return readDocx(await makeDocx(body, styles ?? undefined), { name: "test.docx" });
}

function seg(source: Source, start: string) {
  const found = source.segments.find((s) => s.text.startsWith(start));
  if (!found) throw new Error(`No segment “${start}”: ${source.segments.map((s) => s.text).join(" | ")}`);
  return found;
}

describe("Word Reader", () => {
  it("makes one segment per paragraph with its named style", async () => {
    const source = await read(
      p(r("Troparion der Auferstehung"), "Heading1") +
        p(r("Im 5. Ton"), "Rubrik") +
        p(r("Christus ist erstanden von den Toten,") + "<w:r><w:br/></w:r>" + r("hat zertreten im Tode den Tod.")) +
        p("") +
        p(r("Dreimal."), "Rubrik"),
    );
    expect(source.format).toBe("docx");
    expect(source.name).toBe("test.docx");
    expect(source.segments.map((s) => s.text)).toEqual([
      "Troparion der Auferstehung",
      "Im 5. Ton",
      "Christus ist erstanden von den Toten,\nhat zertreten im Tode den Tod.",
      "Dreimal.",
    ]);
    expect(seg(source, "Troparion").look).toEqual({
      paragraphStyle: "heading 1",
      weight: "bold",
      style: "normal",
      size: "16pt",
      align: "center",
    });
    expect(seg(source, "Im 5. Ton").look).toMatchObject({
      paragraphStyle: "Rubrik",
      style: "italic",
      color: "#c00000",
      size: "10pt",
    });
    expect(seg(source, "Christus").look).toEqual({
      paragraphStyle: "Normal",
      weight: "normal",
      style: "normal",
      size: "12pt",
    });
  });

  it("groups same-looking paragraphs into style groups", async () => {
    const source = await read(
      p(r("Im 5. Ton"), "Rubrik") + p(r("Ehre sei dem Vater.")) + p(r("Dreimal."), "Rubrik"),
    );
    expect(seg(source, "Im 5. Ton").group).toBe(seg(source, "Dreimal.").group);
    expect(seg(source, "Ehre").group).not.toBe(seg(source, "Im 5. Ton").group);
  });

  it("reads direct formatting: the look of most of the text, the rest as marks", async () => {
    const source = await read(
      p(r("Gepriesen bist du, Herr, ") + r("(Verneigung)", "<w:i/><w:color w:val=\"C00000\"/>") + r(" lehre mich deine Satzungen.")) +
        p(r("Herr, erbarme dich.", "<w:b/>")) +
        p(r("Ehre sei dem Vater ") + r("und", '<w:rStyle w:val="RotZeichen"/>') + r(" dem Sohne.")),
    );
    const bow = seg(source, "Gepriesen");
    expect(bow.look).toMatchObject({ weight: "normal", style: "normal" });
    expect(bow.marks).toEqual([
      {
        start: 25,
        end: 37,
        look: { weight: "normal", style: "italic", size: "12pt", color: "#c00000" },
      },
    ]);
    expect(bow.text.slice(25, 37)).toBe("(Verneigung)");

    // A whole paragraph formatted directly: its look, no marks.
    const bold = seg(source, "Herr, erbarme");
    expect(bold.look).toMatchObject({ weight: "bold" });
    expect(bold.marks).toBeUndefined();

    // Character style.
    const glory = seg(source, "Ehre sei");
    expect(glory.marks).toHaveLength(1);
    expect(glory.text.slice(glory.marks![0]!.start, glory.marks![0]!.end)).toBe("und");
    expect(glory.marks![0]!.look.color).toBe("#c00000");
  });

  it("reads table cells row by row with their column", async () => {
    const cell = (text: string) => `<w:tc>${p(r(text))}</w:tc>`;
    const source = await read(
      p(r("Ektenie"), "Heading1") +
        `<w:tbl><w:tr>${cell("Herr, erbarme dich.")}${cell("Господи, помилуй.")}</w:tr>` +
        `<w:tr>${cell("Gewähre, o Herr.")}${cell("Подай, Господи.")}</w:tr></w:tbl>`,
    );
    expect(source.segments.map((s) => [s.text, s.look.column])).toEqual([
      ["Ektenie", undefined],
      ["Herr, erbarme dich.", 1],
      ["Господи, помилуй.", 2],
      ["Gewähre, o Herr.", 1],
      ["Подай, Господи.", 2],
    ]);
    // Columns form their own style groups (one per language, usually).
    expect(seg(source, "Herr").group).toBe(seg(source, "Gewähre").group);
    expect(seg(source, "Herr").group).not.toBe(seg(source, "Господи").group);
  });

  it("follows links and tracked insertions, skips deletions and field codes", async () => {
    const source = await read(
      p(
        r("Vater ") +
          `<w:hyperlink><w:r><w:t>unser</w:t></w:r></w:hyperlink>` +
          `<w:del><w:r><w:delText>alt</w:delText></w:r></w:del>` +
          `<w:ins><w:r><w:t xml:space="preserve">, der du bist</w:t></w:r></w:ins>` +
          `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r>` +
          `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
          r("\tim Himmel."),
      ),
    );
    expect(source.segments.map((s) => s.text)).toEqual(["Vater unser, der du bist im Himmel."]);
  });

  it("takes the language of the runs, not the editor default", async () => {
    const source = await read(
      p(r("Christos voskrese!", '<w:lang w:val="ru-RU"/>')) + p(r("Christus ist erstanden!")),
    );
    expect(seg(source, "Christos").lang).toBe("ru-RU");
    expect(seg(source, "Christus").lang).toBeUndefined();
  });

  it("reads a document without styles", async () => {
    const source = await read(p(r("Amen.")), null);
    expect(source.segments).toEqual([
      expect.objectContaining({ text: "Amen.", look: { weight: "normal", style: "normal" } }),
    ]);
  });

  it("refuses a file that is no Word document", async () => {
    await expect(readDocx(new TextEncoder().encode("hello"))).rejects.toBeInstanceOf(
      DocxWithoutDocumentError,
    );
  });
});
