import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CURRENT_FORMAT_VERSION,
  DEFAULT_KIND_STYLES,
  SPEAKER_PRESETS,
  isSpeakerPreset,
  listSpeakers,
  renameSpeaker,
  indexSpeakers,
  isValidSpeakerId,
  kindAllowsSpeaker,
  normalizeFormatVersion,
  removeSpeaker,
  resolveSpeakerLabel,
  resolveStyles,
  sanitizeSpeakerIdInput,
  setBlockSpeaker,
  setSpeakerLabel,
  speakerChipLabel,
  speakerDisplayLabel,
  validate,
  validateStyles,
} from "../src/index.js";
import type { Prayer } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

function base(): Prayer {
  return {
    id: "dialogue",
    type: "prayer",
    variants: [
      { lang: "de", variant: "standard", title: "D", license: "x", source: "x" },
      { lang: "en", variant: "standard", title: "E", license: "x", source: "x" },
    ],
    structure: [
      {
        id: "b1",
        kind: "verse",
        translations: [
          { lang: "de", variant: "standard", lines: ["Eins"] },
          { lang: "en", variant: "standard", lines: ["One"] },
        ],
      },
      {
        id: "b2",
        kind: "verse",
        translations: [{ lang: "de", variant: "standard", lines: ["Zwei"] }],
      },
    ],
  };
}

const DE = { lang: "de", variant: "standard" };
const EN = { lang: "en", variant: "standard" };

describe("backwards compatibility", () => {
  it("existing fixtures and examples validate and are unchanged by normalizeFormatVersion", () => {
    const dirs = [
      join(here, "fixtures"),
      join(here, "..", "..", "..", "examples"),
    ];
    let checked = 0;
    for (const dir of dirs) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json") || f.startsWith("flat-") || f === "manifest.json")
          continue;
        const r = validate(read(join(dir, f)));
        if (!r.ok) continue;
        checked++;
        expect(r.warnings).toEqual([]);
        expect(normalizeFormatVersion(r.prayer)).toEqual(r.prayer);
        const usesSpeakers = r.prayer.structure.some((b) => b.speaker !== undefined);
        expect(normalizeFormatVersion(r.prayer).formatVersion).toBe(
          usesSpeakers ? 2 : undefined,
        );
      }
    }
    expect(checked).toBeGreaterThan(2);
  });
});

describe("schema", () => {
  it("accepts formatVersion, speaker and speakers", () => {
    const p = base();
    p.formatVersion = 2;
    p.structure[0]!.speaker = "priest";
    p.variants[0]!.speakers = { priest: { name: "Priester", short: "P" } };
    expect(validate(p).ok).toBe(true);
  });

  it("rejects bad speaker ids, bad keys, empty labels and unknown label fields", () => {
    const bad = (mut: (p: Prayer) => void) => {
      const p = base();
      mut(p);
      return validate(p).ok;
    };
    expect(bad((p) => (p.structure[0]!.speaker = "1bad"))).toBe(false);
    expect(bad((p) => (p.structure[0]!.speaker = "has space"))).toBe(false);
    expect(bad((p) => (p.variants[0]!.speakers = { "bad id": { name: "x" } }))).toBe(false);
    expect(bad((p) => (p.variants[0]!.speakers = { priest: {} }))).toBe(false);
    expect(bad((p) => (p.variants[0]!.speakers = { priest: { name: "" } }))).toBe(false);
    expect(
      bad((p) => (p.variants[0]!.speakers = { priest: { name: "x", extra: 1 } as never })),
    ).toBe(false);
    expect(bad((p) => (p.formatVersion = 0))).toBe(false);
    expect(bad((p) => (p.formatVersion = 1.5))).toBe(false);
  });

  it("allows a speaker on any kind", () => {
    const p = base();
    p.structure[0]!.kind = "heading";
    p.structure[0]!.speaker = "priest";
    expect(validate(p).ok).toBe(true);
  });
});

