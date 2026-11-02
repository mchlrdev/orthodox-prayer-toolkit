import { describe, expect, it } from "vitest";
import { createImportDraft, importDraftToPrayer } from "@orthodox-prayer-toolkit/core";
import {
  fixMixedScript,
  ImageWithoutTextError,
  inkColor,
  pageSlope,
  segmentOcrPages,
  type OcrLine,
  type OcrPage,
} from "../src/importDraft/ocrLayout";
import recorded from "./fixtures/ocrScanPage.json";

/** Tesseract's lines for a scanned page (tilted 1.2°, JPEG), inks as the app measures them. */
const SCAN = recorded as unknown as OcrPage;

/** A level line of words, 20px letters, 10px per character. */
function line(text: string, x: number, y: number, extra: Partial<OcrLine> = {}): OcrLine {
  let at = x;
  const words = text.split(" ").map((w) => {
    const word = { text: w, bbox: { x0: at, y0: y - 16, x1: at + w.length * 10, y1: y + 4 }, confidence: 95 };
    at += w.length * 10 + 6;
    return word;
  });
  const end = words.at(-1)!.bbox.x1;
  return {
    text,
    bbox: { x0: x, y0: y - 16, x1: end, y1: y + 4 },
    baseline: { x0: x, y0: y, x1: end, y1: y },
    rowHeight: 20,
    confidence: 95,
    words,
    ...extra,
  };
}

describe("scan layout", () => {
  it("joins the recognised lines of a tilted scan into paragraphs", () => {
    const source = segmentOcrPages([SCAN], { name: "scan.jpg" });
    expect(source).toMatchObject({ format: "image", name: "scan.jpg" });
    expect(source.segments.map((s) => s.text)).toEqual([
      "Troparion der Auferstehung",
      "Im 5. Ton. Dreimal.",
      "Christus ist erstanden von den Toten, hat zertreten im Tode den Tod, und denen in den Gräbern das Leben geschenkt.",
      "Христос воскресе из мертвых, смертию смерть поправ, и сущим во гробех живот даровав.",
      "Priester:",
      "Ehre sei dem Vater und dem Sohne und dem Heiligen Geiste, jetzt und immerdar und in alle Ewigkeit. Amen.",
      "Dann das Kontakion im 8. Ton:",
      // Tesseract read a Cyrillic "о"; the German line gets its Latin twin.
      "Bist du auch ins Grab hinabgestiegen, o Unsterblicher, so hast du doch die Macht des Hades zerstört.",
    ]);
    expect(pageSlope(SCAN)).toBeCloseTo(0.021, 3);
  });

  it("gives same-sized lines in the same ink one style group", () => {
    const [title, tone, verse, slavonic, priest] = segmentOcrPages([SCAN]).segments;
    expect(title!.look).toEqual({ align: "center", size: "24px" });
    expect(tone!.look).toEqual({ color: "#a52a2a", size: "13px" });
    expect(verse!.look).toEqual({ size: "16px" });
    expect(priest!.group).toBe(tone!.group);
    expect(slavonic!.group).toBe(verse!.group);
    expect(title!.group).not.toBe(verse!.group);
  });

  it("keeps where each paragraph sits in the image and how sure the reading was", () => {
    const verse = segmentOcrPages([SCAN]).segments[2]!;
    expect(verse.confidence).toBe(0.96);
    // Both lines of the tilted paragraph are inside its box.
    const { x, y, width, height } = verse.area!;
    for (const l of SCAN.lines.slice(2, 4)) {
      expect(l.bbox.x0).toBeGreaterThanOrEqual(x - 1);
      expect(l.bbox.x1).toBeLessThanOrEqual(x + width + 1);
      expect(l.bbox.y0).toBeGreaterThanOrEqual(y - 1);
      expect(l.bbox.y1).toBeLessThanOrEqual(y + height + 1);
    }
  });

  it("marks words read with low confidence", () => {
    const page: OcrPage = { page: 1, width: 800, height: 1000, lines: [line("Ehre sei dem Vater", 100, 300)] };
    page.lines[0]!.words[2]!.confidence = 41;
    const [segment] = segmentOcrPages([page]).segments;
    expect(segment!.uncertain).toEqual([
      { start: 9, end: 12, confidence: 0.41, box: { x: 182, y: 284, width: 30, height: 20 } },
    ]);
    expect(segment!.text.slice(9, 12)).toBe("dem");
  });

  it("reads two columns one after the other and leaves page numbers out", () => {
    const page: OcrPage = {
      page: 1,
      width: 1000,
      height: 1000,
      lines: [
        line("Gesegnet ist unser Gott", 60, 200),
        line("Благословен Бог наш", 560, 200),
        line("allezeit, jetzt und immerdar", 60, 226),
        line("всегда, ныне и присно", 560, 226),
        line("und in alle Ewigkeit.", 60, 252),
        line("и во веки веков.", 560, 252),
        line("Gesegnet ist das Reich", 60, 330),
        line("Благословенно Царство", 560, 330),
        line("12", 490, 970),
      ],
    };
    const source = segmentOcrPages([page]);
    expect(source.segments.map((s) => [s.text.split(/\s/)[0], s.area?.column, s.furniture])).toEqual([
      ["Gesegnet", 0, undefined],
      ["Gesegnet", 0, undefined],
      ["Благословен", 1, undefined],
      ["Благословенно", 1, undefined],
      ["12", 1, true],
    ]);
  });

  it("becomes an Import draft like any Source", () => {
    const draft = createImportDraft({ sources: [segmentOcrPages([SCAN])], variant: { lang: "de", variant: "standard" } });
    expect(draft.blocks).toHaveLength(8);
    expect(importDraftToPrayer(draft).structure).toHaveLength(8);
  });

  it("refuses an image without text", () => {
    expect(() => segmentOcrPages([{ page: 1, width: 100, height: 100, lines: [] }])).toThrow(ImageWithoutTextError);
  });
});

describe("scan helpers", () => {
  it("sorts measured ink into black, grey and colours", () => {
    expect(inkColor([30, 28, 25])).toBeUndefined();
    expect(inkColor([140, 138, 135])).toBe("#808080");
    expect(inkColor([150, 45, 40])).toBe("#a52a2a");
    expect(inkColor([40, 60, 150])).toBe("#1f3f99");
    expect(inkColor(undefined)).toBeUndefined();
  });

  it("fixes look-alike letters only where the line's script is clear", () => {
    expect(fixMixedScript(["Bist", "du", "о", "Gott"])).toEqual(["Bist", "du", "o", "Gott"]);
    expect(fixMixedScript(["Xристос", "воскресе"])).toEqual(["Христос", "воскресе"]);
    // No twin for "m": left as read.
    expect(fixMixedScript(["Amen", "воскресе", "из", "мертвых"])).toEqual(["Amen", "воскресе", "из", "мертвых"]);
    // A parallel line (both scripts in strength) stays.
    expect(fixMixedScript(["Gott", "Бог"])).toEqual(["Gott", "Бог"]);
  });
});
