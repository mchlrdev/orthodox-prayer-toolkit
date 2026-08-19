import { describe, expect, it } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import {
  findMatchesInPrayer,
  replaceAllMatchesInPrayer,
  replaceMatchInPrayer,
  summarizeReplaceAll,
} from "../src/prayerEdit/findReplace";

const prayer: Prayer = {
  id: "find-sample",
  type: "prayer",
  variants: [
    {
      lang: "de",
      variant: "standard",
      title: "Probe",
      license: "unknown",
      source: "draft",
    },
    {
      lang: "el",
      variant: "byzantine",
      title: "Greek",
      license: "unknown",
      source: "draft",
    },
  ],
  structure: [
    {
      id: "h1",
      kind: "heading",
      translations: [
        {
          lang: "de",
          variant: "standard",
          text: "Kyrie eleison",
        },
        {
          lang: "el",
          variant: "byzantine",
          text: "Κύριε ἐλέησον",
        },
      ],
    },
    {
      id: "v1",
      kind: "verse",
      translations: [
        {
          lang: "de",
          variant: "standard",
          lines: [
            "Kyrie eleison",
            [
              { t: "text", v: "Christe " },
              { t: "note", v: "eleison" },
            ],
          ],
        },
      ],
    },
  ],
};

describe("findMatchesInPrayer", () => {
  it("finds matches in visible columns only", () => {
    const matches = findMatchesInPrayer(
      prayer,
      [{ lang: "de", variant: "standard" }],
      "eleison",
      { matchCase: false, wholeWord: false },
    );
    expect(matches).toHaveLength(3);
    expect(matches.every((m) => m.col.lang === "de")).toBe(true);
  });

  it("respects whole word boundaries", () => {
    const matches = findMatchesInPrayer(
      prayer,
      [{ lang: "de", variant: "standard" }],
      "Kyrie",
      { matchCase: false, wholeWord: true },
    );
    expect(matches).toHaveLength(2);
  });

  it("returns no matches for empty query", () => {
    expect(
      findMatchesInPrayer(
        prayer,
        [{ lang: "de", variant: "standard" }],
        "",
        { matchCase: false, wholeWord: false },
      ),
    ).toEqual([]);
  });
});

describe("replaceMatchInPrayer", () => {
  it("replaces inside a note run without flattening notes", () => {
    const match = findMatchesInPrayer(
      prayer,
      [{ lang: "de", variant: "standard" }],
      "eleison",
      { matchCase: false, wholeWord: false },
    ).find((m) => m.blockId === "v1" && m.start >= 14);
    expect(match).toBeDefined();

    const next = replaceMatchInPrayer(prayer, match!, "help us");
    const verse = next.structure.find((b) => b.id === "v1");
    const tr = verse?.translations.find(
      (t) => t.lang === "de" && t.variant === "standard",
    );
    expect(tr?.lines?.[1]).toEqual([
      { t: "text", v: "Christe " },
      { t: "note", v: "help us" },
    ]);
  });

  it("replace all updates every visible match", () => {
    const matches = findMatchesInPrayer(
      prayer,
      [{ lang: "de", variant: "standard" }],
      "eleison",
      { matchCase: false, wholeWord: false },
    );
    expect(summarizeReplaceAll(matches)).toEqual({ count: 3, blockCount: 2 });

    const next = replaceAllMatchesInPrayer(prayer, matches, "miserere");
    const heading = next.structure.find((b) => b.id === "h1");
    const headingTr = heading?.translations.find(
      (t) => t.lang === "de" && t.variant === "standard",
    );
    expect(headingTr?.text).toBe("Kyrie miserere");
  });
});
