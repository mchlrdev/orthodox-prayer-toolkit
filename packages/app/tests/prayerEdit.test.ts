import { describe, expect, it } from "vitest";
import {
  FALLBACK_KIND_STYLE,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import {
  addBlock,
  applyCommittedContent,
  committedContentUnchanged,
  editorCommitUnchanged,
  deleteKindWithStyles,
  ensureKindStyle,
  fillPercent,
  getTranslation,
  insertBlockAfter,
  isBlockEmptyAcrossVariants,
  isTranslationFilled,
  kindOptions,
  kindRenameIssue,
  moveBlock,
  removeBlock,
  renameKindWithStyles,
  setBlockKind,
  splitBlock,
  splitEditorContent,
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

  it("splits a text block at the caret, keeping other variants on the original", () => {
    const prayer: Prayer = {
      ...basePrayer(),
      variants: [
        ...basePrayer().variants,
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
            { lang: "de", variant: "standard", text: "Stehend beten." },
            { lang: "en", variant: "standard", text: "Pray standing." },
          ],
        },
      ],
    };
    const { before, after } = splitEditorContent("Stehend beten.", 8, 8, false);
    expect(before).toBe("Stehend ");
    expect(after).toBe("beten.");

    const next = splitBlock(prayer, 0, col, before, after, "b-new");
    expect(next.structure.map((b) => b.id)).toEqual(["b1", "b-new"]);
    expect(next.structure[1]?.kind).toBe("rubric");
    expect(getTranslation(next, "b1", col)?.text).toBe("Stehend ");
    expect(getTranslation(next, "b-new", col)?.text).toBe("beten.");
    expect(
      getTranslation(next, "b1", { lang: "en", variant: "standard" })?.text,
    ).toBe("Pray standing.");
    expect(
      getTranslation(next, "b-new", { lang: "en", variant: "standard" }),
    ).toBeUndefined();
  });

  it("splits verse lines across a newline at the caret", () => {
    const prayer = applyCommittedContent(basePrayer(), "b1", col, [
      "Herr,",
      "erbarme dich.",
    ]);
    const { before, after } = splitEditorContent(
      ["Herr,", "erbarme dich."],
      6,
      6,
      true,
    );
    expect(before).toEqual(["Herr,"]);
    expect(after).toEqual(["erbarme dich."]);

    const next = splitBlock(prayer, 0, col, before, after, "b-new");
    expect(getTranslation(next, "b1", col)?.lines).toEqual(["Herr,"]);
    expect(getTranslation(next, "b-new", col)?.lines).toEqual([
      "erbarme dich.",
    ]);
  });

  it("splits a verse line in the middle", () => {
    const { before, after } = splitEditorContent(
      ["Herr, erbarme dich."],
      6,
      6,
      true,
    );
    expect(before).toEqual(["Herr, "]);
    expect(after).toEqual(["erbarme dich."]);
  });

  it("inserts an empty block when splitting at the end of the text", () => {
    const { before, after } = splitEditorContent("Amen", 4, 4, false);
    expect(before).toBe("Amen");
    expect(after).toBeNull();

    const next = splitBlock(basePrayer(), 1, col, before, after, "b-new");
    expect(getTranslation(next, "b2", col)?.text).toBe("Amen");
    expect(getTranslation(next, "b-new", col)).toBeUndefined();
    expect(next.structure.map((b) => b.id)).toEqual(["b1", "b2", "b-new"]);
  });

  it("changes a block kind", () => {
    const next = setBlockKind(basePrayer(), 0, "rubric");
    expect(next.structure[0]?.kind).toBe("rubric");
  });

  it("keeps verse lines as text when changing to heading, subheading, or annotation", () => {
    const prayer = applyCommittedContent(basePrayer(), "b1", col, [
      "Herr, erbarme dich.",
    ]);

    for (const kind of ["heading", "subheading", "annotation"] as const) {
      const next = setBlockKind(prayer, 0, kind);
      const tr = getTranslation(next, "b1", col);
      expect(next.structure[0]?.kind).toBe(kind);
      expect(tr?.text).toBe("Herr, erbarme dich.");
      expect(tr?.lines).toBeUndefined();
      expect(translationEditorContent(kind, tr)).toBe("Herr, erbarme dich.");
    }
  });

  it("keeps heading text after changing to verse and back", () => {
    let prayer = setBlockKind(basePrayer(), 1, "heading");
    prayer = applyCommittedContent(prayer, "b2", col, "Troparion im 4. Ton");

    prayer = setBlockKind(prayer, 1, "verse");
    expect(getTranslation(prayer, "b2", col)?.lines).toEqual([
      "Troparion im 4. Ton",
    ]);
    expect(getTranslation(prayer, "b2", col)?.text).toBeUndefined();

    prayer = setBlockKind(prayer, 1, "heading");
    const tr = getTranslation(prayer, "b2", col);
    expect(tr?.text).toBe("Troparion im 4. Ton");
    expect(tr?.lines).toBeUndefined();
    expect(translationEditorContent("heading", tr)).toBe("Troparion im 4. Ton");
  });

  it("joins multiple verse lines into heading text", () => {
    const prayer = applyCommittedContent(basePrayer(), "b1", col, [
      "Herr,",
      "erbarme dich.",
    ]);
    const next = setBlockKind(prayer, 0, "heading");
    expect(getTranslation(next, "b1", col)?.text).toBe("Herr,\nerbarme dich.");
  });

  it("keeps inline note runs when changing verse to heading", () => {
    const runs = [
      { t: "note" as const, v: "Dann vierzigmal:" },
      { t: "text" as const, v: " Herr, erbarme Dich!" },
    ];
    const prayer = applyCommittedContent(basePrayer(), "b1", col, [runs]);
    const next = setBlockKind(prayer, 0, "heading");
    expect(getTranslation(next, "b1", col)?.text).toEqual(runs);
  });

  it("reshapes every variant when the block kind changes", () => {
    const prayer: Prayer = {
      ...basePrayer(),
      variants: [
        ...basePrayer().variants,
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
          kind: "verse",
          translations: [
            { lang: "de", variant: "standard", lines: ["Herr,"] },
            { lang: "en", variant: "standard", lines: ["Lord,"] },
          ],
        },
      ],
    };
    const next = setBlockKind(prayer, 0, "heading");
    expect(getTranslation(next, "b1", col)?.text).toBe("Herr,");
    expect(
      getTranslation(next, "b1", { lang: "en", variant: "standard" })?.text,
    ).toBe("Lord,");
  });
});

