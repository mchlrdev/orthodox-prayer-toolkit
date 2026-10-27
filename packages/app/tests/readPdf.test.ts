import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  createImportDraft,
  importDraftToPrayer,
  type Source,
} from "@orthodox-prayer-toolkit/core";
import { PdfWithoutTextError, segmentPdfPages } from "../src/importDraft/pdfLayout";
import { pdfDocumentText } from "../src/importDraft/pdfText";
import { makePdf, type PdfRun } from "./fixtures/makePdf";

const STANDARD_FONTS = `${join(
  dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")),
  "standard_fonts",
)}/`;

async function read(pages: PdfRun[][]): Promise<Source> {
  const doc = await getDocument({
    data: makePdf(pages),
    standardFontDataUrl: STANDARD_FONTS,
  }).promise;
  try {
    return segmentPdfPages(await pdfDocumentText(doc), { name: "test.pdf" });
  } finally {
    await doc.destroy();
  }
}

function seg(source: Source, start: string) {
  const found = source.segments.find((s) => s.text.startsWith(start));
  if (!found) throw new Error(`No segment starting “${start}”: ${source.segments.map((s) => s.text).join(" | ")}`);
  return found;
}

/** A page of a prayer book: running head, heading, tone, prose with a hyphen, verse. */
const PAGE: PdfRun[] = [
  { x: 40, y: 30, size: 8, text: "PASCHA" },
  { x: 370, y: 30, size: 8, text: "12" },
  { x: 110, y: 70, size: 16, font: "bold", text: "Troparion der Auferstehung" },
  { x: 180, y: 95, size: 11, font: "italic", text: "Im 5. Ton" },
  { x: 40, y: 125, text: "Ehre sei dem Vater und dem Sohn und dem Heiligen Geiste, jetzt" },
  { x: 40, y: 139, text: "und immerdar und von Ewigkeit zu Ewigkeit. Amen. Christus ist er-" },
  { x: 40, y: 153, text: "standen von den Toten." },
  { x: 40, y: 185, text: "Christus ist erstanden von den Toten," },
  { x: 40, y: 199, text: "hat zertreten im Tode den Tod," },
  { x: 40, y: 213, text: "und denen in den Gräbern das Leben geschenkt." },
  { x: 180, y: 245, size: 11, font: "italic", text: "Dreimal." },
];

describe("PDF Reader", () => {
  it("makes paragraphs: headings, prose with a broken word, verse lines", async () => {
    const source = await read([PAGE, PAGE.map((r) => (r.text === "12" ? { ...r, text: "13" } : r))]);
    expect(source.format).toBe("pdf");
    const page1 = source.segments.filter((s) => s.area?.page === 1).map((s) => s.text);
    expect(page1).toEqual([
      "PASCHA",
      "12",
      "Troparion der Auferstehung",
      "Im 5. Ton",
      "Ehre sei dem Vater und dem Sohn und dem Heiligen Geiste, jetzt und immerdar und von Ewigkeit zu Ewigkeit. Amen. Christus ist er-standen von den Toten.",
      "Christus ist erstanden von den Toten,\nhat zertreten im Tode den Tod,\nund denen in den Gräbern das Leben geschenkt.",
      "Dreimal.",
    ]);
  });

  it("keeps a word-breaking hyphen in the source and drops it in the draft", async () => {
    const source = await read([PAGE]);
    const prose = seg(source, "Ehre sei");
    expect(prose.drop).toHaveLength(1);
    expect(prose.text.slice(prose.drop![0]!.start, prose.drop![0]!.end)).toBe("-");
    const draft = createImportDraft({ sources: [source], variant: { lang: "de", variant: "standard" } });
    const lines = importDraftToPrayer(draft).structure.flatMap((b) => b.translations[0]!.lines ?? []);
    expect(lines).toContain(
      "Ehre sei dem Vater und dem Sohn und dem Heiligen Geiste, jetzt und immerdar und von Ewigkeit zu Ewigkeit. Amen. Christus ist erstanden von den Toten.",
    );
  });

  it("groups same-looking paragraphs and keeps the look", async () => {
    const source = await read([PAGE]);
    expect(seg(source, "Im 5. Ton").group).toBe(seg(source, "Dreimal.").group);
    expect(seg(source, "Ehre sei").group).not.toBe(seg(source, "Im 5. Ton").group);
    expect(seg(source, "Troparion").look).toMatchObject({ weight: "bold", size: "16pt", align: "center" });
    expect(seg(source, "Im 5. Ton").look).toMatchObject({ style: "italic", font: "Times-Italic" });
  });

  it("marks running heads and page numbers, repeated on the page edges", async () => {
    const source = await read([PAGE, PAGE.map((r) => (r.text === "12" ? { ...r, text: "13" } : r))]);
    const furniture = source.segments.filter((s) => s.furniture).map((s) => s.text);
    expect(furniture).toEqual(["PASCHA", "12", "PASCHA", "13"]);
    expect(seg(source, "Troparion").furniture).toBeUndefined();
  });

  it("reads two columns one after the other, below a full-width heading", async () => {
    const left = ["Herr, erbarme dich unser.", "Christus, erbarme dich", "unser. Herr, erbarme dich."];
    const right = ["Gospodi, pomiluj nas.", "Christe, pomiluj nas.", "Gospodi, pomiluj nas."];
        // Centred over both columns, across the gutter.
    const runs: PdfRun[] = [{ x: 180, y: 60, size: 14, font: "bold", text: "Ektenie" }];
    left.forEach((text, i) => runs.push({ x: 40, y: 100 + i * 14, text }));
    right.forEach((text, i) => runs.push({ x: 230, y: 100 + i * 14, text }));
    runs.push({ x: 40, y: 160, text: "Und der Diakon spricht weiter." });
    runs.push({ x: 230, y: 160, text: "I diakon govorit dalee." });
    const source = await read([runs]);
    expect(source.segments.map((s) => [s.text, s.area?.column])).toEqual([
      ["Ektenie", undefined],
      // Lines that fill the narrow column wrap: joined with spaces.
      ["Herr, erbarme dich unser. Christus, erbarme dich\nunser. Herr, erbarme dich.", 0],
      ["Und der Diakon spricht weiter.", 0],
      ["Gospodi, pomiluj nas. Christe, pomiluj nas. Gospodi, pomiluj nas.", 1],
      ["I diakon govorit dalee.", 1],
    ]);
  });

  it("puts each segment's area on the page where its text is", async () => {
    const source = await read([PAGE]);
    const area = seg(source, "Christus ist erstanden von den Toten,").area!;
    expect(area.page).toBe(1);
    expect(area.x).toBeCloseTo(40, 0);
    expect(area.y).toBeGreaterThan(170);
    expect(area.y).toBeLessThan(185);
    expect(area.y + area.height).toBeGreaterThan(213);
    expect(area.y + area.height).toBeLessThan(220);
  });

  it("refuses a PDF without text", async () => {
    await expect(read([[]])).rejects.toBeInstanceOf(PdfWithoutTextError);
  });
});
