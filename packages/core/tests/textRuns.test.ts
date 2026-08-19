import { describe, expect, it } from "vitest";
import {
  markRangeAsNote,
  normalizeRuns,
  packInline,
  plainText,
  splitInline,
  toRuns,
  toggleNoteRange,
  unmarkNoteAt,
  unmarkRange,
  validate,
  type InlineContent,
} from "../src/index.js";

describe("normalizeRuns / packInline", () => {
  it("peels whitespace out of notes into adjacent text", () => {
    expect(
      normalizeRuns([
        { t: "text", v: "Amen" },
        { t: "note", v: " (zwölfmal) " },
        { t: "text", v: "." },
      ]),
    ).toEqual([
      { t: "text", v: "Amen " },
      { t: "note", v: "(zwölfmal)" },
      { t: "text", v: " ." },
    ]);
  });

  it("merges adjacent same-role runs and drops empties", () => {
    expect(
      normalizeRuns([
        { t: "text", v: "a" },
        { t: "text", v: "b" },
        { t: "note", v: "" },
        { t: "note", v: "(NN)" },
      ]),
    ).toEqual([
      { t: "text", v: "ab" },
      { t: "note", v: "(NN)" },
    ]);
  });

  it("packs to plain string when no notes remain", () => {
    expect(packInline([{ t: "text", v: "Hello" }, { t: "text", v: "!" }])).toBe(
      "Hello!",
    );
  });

  it("packs to runs when a note is present", () => {
    expect(
      packInline([
        { t: "text", v: "Gedenke " },
        { t: "note", v: "(NN)" },
      ]),
    ).toEqual([
      { t: "text", v: "Gedenke " },
      { t: "note", v: "(NN)" },
    ]);
  });
});

describe("mark / unmark / toggle", () => {
  it("marks a mid-line name placeholder as note", () => {
    const content = "Gedenke, Herr, Deines Dieners (NN) und erbarme Dich.";
    const start = content.indexOf("(NN)");
    const end = start + "(NN)".length;
    expect(markRangeAsNote(content, start, end)).toEqual([
      { t: "text", v: "Gedenke, Herr, Deines Dieners " },
      { t: "note", v: "(NN)" },
      { t: "text", v: " und erbarme Dich." },
    ]);
  });

  it("leaves surrounding spaces as text when selection includes them", () => {
    const content = "Amen (zwölfmal).";
    const start = content.indexOf(" (");
    const end = content.indexOf(")") + 1;
    expect(markRangeAsNote(content, start, end)).toEqual([
      { t: "text", v: "Amen " },
      { t: "note", v: "(zwölfmal)" },
      { t: "text", v: "." },
    ]);
  });

  it("no-ops on whitespace-only selection", () => {
    expect(markRangeAsNote("a  b", 1, 3)).toBe("a  b");
  });

  it("unmarks a note run by index back to plain text", () => {
    const rich = [
      { t: "text" as const, v: "Amen " },
      { t: "note" as const, v: "(zwölfmal)" },
      { t: "text" as const, v: "." },
    ];
    expect(unmarkNoteAt(rich, 1)).toBe("Amen (zwölfmal).");
  });

  it("unmarks a character range", () => {
    const rich = markRangeAsNote("x (NN) y", 2, 6);
    expect(Array.isArray(rich)).toBe(true);
    expect(unmarkRange(rich, 2, 6)).toBe("x (NN) y");
  });

  it("toggles note on then off", () => {
    const plain = "Herr (NN) erbarme Dich";
    const start = plain.indexOf("(NN)");
    const end = start + 4;
    const marked = toggleNoteRange(plain, start, end);
    expect(plainText(marked)).toBe(plain);
    expect(toRuns(marked).some((r) => r.t === "note")).toBe(true);
    const unmarked = toggleNoteRange(marked, start, end);
    expect(unmarked).toBe(plain);
  });

  it("removes the whole note when only part of it is selected", () => {
    const marked = markRangeAsNote(
      "Amen (zwölfmal).",
      "Amen ".length,
      "Amen (zwölfmal)".length,
    );
    expect(Array.isArray(marked)).toBe(true);
    const start = "Amen (".length;
    const end = start + "zwölf".length;
    expect(toggleNoteRange(marked, start, end)).toBe("Amen (zwölfmal).");
  });

  it("merges adjacent notes from sequential marks", () => {
    let content: InlineContent = markRangeAsNote("aaabbb", 0, 3);
    content = markRangeAsNote(content, 3, 6);
    expect(content).toEqual([{ t: "note", v: "aaabbb" }]);
  });

  it("coalesces notes separated only by whitespace into one note", () => {
    expect(
      normalizeRuns([
        { t: "note", v: "(NN)" },
        { t: "text", v: " " },
        { t: "note", v: "(zwölfmal)" },
      ]),
    ).toEqual([{ t: "note", v: "(NN) (zwölfmal)" }]);
  });
});

describe("splitInline", () => {
  it("splits plain text at a caret offset", () => {
    expect(splitInline("Herr, erbarme dich.", 6)).toEqual({
      before: "Herr, ",
      after: "erbarme dich.",
    });
  });

  it("yields an empty after at the end of the text", () => {
    expect(splitInline("Amen", 4)).toEqual({
      before: "Amen",
      after: null,
    });
  });

  it("yields an empty before at the start of the text", () => {
    expect(splitInline("Amen", 0)).toEqual({
      before: null,
      after: "Amen",
    });
  });

  it("drops a selected range between start and end", () => {
    expect(splitInline("aaXXXbb", 2, 5)).toEqual({
      before: "aa",
      after: "bb",
    });
  });

  it("splits a note run at the caret and keeps both sides as notes", () => {
    const content: InlineContent = [
      { t: "text", v: "Dann " },
      { t: "note", v: "vierzigmal" },
      { t: "text", v: ":" },
    ];
    expect(splitInline(content, 9)).toEqual({
      before: [
        { t: "text", v: "Dann " },
        { t: "note", v: "vier" },
      ],
      after: [
        { t: "note", v: "zigmal" },
        { t: "text", v: ":" },
      ],
    });
  });
});

describe("validate + inline notes", () => {
  const base = {
    id: "inline-note-sample",
    type: "prayer",
    variants: [
      {
        lang: "de",
        variant: "standard",
        title: "Probe",
        license: "unknown",
        source: "draft",
      },
    ],
  };

  it("accepts verse lines with note runs", () => {
    const result = validate({
      ...base,
      structure: [
        {
          id: "v1",
          kind: "verse",
          translations: [
            {
              lang: "de",
              variant: "standard",
              lines: [
                [
                  { t: "text", v: "Gedenke " },
                  { t: "note", v: "(NN)" },
                ],
              ],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects run arrays that are only text", () => {
    const result = validate({
      ...base,
      structure: [
        {
          id: "v1",
          kind: "verse",
          translations: [
            {
              lang: "de",
              variant: "standard",
              text: [{ t: "text", v: "only text" }],
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });
});
