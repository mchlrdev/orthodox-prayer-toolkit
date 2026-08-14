import { describe, expect, it } from "vitest";
import type { Prayer, StyleMap } from "@orthodox-prayer-toolkit/core";
import {
  addBlock,
  applyCommittedContent,
  committedContentUnchanged,
  editorCommitUnchanged,
  deleteKindWithStyles,
  fillPercent,
  getTranslation,
  insertBlockAfter,
  isBlockEmptyAcrossVariants,
  isTranslationFilled,
  moveBlock,
  removeBlock,
  renameKindWithStyles,
  setBlockKind,
  translationEditorContent,
} from "../src/prayerEdit";

const col = { lang: "de", variant: "standard" };

function basePrayer(): Prayer {
  return {
    id: "morning",
    type: "prayer",
    tone: null,
    variants: [
      {
        lang: "de",
        variant: "standard",
        title: "Morgen",
        license: "unknown",
        source: "test",
      },
    ],
    structure: [
      {
        id: "b1",
        kind: "verse",
        translations: [],
      },
      {
        id: "b2",
        kind: "rubric",
        translations: [
          { lang: "de", variant: "standard", text: "Stehend" },
        ],
      },
    ],
    meta: {},
  };
}

describe("applyCommittedContent", () => {
  it("stores verse content as lines", () => {
    const next = applyCommittedContent(basePrayer(), "b1", col, [
      "Herr,",
      "erbarme dich.",
    ]);
    const tr = getTranslation(next, "b1", col);
    expect(tr?.lines).toEqual(["Herr,", "erbarme dich."]);
    expect(tr?.text).toBeUndefined();
  });

  it("clears empty verse commits", () => {
    const withText = applyCommittedContent(basePrayer(), "b1", col, ["x"]);
    const cleared = applyCommittedContent(withText, "b1", col, null);
    expect(getTranslation(cleared, "b1", col)).toBeUndefined();
  });

  it("stores non-verse content as text", () => {
    const next = applyCommittedContent(basePrayer(), "b2", col, "Leise");
    expect(getTranslation(next, "b2", col)?.text).toBe("Leise");
  });

  it("returns the same prayer reference when content is unchanged", () => {
    const prayer = basePrayer();
    const next = applyCommittedContent(prayer, "b2", col, "Stehend");
    expect(next).toBe(prayer);
  });

  it("returns the same prayer reference for an empty verse commit", () => {
    const prayer = basePrayer();
    const next = applyCommittedContent(prayer, "b1", col, null);
    expect(next).toBe(prayer);
  });

  it("treats equivalent inline content as unchanged", () => {
    const prayer = basePrayer();
    const withRuns = applyCommittedContent(prayer, "b2", col, [
      { t: "text", v: "Stehend" },
    ]);
    const again = applyCommittedContent(withRuns, "b2", col, "Stehend");
    expect(again).toBe(withRuns);
  });
});

describe("editorCommitUnchanged", () => {
  it("detects unchanged verse lines", () => {
    const lines = ["Herr,", "erbarme dich."];
    expect(editorCommitUnchanged(lines, lines, true)).toBe(true);
    expect(editorCommitUnchanged(lines, ["Herr,", "erbarme dich."], true)).toBe(
      true,
    );
    expect(editorCommitUnchanged(lines, ["Herr,"], true)).toBe(false);
  });

  it("detects unchanged text blocks", () => {
    expect(editorCommitUnchanged("Stehend", "Stehend", false)).toBe(true);
    expect(editorCommitUnchanged("Stehend", "Anders", false)).toBe(false);
    expect(editorCommitUnchanged("", null, false)).toBe(true);
  });

  it("matches committedContentUnchanged for stored translations", () => {
    const tr = getTranslation(basePrayer(), "b2", col);
    expect(committedContentUnchanged("rubric", tr, "Stehend")).toBe(true);
    expect(committedContentUnchanged("rubric", tr, "Leise")).toBe(false);
  });
});

