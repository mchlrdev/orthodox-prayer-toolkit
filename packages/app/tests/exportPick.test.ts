import { describe, expect, it } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import {
  pickExportParallelColumns,
  pickExportVariant,
  pickOtherExportColumn,
} from "../src/session/exportPick";

function prayerWithVariants(
  variants: Array<{ lang: string; variant: string }>,
): Prayer {
  return {
    id: "sample",
    type: "prayer",
    tone: null,
    variants: variants.map((v) => ({
      ...v,
      title: v.lang,
      license: "unknown",
      source: "test",
    })),
    structure: [],
    meta: {},
  };
}

describe("pickExportVariant", () => {
  it("prefills the library default when the prayer has that language", () => {
    const prayer = prayerWithVariants([
      { lang: "de", variant: "standard" },
      { lang: "cu", variant: "synodal-cyrl" },
    ]);
    expect(
      pickExportVariant(prayer, { lang: "cu", variant: "synodal-cyrl" }),
    ).toEqual({ lang: "cu", variant: "synodal-cyrl" });
  });

  it("falls back to the prayer’s first language when the library default is missing", () => {
    const prayer = prayerWithVariants([
      { lang: "de", variant: "standard" },
      { lang: "en", variant: "standard" },
    ]);
    expect(
      pickExportVariant(prayer, { lang: "cu", variant: "synodal-cyrl" }),
    ).toEqual({ lang: "de", variant: "standard" });
  });

  it("returns null when the prayer has no languages", () => {
    expect(pickExportVariant(prayerWithVariants([]), undefined)).toBeNull();
  });
});

describe("pickExportParallelColumns", () => {
  const prayer = prayerWithVariants([
    { lang: "de", variant: "standard" },
    { lang: "en", variant: "standard" },
    { lang: "cu", variant: "synodal-cyrl" },
  ]);

  it("returns null when fewer than two languages exist", () => {
    expect(
      pickExportParallelColumns(
        prayerWithVariants([{ lang: "de", variant: "standard" }]),
      ),
    ).toBeNull();
  });

  it("prefers a saved pair when both still exist", () => {
    expect(
      pickExportParallelColumns(prayer, {
        saved: {
          left: { lang: "en", variant: "standard" },
          right: { lang: "cu", variant: "synodal-cyrl" },
        },
        visible: [
          { lang: "de", variant: "standard" },
          { lang: "en", variant: "standard" },
        ],
      }),
    ).toEqual([
      { lang: "en", variant: "standard" },
      { lang: "cu", variant: "synodal-cyrl" },
    ]);
  });

  it("uses the first two visible editor columns", () => {
    expect(
      pickExportParallelColumns(prayer, {
        visible: [
          { lang: "cu", variant: "synodal-cyrl" },
          { lang: "de", variant: "standard" },
        ],
      }),
    ).toEqual([
      { lang: "cu", variant: "synodal-cyrl" },
      { lang: "de", variant: "standard" },
    ]);
  });

  it("pairs the library default with another language", () => {
    expect(
      pickExportParallelColumns(prayer, {
        libraryDefault: { lang: "en", variant: "standard" },
      }),
    ).toEqual([
      { lang: "en", variant: "standard" },
      { lang: "de", variant: "standard" },
    ]);
  });
});

describe("pickOtherExportColumn", () => {
  const prayer = prayerWithVariants([
    { lang: "de", variant: "standard" },
    { lang: "en", variant: "standard" },
  ]);

  it("returns the other language", () => {
    expect(
      pickOtherExportColumn(prayer, { lang: "de", variant: "standard" }),
    ).toEqual({ lang: "en", variant: "standard" });
  });
});
