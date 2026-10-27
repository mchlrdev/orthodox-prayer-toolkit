import { describe, expect, it } from "vitest";
import type { DraftBlock, SegmentMark } from "@orthodox-prayer-toolkit/core";
import { markedPieces, sourceParts, type SegmentInfo } from "../src/importDraft/sourceView";

const red: SegmentMark["look"] = { color: "#c00000" };
const segments = new Map<string, SegmentInfo>([
  [
    "s1-1",
    {
      n: 1,
      text: "Gepriesen bist du, Herr, (Verneigung) lehre mich.",
      look: {},
      marks: [{ start: 25, end: 37, look: red }],
    },
  ],
]);

function block(start: number, end: number): DraftBlock {
  return { id: "b", kind: "text", content: { "de/standard": [{ seg: "s1-1", start, end }] } } as DraftBlock;
}

describe("source view marks", () => {
  it("moves marks with the part of the segment a block shows", () => {
    // Block split after "Herr, ": the second block starts at 24 (a space).
    const [part] = sourceParts(block(24, 49), segments);
    expect(part!.text).toBe("(Verneigung) lehre mich.");
    expect(part!.marks).toEqual([{ start: 0, end: 12, look: red }]);
    expect(sourceParts(block(0, 24), segments)[0]!.marks).toBeUndefined();
  });

  it("cuts text at its marks", () => {
    expect(markedPieces("ab cd ef", [{ start: 3, end: 5, look: red }])).toEqual([
      { text: "ab " },
      { text: "cd", mark: { start: 3, end: 5, look: red } },
      { text: " ef" },
    ]);
    expect(markedPieces("ab", undefined)).toEqual([{ text: "ab" }]);
  });
});