describe("structure ops", () => {
  it("adds, moves, and removes blocks", () => {
    let prayer = addBlock(basePrayer(), "verse", "b3");
    expect(prayer.structure.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);

    prayer = moveBlock(prayer, 2, -1);
    expect(prayer.structure.map((b) => b.id)).toEqual(["b1", "b3", "b2"]);

    prayer = removeBlock(prayer, 1);
    expect(prayer.structure.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("inserts after committing the current cell", () => {
    const next = insertBlockAfter(
      basePrayer(),
      0,
      col,
      ["Amen"],
      "b-new",
    );
    expect(getTranslation(next, "b1", col)?.lines).toEqual(["Amen"]);
    expect(next.structure.map((b) => b.id)).toEqual(["b1", "b-new", "b2"]);
    expect(next.structure[1]?.kind).toBe("verse");
  });

  it("changes a block kind", () => {
    const next = setBlockKind(basePrayer(), 0, "rubric");
    expect(next.structure[0]?.kind).toBe("rubric");
  });
});

describe("kind + styles", () => {
  it("renames kind across prayer and style maps", () => {
    const appStyles: StyleMap = {
      verse: { fontSize: "1.2rem", color: "base" },
    };
    const libraryStyles: StyleMap = {
      verse: { fontSize: "1.4rem", color: "accent" },
    };
    const next = renameKindWithStyles(
      basePrayer(),
      appStyles,
      libraryStyles,
      "verse",
      "strophe",
    );
    expect(next.prayer.structure[0]?.kind).toBe("strophe");
    expect(next.appStyles.strophe?.fontSize).toBe("1.2rem");
    expect(next.libraryStyles.strophe?.fontSize).toBe("1.4rem");
    expect(next.appStyles.verse).toBeUndefined();
  });

  it("deletes kind styles with the kind", () => {
    const next = deleteKindWithStyles(
      basePrayer(),
      { rubric: { color: "red" } },
      { rubric: { color: "blue" } },
      "rubric",
    );
    expect(next.prayer.structure.every((b) => b.kind !== "rubric")).toBe(true);
    expect(next.appStyles.rubric).toBeUndefined();
    expect(next.libraryStyles.rubric).toBeUndefined();
  });
});

describe("fill helpers", () => {
  it("reports fill percent per column", () => {
    expect(isTranslationFilled(basePrayer(), "b2", col)).toBe(true);
    expect(isTranslationFilled(basePrayer(), "b1", col)).toBe(false);
    expect(fillPercent(basePrayer(), col)).toEqual({
      filled: 1,
      total: 2,
      percent: 50,
    });
  });

  it("treats verse text as filled when lines are absent", () => {
    const prayer: Prayer = {
      ...basePrayer(),
      structure: [
        {
          id: "v1",
          kind: "verse",
          translations: [
            {
              lang: "de",
              variant: "standard",
              text: "Auf die Gebete unserer heiligen Väter…",
            },
          ],
        },
      ],
    };
    expect(isTranslationFilled(prayer, "v1", col)).toBe(true);
    expect(translationEditorContent("verse", prayer.structure[0]?.translations[0])).toEqual([
      "Auf die Gebete unserer heiligen Väter…",
    ]);
  });

  it("treats a block as empty across variants when no translation has content", () => {
    expect(isBlockEmptyAcrossVariants(basePrayer(), "b1")).toBe(true);
    expect(isBlockEmptyAcrossVariants(basePrayer(), "b2")).toBe(false);
  });

  it("is empty across variants only when every prayer variant is empty for that block", () => {
    const prayer: Prayer = {
      ...basePrayer(),
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "Morgen",
          license: "unknown",
          source: "test",
        },
        {
          lang: "en",
          variant: "standard",
          title: "Morning",
          license: "unknown",
          source: "test",
        },
      ],
      structure: [
        {
          id: "b1",
          kind: "rubric",
          translations: [
            { lang: "de", variant: "standard", text: "" },
            { lang: "en", variant: "standard", text: "Standing" },
          ],
        },
      ],
    };
    expect(isBlockEmptyAcrossVariants(prayer, "b1")).toBe(false);

    const cleared: Prayer = {
      ...prayer,
      structure: [
        {
          id: "b1",
          kind: "rubric",
          translations: [{ lang: "de", variant: "standard", text: "" }],
        },
      ],
    };
    expect(isBlockEmptyAcrossVariants(cleared, "b1")).toBe(true);
  });

  it("can treat the editing column as empty while other variants still decide confirmation", () => {
    const prayer: Prayer = {
      ...basePrayer(),
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "Morgen",
          license: "unknown",
          source: "test",
        },
        {
          lang: "en",
          variant: "standard",
          title: "Morning",
          license: "unknown",
          source: "test",
        },
      ],
      structure: [
        {
          id: "b1",
          kind: "rubric",
          translations: [
            { lang: "de", variant: "standard", text: "Stehend" },
            { lang: "en", variant: "standard", text: "Standing" },
          ],
        },
      ],
    };
    expect(
      isBlockEmptyAcrossVariants(prayer, "b1", { treatAsEmpty: col }),
    ).toBe(false);
    expect(
      isBlockEmptyAcrossVariants(prayer, "b1", {
        treatAsEmpty: { lang: "en", variant: "standard" },
      }),
    ).toBe(false);

    const onlyDe: Prayer = {
      ...prayer,
      structure: [
        {
          id: "b1",
          kind: "rubric",
          translations: [{ lang: "de", variant: "standard", text: "Stehend" }],
        },
      ],
    };
    expect(
      isBlockEmptyAcrossVariants(onlyDe, "b1", { treatAsEmpty: col }),
    ).toBe(true);
  });
});
