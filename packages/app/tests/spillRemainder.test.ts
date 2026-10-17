import { describe, expect, it } from "vitest";
import type { Block, Prayer } from "@orthodox-prayer-toolkit/core";
import {
  getTranslation,
  moveRemainderToNext,
  splitEditorContent,
} from "../src/prayerEdit";

const de = { lang: "de", variant: "standard" };
const es = { lang: "es", variant: "standard" };

function prayerWith(...structure: Block[]): Prayer {
  return {
    id: "spill",
    type: "prayer",
    tone: null,
    variants: [
      { lang: "de", variant: "standard", title: "M", license: "unknown", source: "t" },
      { lang: "es", variant: "standard", title: "M", license: "unknown", source: "t" },
    ],
    structure,
    meta: {},
  };
}

describe("moveRemainderToNext", () => {
  it("fills an empty next cell without inserting a block", () => {
    const p = prayerWith(
      {
        id: "b1",
        kind: "verse",
        translations: [
          { lang: "de", variant: "standard", lines: ["Diakon:"] },
          {
            lang: "es",
            variant: "standard",
            lines: ["Diácono: Una y otra vez roguemos en paz al Señor."],
          },
        ],
      },
      {
        id: "b2",
        kind: "verse",
        translations: [
          {
            lang: "de",
            variant: "standard",
            lines: ["Noch einmal und abermals lasset uns in Frieden beten."],
          },
        ],
      },
    );
    const { before, after } = splitEditorContent(
      ["Diácono: Una y otra vez roguemos en paz al Señor."],
      "Diácono: ".length,
      "Diácono: ".length,
      true,
    );

    const next = moveRemainderToNext(p, 0, es, before, after)!;
    expect(next.structure.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(getTranslation(next, "b1", es)?.lines).toEqual(["Diácono: "]);
    expect(getTranslation(next, "b2", es)?.lines).toEqual([
      "Una y otra vez roguemos en paz al Señor.",
    ]);
    expect(getTranslation(next, "b1", de)?.lines).toEqual(["Diakon:"]);
    expect(getTranslation(next, "b2", de)?.lines).toEqual([
      "Noch einmal und abermals lasset uns in Frieden beten.",
    ]);
  });

  it("prepends onto text already in the next cell", () => {
    const p = prayerWith(
      {
        id: "b1",
        kind: "verse",
        translations: [
          { lang: "de", variant: "standard", lines: ["Herr, erbarme dich."] },
        ],
      },
      {
        id: "b2",
        kind: "verse",
        translations: [
          { lang: "de", variant: "standard", lines: ["Amen."] },
        ],
      },
    );
    const { before, after } = splitEditorContent(
      ["Herr, erbarme dich."],
      6,
      6,
      true,
    );

    const next = moveRemainderToNext(p, 0, de, before, after)!;
    expect(getTranslation(next, "b1", de)?.lines).toEqual(["Herr, "]);
    expect(getTranslation(next, "b2", de)?.lines).toEqual([
      "erbarme dich.",
      "Amen.",
    ]);
  });

  it("prepends text kinds with no separator", () => {
    const p = prayerWith(
      {
        id: "b1",
        kind: "rubric",
        translations: [
          { lang: "de", variant: "standard", text: "Stehend beten." },
        ],
      },
      {
        id: "b2",
        kind: "rubric",
        translations: [
          { lang: "de", variant: "standard", text: "Leise." },
        ],
      },
    );
    const { before, after } = splitEditorContent("Stehend beten.", 8, 8, false);

    const next = moveRemainderToNext(p, 0, de, before, after)!;
    expect(getTranslation(next, "b1", de)?.text).toBe("Stehend ");
    expect(getTranslation(next, "b2", de)?.text).toBe("beten.Leise.");
  });

  it("reshapes a verse remainder into a text block", () => {
    const p = prayerWith(
      {
        id: "b1",
        kind: "verse",
        translations: [
          { lang: "de", variant: "standard", lines: ["eins", "zwei"] },
        ],
      },
      {
        id: "b2",
        kind: "rubric",
        translations: [{ lang: "de", variant: "standard", text: "drei" }],
      },
    );
    const { before, after } = splitEditorContent(["eins", "zwei"], 4, 4, true);

    const next = moveRemainderToNext(p, 0, de, before, after)!;
    expect(getTranslation(next, "b1", de)?.lines).toEqual(["eins"]);
    expect(getTranslation(next, "b2", de)?.text).toBe("zweidrei");
  });

  it("commits the current cell and leaves the next when the caret is at the end", () => {
    const p = prayerWith(
      {
        id: "b1",
        kind: "verse",
        translations: [
          { lang: "de", variant: "standard", lines: ["Amen"] },
        ],
      },
      {
        id: "b2",
        kind: "verse",
        translations: [
          { lang: "de", variant: "standard", lines: ["Herr,"] },
        ],
      },
    );
    const { before, after } = splitEditorContent(["Amen"], 4, 4, true);
    expect(after).toBeNull();

    const next = moveRemainderToNext(p, 0, de, before, after)!;
    expect(getTranslation(next, "b1", de)?.lines).toEqual(["Amen"]);
    expect(getTranslation(next, "b2", de)?.lines).toEqual(["Herr,"]);
  });

  it("returns null without a next block", () => {
    const p = prayerWith({
      id: "b1",
      kind: "verse",
      translations: [{ lang: "de", variant: "standard", lines: ["Amen"] }],
    });
    expect(moveRemainderToNext(p, 0, de, ["Amen"], null)).toBeNull();
  });
});