describe("formatVersion validation", () => {
  it("returns a single dedicated error for a newer version and skips other checks", () => {
    const r = validate({ formatVersion: CURRENT_FORMAT_VERSION + 1, bogus: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.path).toBe("/formatVersion");
    expect(r.errors[0]!.code).toBe("format-version-newer");
    expect(r.warnings).toEqual([]);
  });

  it("accepts the current version", () => {
    const p = base();
    p.formatVersion = CURRENT_FORMAT_VERSION;
    expect(validate(p).ok).toBe(true);
  });
});

describe("speaker warnings", () => {
  it("warns when a variant with a translation lacks the speaker name", () => {
    const p = setBlockSpeaker(base(), "b1", "priest");
    const r = validate(p);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.path)).toEqual([
      "/variants/0/speakers/priest",
      "/variants/1/speakers/priest",
    ]);
    expect(r.warnings[0]!.code).toBe("speaker-name-missing");
    expect(r.warnings[0]!.message).toBe(
      `Speaker \u201cPriest\u201d has no name in ${DE.lang} / ${DE.variant}`,
    );
  });

  it("does not warn for named variants or variants without a translation of the block", () => {
    let p = setBlockSpeaker(base(), "b2", "priest");
    // en has no translation for b2
    p = setSpeakerLabel(p, DE, "priest", { name: "Priester" });
    expect(validate(p).warnings).toEqual([]);
  });

  it("short alone still warns about the missing name", () => {
    let p = setBlockSpeaker(base(), "b2", "priest");
    p = setSpeakerLabel(p, DE, "priest", { short: "P" });
    expect(validate(p).warnings).toHaveLength(1);
  });

  it("is empty when no speakers are used", () => {
    const r = validate(base());
    expect(r.warnings).toEqual([]);
  });

  it("keeps speakers intact through validate", () => {
    let p = setBlockSpeaker(base(), "b1", "priest");
    p = setSpeakerLabel(p, DE, "priest", { name: "Priester", short: "P" });
    const r = validate(p);
    expect(r.ok && r.prayer.variants[0]!.speakers).toEqual({
      priest: { name: "Priester", short: "P" },
    });
  });
});

describe("normalizeFormatVersion", () => {
  it("sets 2 when a block has a speaker, removes it otherwise", () => {
    const p = base();
    p.structure[0]!.speaker = "priest";
    expect(normalizeFormatVersion(p).formatVersion).toBe(2);
    const q = base();
    q.formatVersion = 2;
    expect("formatVersion" in normalizeFormatVersion(q)).toBe(false);
  });

  it("sets 2 for a non-empty variant speakers map and prunes empties", () => {
    const p = base();
    p.variants[0]!.speakers = { priest: { name: "P" } };
    expect(normalizeFormatVersion(p).formatVersion).toBe(2);
    const q = base();
    q.variants[0]!.speakers = { priest: {} };
    q.variants[1]!.speakers = {};
    const n = normalizeFormatVersion(q);
    expect("formatVersion" in n).toBe(false);
    expect("speakers" in n.variants[0]!).toBe(false);
    expect("speakers" in n.variants[1]!).toBe(false);
  });

  it("does not mutate its input", () => {
    const p = base();
    p.structure[0]!.speaker = "priest";
    const copy = structuredClone(p);
    normalizeFormatVersion(p);
    expect(p).toEqual(copy);
  });
});

