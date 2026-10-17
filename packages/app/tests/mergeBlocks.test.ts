import { describe, expect, it } from "vitest";
import type { Block, Prayer } from "@orthodox-prayer-toolkit/core";
import { getTranslation, mergeBlocks } from "../src/prayerEdit";

const de = { lang: "de", variant: "standard" };
const en = { lang: "en", variant: "standard" };

function prayerWith(...structure: Block[]): Prayer {
  return {
    id: "merge",
    type: "prayer",
    tone: null,
    variants: [
      { lang: "de", variant: "standard", title: "M", license: "unknown", source: "t" },
      { lang: "en", variant: "standard", title: "M", license: "unknown", source: "t" },
    ],
    structure,
    meta: {},
  };
}

describe("mergeBlocks", () => {
  it("joins text directly in every variant, caret at the seam", () => {
    const p = prayerWith(
      {
        id: "a",
        kind: "rubric",
        translations: [
          { lang: "de", variant: "standard", text: "Ehre sei" },
          { lang: "en", variant: "standard", text: "Glory" },
        ],
      },
      {
        id: "b",
        kind: "prose",
        translations: [
          { lang: "de", variant: "standard", text: " dem Vater" },
          { lang: "en", variant: "standard", text: "to the Father" },
        ],
      },
      { id: "c", kind: "rubric", translations: [] },
    );
    const r = mergeBlocks(p, 0, "upper", de)!;
    expect(r.blockId).toBe("a");
    expect(r.caret).toBe("Ehre sei".length);
    expect(r.prayer.structure.map((b) => b.id)).toEqual(["a", "c"]);
    expect(r.prayer.structure[0]!.kind).toBe("rubric");
    expect(getTranslation(r.prayer, "a", de)?.text).toBe("Ehre sei dem Vater");
    expect(getTranslation(r.prayer, "a", en)?.text).toBe("Gloryto the Father");
  });

  it("keeps the lower block's kind and id at the upper position", () => {
    const p = prayerWith(
      { id: "x", kind: "rubric", translations: [] },
      { id: "a", kind: "rubric", translations: [{ lang: "de", variant: "standard", text: "A" }] },
      { id: "b", kind: "prose", translations: [{ lang: "de", variant: "standard", text: "B" }] },
    );
    const r = mergeBlocks(p, 1, "lower", de)!;
    expect(r.blockId).toBe("b");
    expect(r.prayer.structure.map((b) => `${b.id}:${b.kind}`)).toEqual([
      "x:rubric",
      "b:prose",
    ]);
    expect(getTranslation(r.prayer, "b", de)?.text).toBe("AB");
    expect(r.caret).toBe(1);
  });

  it("keeps verse lines separate", () => {
    const p = prayerWith(
      { id: "a", kind: "verse", translations: [{ lang: "de", variant: "standard", lines: ["1", "2", "3", "4"] }] },
      { id: "b", kind: "verse", translations: [{ lang: "de", variant: "standard", lines: ["5", "6", "7"] }] },
    );
    const up = mergeBlocks(p, 0, "upper", de)!;
    expect(getTranslation(up.prayer, "a", de)?.lines).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    // End of line "4": 4 chars + 3 separators.
    expect(up.caret).toBe(7);
    const low = mergeBlocks(p, 0, "lower", de)!;
    // Start of line "5".
    expect(low.caret).toBe(8);
  });

  it("reshapes text into verse lines and back, notes kept", () => {
    const text: Block = {
      id: "t",
      kind: "prose",
      translations: [
        {
          lang: "de",
          variant: "standard",
          text: [
            { t: "text", v: "eins\nzwei " },
            { t: "note", v: "(leise)" },
          ],
        },
      ],
    };
    const verse: Block = {
      id: "v",
      kind: "verse",
      translations: [{ lang: "de", variant: "standard", lines: ["drei", "vier"] }],
    };

    const asVerse = mergeBlocks(prayerWith(text, verse), 0, "lower", de)!;
    expect(asVerse.prayer.structure[0]!.kind).toBe("verse");
    expect(getTranslation(asVerse.prayer, "v", de)?.lines).toEqual([
      "eins",
      [
        { t: "text", v: "zwei " },
        { t: "note", v: "(leise)" },
      ],
      "drei",
      "vier",
    ]);

    const asText = mergeBlocks(prayerWith(text, verse), 0, "upper", de)!;
    expect(getTranslation(asText.prayer, "t", de)?.text).toEqual([
      { t: "text", v: "eins\nzwei " },
      { t: "note", v: "(leise)" },
      { t: "text", v: "drei\nvier" },
    ]);
    expect(asText.caret).toBe("eins\nzwei (leise)".length);
  });

  it("carries a variant that only one block has", () => {
    const p = prayerWith(
      { id: "a", kind: "prose", translations: [{ lang: "de", variant: "standard", text: "nur de" }] },
      { id: "b", kind: "prose", translations: [{ lang: "en", variant: "standard", text: "only en" }] },
    );
    const r = mergeBlocks(p, 0, "upper", de)!;
    expect(getTranslation(r.prayer, "a", de)?.text).toBe("nur de");
    expect(getTranslation(r.prayer, "a", en)?.text).toBe("only en");
  });

  it("puts the caret at 0 when the typing column is empty on top", () => {
    const p = prayerWith(
      { id: "a", kind: "prose", translations: [] },
      { id: "b", kind: "prose", translations: [{ lang: "de", variant: "standard", text: "Text" }] },
    );
    const r = mergeBlocks(p, 0, "lower", de)!;
    expect(r.caret).toBe(0);
    expect(getTranslation(r.prayer, "b", de)?.text).toBe("Text");
  });

  it("returns null without a neighbour", () => {
    const p = prayerWith({ id: "a", kind: "prose", translations: [] });
    expect(mergeBlocks(p, 0, "upper", de)).toBeNull();
  });
});
