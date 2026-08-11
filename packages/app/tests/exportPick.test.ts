import { describe, expect, it } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import { pickExportVariant } from "../src/session/exportPick";

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