describe("speaker helpers", () => {
  it("setBlockSpeaker assigns and clears, updating formatVersion", () => {
    const a = setBlockSpeaker(base(), "b1", "priest");
    expect(a.structure[0]!.speaker).toBe("priest");
    expect(a.formatVersion).toBe(2);
    const b = setBlockSpeaker(a, "b1", null);
    expect("speaker" in b.structure[0]!).toBe(false);
    expect("formatVersion" in b).toBe(false);
  });

  it("indexSpeakers lists block counts, labeled variants and stable order", () => {
    let p = setBlockSpeaker(base(), "b1", "choir");
    p = setBlockSpeaker(p, "b2", "priest");
    p = setBlockSpeaker(p, "b1", "choir");
    p = setSpeakerLabel(p, EN, "choir", { name: "Choir" });
    p = setSpeakerLabel(p, DE, "cantor", { short: "K" });
    p = setSpeakerLabel(p, DE, "alpha", { name: "A" });
    const idx = indexSpeakers(p);
    expect(idx.map((s) => s.id)).toEqual(["choir", "priest", "cantor", "alpha"]);
    expect(idx[0]).toEqual({ id: "choir", blockCount: 1, labeledVariants: [EN] });
    expect(idx[1]).toEqual({ id: "priest", blockCount: 1, labeledVariants: [] });
    expect(idx[2]).toEqual({ id: "cantor", blockCount: 0, labeledVariants: [DE] });
  });

  it("setSpeakerLabel trims, removes empty fields, labels and the map", () => {
    let p = setSpeakerLabel(base(), DE, "priest", { name: "  Priester ", short: " P " });
    expect(p.variants[0]!.speakers).toEqual({ priest: { name: "Priester", short: "P" } });
    expect(p.formatVersion).toBe(2);
    p = setSpeakerLabel(p, DE, "priest", { short: "  " });
    expect(p.variants[0]!.speakers).toEqual({ priest: { name: "Priester" } });
    p = setSpeakerLabel(p, DE, "priest", { name: "" });
    expect("speakers" in p.variants[0]!).toBe(false);
    expect("formatVersion" in p).toBe(false);
  });

  it("removeSpeaker clears blocks and labels in all variants", () => {
    let p = setBlockSpeaker(base(), "b1", "priest");
    p = setBlockSpeaker(p, "b2", "deacon");
    p = setSpeakerLabel(p, DE, "priest", { name: "Priester" });
    p = setSpeakerLabel(p, EN, "priest", { name: "Priest" });
    const r = removeSpeaker(p, "priest");
    expect(indexSpeakers(r).map((s) => s.id)).toEqual(["deacon"]);
    expect("speaker" in r.structure[0]!).toBe(false);
    expect(r.formatVersion).toBe(2);
    const none = removeSpeaker(r, "deacon");
    expect("formatVersion" in none).toBe(false);
  });

  it("resolveSpeakerLabel falls back to a title-cased id and first letter", () => {
    let p = base();
    expect(resolveSpeakerLabel(p, DE, "priest", "name")).toBe("Priest");
    expect(resolveSpeakerLabel(p, DE, "my-cantor", "name")).toBe("My cantor");
    expect(resolveSpeakerLabel(p, DE, "priest", "short")).toBe("P");
    p = setSpeakerLabel(p, DE, "priest", { name: "Diakon" });
    expect(resolveSpeakerLabel(p, DE, "priest", "name")).toBe("Diakon");
    expect(resolveSpeakerLabel(p, DE, "priest", "short")).toBe("D");
    p = setSpeakerLabel(p, DE, "priest", { short: "Pr" });
    expect(resolveSpeakerLabel(p, DE, "priest", "short")).toBe("Pr");
    expect(resolveSpeakerLabel(p, EN, "priest", "name")).toBe("Priest");
  });

  it("speakerChipLabel: short, then name letter, then id letter", () => {
    let p = base();
    expect(speakerChipLabel(p, DE, "choir")).toBe("C");
    p = setSpeakerLabel(p, DE, "choir", { name: "Chor" });
    expect(speakerChipLabel(p, DE, "choir")).toBe("C");
    p = setSpeakerLabel(p, DE, "priest", { name: "Zelebrant" });
    expect(speakerChipLabel(p, DE, "priest")).toBe("Z");
    p = setSpeakerLabel(p, DE, "priest", { short: "x" });
    expect(speakerChipLabel(p, DE, "priest")).toBe("x");
  });

  it("speakerDisplayLabel title-cases ids", () => {
    expect(speakerDisplayLabel("priest")).toBe("Priest");
    expect(speakerDisplayLabel("my-cantor")).toBe("My cantor");
  });

  it("presets and id helpers", () => {
    expect([...SPEAKER_PRESETS]).toEqual(["bishop", "priest", "deacon", "reader", "cantor", "choir", "people", "all"]);
    expect(isValidSpeakerId("priest")).toBe(true);
    expect(isValidSpeakerId("1x")).toBe(false);
    expect(isValidSpeakerId("a b")).toBe(false);
    expect(sanitizeSpeakerIdInput("12 my cantor!")).toBe("mycantor");
  });
});

