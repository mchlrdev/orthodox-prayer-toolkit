import { describe, expect, it } from "vitest";
import { columnWidthCss, languageFontCss, languageSample, readLanguageFonts } from "../src/languageFontPrefs";

describe("languageFontCss", () => {
  it("sets the size on the cell and the font on the text", () => {
    expect(languageFontCss({ syr: { family: "Noto Sans Syriac", size: 130 } })).toBe(
      '.split-cell[data-lang="syr"] { font-size: 130%; }\n' +
        '.split-cell[data-lang="syr"] .inline-content { font-family: "Noto Sans Syriac", var(--opt-prayer-font); }',
    );
  });

  it("writes nothing for the defaults", () => {
    expect(languageFontCss({ de: { size: 100 } })).toBe("");
  });

  it("keeps a font name inside its string", () => {
    const css = languageFontCss({ el: { family: 'x"; } body { color: red; } </style>', size: 100 } });
    expect(css).toBe('.split-cell[data-lang="el"] .inline-content { font-family: "x\\";   body   color: red;    /style ", var(--opt-prayer-font); }');
  });

  it("skips a language code that is not one", () => {
    expect(languageFontCss({ 'x"] { }': { size: 150 } })).toBe("");
  });
});

describe("readLanguageFonts", () => {
  it("keeps what is valid and clamps the size", () => {
    expect(
      readLanguageFonts({
        syr: { family: " Estrangelo ", size: 999 },
        ar: { size: "x" },
        de: null,
        "bad code": { size: 120 },
      }),
    ).toEqual({ syr: { family: "Estrangelo", size: 250 }, ar: { size: 100 } });
    expect(readLanguageFonts([])).toEqual({});
    expect(readLanguageFonts(null)).toEqual({});
  });
});

describe("column width and sample", () => {
  it("scales the width with the text", () => {
    expect(columnWidthCss("narrow")).toBe("32em");
  });
  it("finds a line for a language", () => {
    expect(languageSample("el")).toBe("Κύριε ἐλέησον");
    expect(languageSample("ru-RU")).toBe("Господи, помилуй");
    expect(languageSample("xx")).toBe("Lord, have mercy");
  });
});
