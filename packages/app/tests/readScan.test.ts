import { describe, expect, it } from "vitest";
import { measureInk } from "../src/importDraft/readScan";

/** A 40×20 image: paper, with a word drawn in the given ink on its left half. */
function image(ink: [number, number, number]): ImageData {
  const width = 40;
  const height = 20;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Thin strokes: every third column of the word is ink, the rest paper.
      const [r, g, b] = x < 20 && x % 3 === 0 ? ink : [244, 239, 228];
      data.set([r, g, b, 255], i);
    }
  }
  return { width, height, data, colorSpace: "srgb" } as ImageData;
}

const line = {
  text: "Priester:",
  bbox: { x0: 0, y0: 0, x1: 20, y1: 20 },
  baseline: { x0: 0, y0: 16, x1: 20, y1: 16 },
  rowHeight: 20,
  confidence: 95,
  words: [{ text: "Priester:", bbox: { x0: 0, y0: 0, x1: 20, y1: 20 }, confidence: 95 }],
};

describe("scan ink", () => {
  it("measures the letters, not the paper", () => {
    expect(measureInk(image([165, 42, 42]), line)).toEqual([165, 42, 42]);
    expect(measureInk(image([26, 26, 26]), line)).toEqual([26, 26, 26]);
  });

  it("needs a few pixels", () => {
    expect(measureInk(image([0, 0, 0]), { ...line, words: [] })).toBeUndefined();
  });
});
