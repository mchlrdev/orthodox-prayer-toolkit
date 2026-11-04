import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import {
  fillPercent,
  isBlockTranslationFilled,
  isTranslationFilled,
} from "../src/prayerEdit";
import type { ActiveVariant } from "../src/variant";

const lorem = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/perf/lorem-300.json"), "utf8"),
) as Prayer;

/** The lookup-by-id formula fillPercent used before it became one pass. */
function fillPercentByLookup(prayer: Prayer, col: ActiveVariant) {
  const total = prayer.structure.length;
  if (total === 0) return { filled: 0, total: 0, percent: 100 };
  const filled = prayer.structure.filter((b) =>
    isTranslationFilled(prayer, b.id, col),
  ).length;
  return { filled, total, percent: Math.round((filled / total) * 100) };
}

const de = { lang: "de", variant: "standard" };
const en = { lang: "en", variant: "standard" };

describe("fillPercent (one pass)", () => {
  it("matches the lookup formula on the 300-block fixture", () => {
    for (const col of [de, en, { lang: "cu", variant: "x" }]) {
      expect(fillPercent(lorem, col)).toEqual(fillPercentByLookup(lorem, col));
    }
    expect(fillPercent(lorem, en).filled).toBeLessThan(300);
  });

  it("counts a duplicate id as its first Block, like a lookup", () => {
    const first = lorem.structure[1]!;
    const emptyTwin = {
      ...first,
      translations: [{ lang: "de", variant: "standard", lines: [] }],
    };
    const prayer: Prayer = {
      ...lorem,
      structure: [first, emptyTwin, ...lorem.structure.slice(2, 5)],
    };
    expect(fillPercent(prayer, de)).toEqual(fillPercentByLookup(prayer, de));
    expect(fillPercent(prayer, de).filled).toBe(5);
  });

  it("isBlockTranslationFilled agrees with isTranslationFilled", () => {
    for (const block of lorem.structure) {
      for (const col of [de, en]) {
        expect(isBlockTranslationFilled(block, col)).toBe(
          isTranslationFilled(lorem, block.id, col),
        );
      }
    }
  });
});