describe("speaker kind style token", () => {
  it("validateStyles accepts true/false and rejects other values", () => {
    expect(validateStyles({ litany: { speaker: "true" } }).ok).toBe(true);
    expect(validateStyles({ litany: { speaker: "false" } }).ok).toBe(true);
    expect(validateStyles({ litany: { speaker: "yes" } }).ok).toBe(false);
    expect(validateStyles({ litany: { speaker: true } }).ok).toBe(false);
  });

  it("verse defaults to speaker true", () => {
    expect(DEFAULT_KIND_STYLES.verse?.speaker).toBe("true");
    expect(validateStyles(DEFAULT_KIND_STYLES).ok).toBe(true);
    const s = resolveStyles({ discoveredKinds: ["litany"] });
    expect(s.verse?.speaker).toBe("true");
    expect(s.litany?.speaker).toBeUndefined();
  });

  it("kindAllowsSpeaker rules", () => {
    expect(kindAllowsSpeaker("verse")).toBe(true);
    expect(kindAllowsSpeaker("verse", { verse: { speaker: "false" } } as never)).toBe(true);
    for (const k of ["heading", "subheading", "annotation"]) {
      expect(kindAllowsSpeaker(k, { [k]: { speaker: "true" } } as never)).toBe(false);
    }
    expect(kindAllowsSpeaker("litany")).toBe(false);
    expect(kindAllowsSpeaker("litany", { litany: { speaker: "false" } } as never)).toBe(false);
    expect(kindAllowsSpeaker("litany", { litany: { speaker: "true" } } as never)).toBe(true);
  });
});

describe("built-in speakers and rename", () => {
  it("listSpeakers returns every preset first, then custom speakers", () => {
    const p = setBlockSpeaker(base(), base().structure[0]!.id, "cantor-two");
    const list = listSpeakers(p);
    expect(list.slice(0, SPEAKER_PRESETS.length).map((s) => s.id)).toEqual([...SPEAKER_PRESETS]);
    expect(list.every((s, i) => s.preset === i < SPEAKER_PRESETS.length)).toBe(true);
    expect(list.at(-1)).toMatchObject({ id: "cantor-two", blockCount: 1, preset: false });
  });

  it("renameSpeaker moves blocks and labels; refuses presets, collisions and bad ids", () => {
    let p = setBlockSpeaker(base(), base().structure[0]!.id, "kantor");
    p = setSpeakerLabel(p, DE, "kantor", { name: "Kantor" });
    const r = renameSpeaker(p, "kantor", "vorsaenger")!;
    expect(r.structure[0]!.speaker).toBe("vorsaenger");
    expect(r.variants[0]!.speakers).toEqual({ vorsaenger: { name: "Kantor" } });
    expect(renameSpeaker(p, "kantor", "kantor")).toBe(p);
    expect(renameSpeaker(p, "kantor", "priest")).toBeNull();
    expect(renameSpeaker(p, "priest", "x")).toBeNull();
    expect(renameSpeaker(p, "kantor", "1bad")).toBeNull();
    const two = setSpeakerLabel(p, DE, "other", { name: "Other" });
    expect(renameSpeaker(two, "kantor", "other")).toBeNull();
    expect(isSpeakerPreset("all")).toBe(true);
  });
});