describe("kindOptions", () => {
  it("includes presets, used kinds, and extra library style keys", () => {
    const options = kindOptions(basePrayer(), ["strophe"]);
    expect(options.slice(0, 4)).toEqual([
      "heading",
      "subheading",
      "annotation",
      "verse",
    ]);
    expect(options).toContain("rubric");
    expect(options).toContain("strophe");
  });
});

describe("kindRenameIssue", () => {
  it("allows a unique custom name", () => {
    expect(kindRenameIssue("rubric", "strophe", ["rubric", "verse"])).toBeNull();
  });

  it("rejects empty, reserved, and duplicate names", () => {
    expect(kindRenameIssue("rubric", "  ", ["rubric"])).toBe("Required");
    expect(kindRenameIssue("rubric", "verse", ["rubric", "verse"])).toBe(
      "That name is reserved",
    );
    expect(kindRenameIssue("rubric", "annotation", ["rubric"])).toBe(
      "That name is reserved",
    );
    expect(kindRenameIssue("rubric", "strophe", ["rubric", "strophe"])).toBe(
      "Already exists",
    );
    expect(kindRenameIssue("rubric", "foo bar", ["rubric"])).toBe(
      "Use a letter, then letters, digits, _ or -",
    );
    expect(kindRenameIssue("rubric", "1strophe", ["rubric"])).toBe(
      "Use a letter, then letters, digits, _ or -",
    );
    expect(kindRenameIssue("verse", "strophe", ["verse"])).toBe(
      "Built-in kinds cannot be renamed",
    );
  });

  it("treats an unchanged name as valid", () => {
    expect(kindRenameIssue("rubric", "rubric", ["rubric"])).toBeNull();
  });
});

describe("kind + styles", () => {
  it("renames kind across prayer and style maps", () => {
    const appStyles: StyleMap = {
      rubric: { fontSize: "1.2rem", color: "base" },
    };
    const libraryStyles: StyleMap = {
      rubric: { fontSize: "1.4rem", color: "accent" },
    };
    const next = renameKindWithStyles(
      basePrayer(),
      appStyles,
      libraryStyles,
      "rubric",
      "strophe",
    );
    expect(next.prayer.structure[1]?.kind).toBe("strophe");
    expect(next.appStyles.strophe?.fontSize).toBe("1.2rem");
    expect(next.libraryStyles.strophe?.fontSize).toBe("1.4rem");
    expect(next.appStyles.rubric).toBeUndefined();
  });

  it("does not rename built-in preset kinds", () => {
    const prayer = basePrayer();
    const appStyles: StyleMap = {
      verse: { fontSize: "1.2rem", color: "base" },
    };
    const next = renameKindWithStyles(
      prayer,
      appStyles,
      {},
      "verse",
      "strophe",
    );
    expect(next.prayer).toBe(prayer);
    expect(next.appStyles).toBe(appStyles);
    expect(next.prayer.structure[0]?.kind).toBe("verse");
  });

  it("does not delete built-in preset kinds", () => {
    const prayer = basePrayer();
    const appStyles: StyleMap = {
      verse: { fontSize: "1.2rem", color: "base" },
    };
    const next = deleteKindWithStyles(prayer, appStyles, {}, "verse");
    expect(next.prayer).toBe(prayer);
    expect(next.appStyles).toBe(appStyles);
    expect(next.prayer.structure[0]?.kind).toBe("verse");
    expect(next.appStyles.verse?.fontSize).toBe("1.2rem");
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

  it("keeps a custom kind in library styles even when unused", () => {
    const style = { ...FALLBACK_KIND_STYLE };
    const next = ensureKindStyle({}, "strophe", style);
    expect(next.strophe).toEqual(style);
    expect(ensureKindStyle(next, "strophe", FALLBACK_KIND_STYLE)).toBe(next);
    expect(ensureKindStyle({}, "verse", style)).toEqual({});
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

  it("treats leftover heading lines as filled when text is absent", () => {
    const prayer: Prayer = {
      ...basePrayer(),
      structure: [
        {
          id: "h1",
          kind: "heading",
          translations: [
            {
              lang: "de",
              variant: "standard",
              lines: ["Troparion im 4. Ton"],
            },
          ],
        },
      ],
    };
    expect(isTranslationFilled(prayer, "h1", col)).toBe(true);
    expect(
      translationEditorContent("heading", prayer.structure[0]?.translations[0]),
    ).toBe("Troparion im 4. Ton");
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
