import { describe, expect, it } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import { columnWidthCss, readVariantFonts, variantFontCss, variantSamples } from "../src/languageFontPrefs";
import { parseVariantKey } from "../src/variant";

describe("variantFontCss", () => {
  it("sets the size on the cell and the font on the text", () => {
    expect(variantFontCss({ "sr::cyrl": { family: "Noto Serif", size: 130 } })).toBe(
      '.split-cell[data-lang="sr"][data-variant="cyrl"] { font-size: 130%; }\n' +
        '.split-cell[data-lang="sr"][data-variant="cyrl"] .inline-content { font-family: "Noto Serif", var(--opt-prayer-font); }',
    );
  });

  it("writes nothing for the defaults", () => {
    expect(variantFontCss({ "de::standard": { size: 100 } })).toBe("");
  });

  it("keeps a font name inside its string", () => {
    const css = variantFontCss({ "el::a": { family: 'x"; } body { color: red; } </style>', size: 100 } });
    expect(css).toBe(
      '.split-cell[data-lang="el"][data-variant="a"] .inline-content { font-family: "x\\";   body   color: red;    /style ", var(--opt-prayer-font); }',
    );
  });

  it("matches free codes instead of dropping them", () => {
    expect(variantFontCss({ "de_AT::Kyiv 1": { size: 120 } })).toBe(
      '.split-cell[data-lang="de_AT"][data-variant="Kyiv 1"] { font-size: 120%; }',
    );
  });

  it("keeps a selector value inside its string", () => {
    expect(variantFontCss({ 'x"] { }::a': { size: 150 } })).toBe(
      '.split-cell[data-lang="x\\22 ] \\7b  \\7d "][data-variant="a"] { font-size: 150%; }',
    );
  });
});

describe("readVariantFonts", () => {
  it("keeps what is valid and clamps the size", () => {
    expect(
      readVariantFonts({
        "syr::standard": { family: " Estrangelo ", size: 999 },
        "ar::standard": { size: "x" },
        "de::standard": null,
      }),
    ).toEqual({
      "syr::standard": { family: "Estrangelo", size: 250 },
      "ar::standard": { size: 100 },
    });
    expect(readVariantFonts([])).toEqual({});
    expect(readVariantFonts(null)).toEqual({});
  });

  it("drops a key without a Variant", () => {
    expect(readVariantFonts({ de: { size: 120 } })).toEqual({});
  });
});

describe("parseVariantKey", () => {
  it("splits at the first separator only", () => {
    expect(parseVariantKey("de::a::b")).toEqual({ lang: "de", variant: "a::b" });
    expect(parseVariantKey("::a")).toBeNull();
    expect(parseVariantKey("de::")).toBeNull();
  });
});

describe("variantSamples", () => {
  const prayer = {
    structure: [
      { id: "1", kind: "text", translations: [{ lang: "de", variant: "standard", text: " " }] },
      {
        id: "2",
        kind: "verse",
        translations: [
          { lang: "de", variant: "standard", lines: ["Herr", "erbarme dich"] },
          { lang: "el", variant: "standard", text: [{ t: "text", v: "Κύριε" }] },
        ],
      },
      { id: "3", kind: "text", translations: [{ lang: "de", variant: "standard", text: "Später" }] },
    ],
  } as unknown as Prayer;

  it("takes each Variant's first text", () => {
    const samples = variantSamples(prayer);
    expect(samples.get("de::standard")).toBe("Herr");
    expect(samples.get("el::standard")).toBe("Κύριε");
  });

  it("has nothing without an open Prayer", () => {
    expect(variantSamples(null).size).toBe(0);
  });
});

describe("column width", () => {
  it("scales the width with the text", () => {
    expect(columnWidthCss("narrow")).toBe("32em");
  });
});
