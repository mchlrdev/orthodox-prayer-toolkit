import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { locateValidationErrors, validate, type Prayer } from "../src/index.js";

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures/valid-tropar-prokopios.json"),
    "utf8",
  ),
) as Prayer;

/** Fixture with one translation carrying both `text` and `lines`. */
function brokenPrayer(): { prayer: Prayer; blockId: string; lang: string; variant: string } {
  const prayer = structuredClone(fixture);
  const block = prayer.structure[1]!;
  const tr = block.translations[0]!;
  (tr as { lines?: string[] }).lines = ["x"];
  (tr as { text?: string }).text = "y";
  return { prayer, blockId: block.id, lang: tr.lang, variant: tr.variant };
}

describe("locateValidationErrors", () => {
  it("maps translation errors to block and variant", () => {
    const { prayer, blockId, lang, variant } = brokenPrayer();
    const result = validate(prayer);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const located = locateValidationErrors(prayer, result.errors);
    expect(located.length).toBeGreaterThan(0);
    for (const l of located) {
      expect(l).toMatchObject({ blockId, variant: { lang, variant } });
    }
  });

  it("maps block-level paths without a variant", () => {
    const prayer = fixture;
    const b1 = prayer.structure[0]!.id;
    const located = locateValidationErrors(prayer, [
      { path: "/structure/0/kind", message: "bad" },
      { path: "/structure/0", message: "bad" },
    ]);
    expect(located.map((l) => [l.blockId, l.variant])).toEqual([
      [b1, null],
      [b1, null],
    ]);
  });

  it("leaves prayer-level and unknown paths unlocated", () => {
    const located = locateValidationErrors(fixture, [
      { path: "/id", message: "bad" },
      { path: "/structure/999/id", message: "bad" },
      { path: "/structure10", message: "bad" },
    ]);
    expect(located.every((l) => l.blockId === null)).toBe(true);
  });
});
