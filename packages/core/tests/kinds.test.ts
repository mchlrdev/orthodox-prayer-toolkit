import { describe, expect, it } from "vitest";
import {
  CURRENT_FORMAT_VERSION,
  LEGACY_KINDS_TEMPLATE_ID,
  addTemplateKind,
  applyTemplate,
  declareBlockKinds,
  declareKinds,
  deleteKind,
  dropDisallowedSpeakers,
  indexKinds,
  isPrayerFilename,
  isValidTemplateId,
  migratePrayer,
  moveTemplateKind,
  normalizeFormatVersion,
  pickerKinds,
  planLibraryMigration,
  removeTemplateKind,
  renameKind,
  renameTemplateKind,
  sanitizeStyles,
  sanitizeTemplates,
  setKindSpeaker,
  setTemplateKindSpeaker,
  stampTemplate,
  validate,
  validateTemplates,
  type Prayer,
  discoverKinds,
  hasLegacyStyleFields,
  legacyStyleFields,
  libraryKindsInUse,
  rawPrayerKinds,
  removeStyleKey,
  renameStyleKey,
  stripLegacyStyleFields,
  templateIdFromLabel,
  unusedStyleKeys,
  stylesFileObject,
} from "../src/index.js";
import type { KindTemplate, Prayer } from "../src/index.js";

function base(): Prayer {
  return {
    id: "kinds",
    type: "prayer",
    variants: [
      { lang: "de", variant: "standard", title: "K", license: "x", source: "x" },
    ],
    structure: [
      {
        id: "b1",
        kind: "verse",
        translations: [{ lang: "de", variant: "standard", lines: ["Eins"] }],
      },
    ],
  };
}

/** Pre-`kinds` prayer using custom kinds, speakers and inline notes. */
function legacy(): Prayer {
  return {
    formatVersion: 2,
    id: "legacy",
    type: "prayer",
    variants: [
      {
        lang: "de",
        variant: "standard",
        title: "L",
        license: "x",
        source: "x",
        speakers: { priest: { name: "Priester" } },
      },
    ],
    structure: [
      {
        id: "b1",
        kind: "litany",
        translations: [{ lang: "de", variant: "standard", text: "Lasset uns" }],
      },
      {
        id: "b2",
        kind: "refrain",
        translations: [
          {
            lang: "de",
            variant: "standard",
            text: [
              { t: "text", v: "Herr, erbarme dich" },
              { t: "note", v: "3x" },
            ],
          },
        ],
      },
      {
        id: "b3",
        kind: "litany",
        translations: [{ lang: "de", variant: "standard", text: "Wieder" }],
      },
      {
        id: "b4",
        kind: "verse",
        speaker: "priest",
        translations: [{ lang: "de", variant: "standard", lines: ["Amen"] }],
      },
    ],
  };
}

const json = (v: unknown): string => JSON.stringify(v);

describe("prayer kinds: schema and validate", () => {
  it("accepts declared custom kinds", () => {
    const p: Prayer = {
      ...base(),
      formatVersion: 3,
      kinds: [{ id: "refrain", speaker: true }, { id: "tone-label" }],
    };
    p.structure.push({ id: "b2", kind: "refrain", translations: [] });
    const r = validate(p);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prayer.kinds).toEqual(p.kinds);
  });

  it("rejects undeclared kinds with kind-undeclared", () => {
    const p = base();
    p.structure.push({ id: "b2", kind: "refrain", translations: [] });
    const r = validate(p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        {
          path: "/structure/1/kind",
          message: 'Kind "refrain" is not declared in kinds',
          code: "kind-undeclared",
        },
      ]);
    }
  });

  it("rejects duplicate and preset ids in kinds", () => {
    const r = validate({ ...base(), kinds: [{ id: "x" }, { id: "x" }, { id: "verse" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => [e.path, e.code])).toEqual([
        ["/kinds/1/id", "kind-duplicate"],
        ["/kinds/2/id", "kind-preset-declared"],
      ]);
    }
  });

  it("schema rejects empty kinds, speaker false, extra keys and bad ids", () => {
    const bad = (kinds: unknown): boolean => validate({ ...base(), kinds }).ok;
    expect(bad([])).toBe(false);
    expect(bad([{ id: "x", speaker: false }])).toBe(false);
    expect(bad([{ id: "x", label: "X" }])).toBe(false);
    expect(bad([{ id: "1x" }])).toBe(false);
    expect(bad([{ id: "x", speaker: true }])).toBe(true);
  });

  it("accepts formatVersion 3 and rejects newer", () => {
    expect(CURRENT_FORMAT_VERSION).toBe(3);
    expect(validate({ ...base(), formatVersion: 3 }).ok).toBe(true);
    const r = validate({ ...base(), formatVersion: 4 });
    expect(!r.ok && r.errors[0]?.code).toBe("format-version-newer");
  });

  it("normalizeFormatVersion: 3 iff kinds, else 2 iff speakers, else omitted", () => {
    const withKinds: Prayer = { ...base(), kinds: [{ id: "x" }] };
    expect(normalizeFormatVersion(withKinds).formatVersion).toBe(3);
    const speakers = legacy();
    delete speakers.formatVersion;
    expect(normalizeFormatVersion(speakers).formatVersion).toBe(2);
    expect(normalizeFormatVersion({ ...speakers, kinds: [{ id: "x" }] }).formatVersion).toBe(3);
    expect("formatVersion" in normalizeFormatVersion({ ...base(), formatVersion: 3 })).toBe(false);
  });
});

describe("prayer kind helpers", () => {
  it("pickerKinds lists presets then declared kinds in order", () => {
    expect(pickerKinds({ kinds: [{ id: "b" }, { id: "a" }] })).toEqual([
      "heading",
      "subheading",
      "annotation",
      "verse",
      "b",
      "a",
    ]);
    expect(pickerKinds(base())).toHaveLength(4);
  });

  it("declareKinds appends missing ids, skips presets, keeps existing entries", () => {
    const p = declareKinds(base(), [{ id: "refrain", speaker: true }]);
    expect(p.kinds).toEqual([{ id: "refrain", speaker: true }]);
    expect(p.formatVersion).toBe(3);
    expect(Object.keys(p)).toEqual(["id", "type", "variants", "kinds", "structure", "formatVersion"]);
    const q = declareKinds(p, [{ id: "refrain" }, { id: "verse" }, { id: "tone" }]);
    expect(q.kinds).toEqual([{ id: "refrain", speaker: true }, { id: "tone" }]);
    expect(declareKinds(q, [{ id: "tone" }, { id: "heading" }])).toBe(q);
    expect(declareKinds(base(), [])).toEqual(base());
  });

  it("declareBlockKinds declares pasted kinds with the source speaker flag", () => {
    const source: Prayer = { ...legacy(), kinds: [{ id: "litany", speaker: true }, { id: "refrain" }] };
    const p = declareBlockKinds(base(), source.structure, source);
    expect(p.kinds).toEqual([{ id: "litany", speaker: true }, { id: "refrain" }]);
    expect(declareBlockKinds(base(), legacy().structure).kinds).toEqual([
      { id: "litany" },
      { id: "refrain" },
    ]);
    expect(declareBlockKinds(base(), base().structure)).toEqual(base());
  });

  it("setKindSpeaker toggles declared custom kinds only", () => {
    const p = declareKinds(base(), [{ id: "refrain" }]);
    const on = setKindSpeaker(p, "refrain", true);
    expect(on.kinds).toEqual([{ id: "refrain", speaker: true }]);
    const off = setKindSpeaker(on, "refrain", false);
    expect(off.kinds).toEqual([{ id: "refrain" }]);
    expect("speaker" in off.kinds![0]!).toBe(false);
    expect(setKindSpeaker(p, "refrain", false)).toBe(p);
    expect(setKindSpeaker(p, "verse", true)).toBe(p);
    expect(setKindSpeaker(p, "nope", true)).toBe(p);
  });

  it("renameKind renames blocks and the kinds entry", () => {
    const p = migratePrayer(legacy(), { styles: { litany: { speaker: "true" } } }).prayer;
    const r = renameKind(p, "litany", "ektenie");
    expect(r.structure.map((b) => b.kind)).toEqual(["ektenie", "refrain", "ektenie", "verse"]);
    expect(r.kinds).toEqual([{ id: "ektenie", speaker: true }, { id: "refrain" }]);
    const merged = renameKind(p, "litany", "refrain");
    expect(merged.kinds).toEqual([{ id: "refrain", speaker: true }]);
    const toPreset = renameKind(p, "refrain", "verse");
    expect(toPreset.kinds).toEqual([{ id: "litany", speaker: true }]);
    expect(validate(toPreset).ok).toBe(true);
  });

  it("renameKind refuses presets and short-circuits when nothing changes", () => {
    const p = migratePrayer(legacy()).prayer;
    expect(renameKind(p, "verse", "strophe")).toBe(p);
    expect(renameKind(p, "heading", "x")).toBe(p);
    expect(renameKind(p, "nope", "other")).toBe(p);
    expect(renameKind(p, "litany", "litany")).toBe(p);
  });

  it("renameKind declares the target when renamed blocks were undeclared", () => {
    const r = renameKind(legacy(), "litany", "ektenie");
    expect(r.kinds).toEqual([{ id: "ektenie" }]);
    const withSpeaker = legacy();
    withSpeaker.structure[0]!.speaker = "deacon";
    expect(renameKind(withSpeaker, "litany", "ektenie").kinds).toEqual([
      { id: "ektenie", speaker: true },
    ]);
    const declaredOnly = declareKinds(base(), [{ id: "spare", speaker: true }]);
    expect(renameKind(declaredOnly, "spare", "reserve").kinds).toEqual([
      { id: "reserve", speaker: true },
    ]);
  });

  it("deleteKind drops the entry and reassigns blocks", () => {
    const p = migratePrayer(legacy()).prayer;
    const d = deleteKind(p, "refrain");
    expect(d.kinds).toEqual([{ id: "litany" }]);
    expect(d.structure[1]?.kind).toBe("verse");
    const all = deleteKind(d, "litany");
    expect("kinds" in all).toBe(false);
    expect(all.formatVersion).toBe(2);
    expect(validate(all).ok).toBe(true);
    expect(deleteKind(p, "nope")).toBe(p);
  });

  it("deleteKind only falls back to a preset or declared kind", () => {
    const p = migratePrayer(legacy()).prayer;
    const toDeclared = deleteKind(p, "refrain", "litany");
    expect(toDeclared.structure[1]?.kind).toBe("litany");
    const toUnknown = deleteKind(p, "refrain", "ghost");
    expect(toUnknown.structure[1]?.kind).toBe("verse");
    expect(validate(toUnknown).ok).toBe(true);
    expect(deleteKind(p, "refrain", "refrain").structure[1]?.kind).toBe("verse");
    expect(deleteKind(p, "verse").structure[3]?.kind).toBe("annotation");
    expect(deleteKind(p, "refrain", "heading").structure[1]?.kind).toBe("heading");
  });

  it("indexKinds includes declared but unused kinds", () => {
    const p = declareKinds(base(), [{ id: "unused" }]);
    expect(indexKinds([p])).toEqual(["unused", "verse"]);
  });
});

describe("kind templates", () => {
  const hymns: KindTemplate = {
    id: "hymns",
    label: "Hymnen",
    kinds: [{ id: "refrain", speaker: true }, { id: "tone" }],
  };

  it("validateTemplates accepts the documented shape", () => {
    const data = { templates: [hymns, { id: "empty", label: "Leer", kinds: [] }] };
    expect(validateTemplates(data)).toEqual({ ok: true, templates: data.templates });
    expect(isValidTemplateId("legacy-kinds")).toBe(true);
    expect(isValidTemplateId("Hymns")).toBe(false);
  });

  it("sanitizeTemplates keeps valid parts and reports the rest", () => {
    const { templates, errors } = sanitizeTemplates({
      templates: [
        {
          id: "hymns",
          label: "Hymnen",
          kinds: [
            { id: "refrain" },
            { id: "refrain" },
            { id: "verse" },
            { id: "1x" },
            { id: "x", speaker: false },
            { id: "y", extra: 1 },
            { id: "ok", speaker: true },
          ],
        },
        { id: "hymns", label: "Again", kinds: [] },
        { id: "Bad Id", label: "X", kinds: [] },
        { id: "nolabel", label: " ", kinds: [] },
        "nope",
        { id: "extra", label: "E", kinds: [], color: "red" },
      ],
    });
    expect(templates).toEqual([
      { id: "hymns", label: "Hymnen", kinds: [{ id: "refrain" }, { id: "ok", speaker: true }] },
    ]);
    expect(errors.map((e) => e.path)).toEqual([
      "/templates/0/kinds/1/id",
      "/templates/0/kinds/2/id",
      "/templates/0/kinds/3/id",
      "/templates/0/kinds/4/speaker",
      "/templates/0/kinds/5/extra",
      "/templates/1/id",
      "/templates/2/id",
      "/templates/3/label",
      "/templates/4",
      "/templates/5/color",
    ]);
    expect(validateTemplates({ templates: [{ id: "a", label: "A" }] }).ok).toBe(false);
    expect(sanitizeTemplates([]).errors).toHaveLength(1);
  });

  it("stampTemplate copies the template's kinds into a new prayer", () => {
    const p = stampTemplate(base(), hymns);
    expect(p.kinds).toEqual(hymns.kinds);
    expect(p.kinds).not.toBe(hymns.kinds);
    expect(p.formatVersion).toBe(3);
    expect(validate(p).ok).toBe(true);
    expect(stampTemplate(base(), null)).toEqual(base());
    expect(stampTemplate(base(), { id: "e", label: "E", kinds: [] })).toEqual(base());
  });

  it("applyTemplate merges additively and keeps existing entries", () => {
    const p = declareKinds(base(), [{ id: "tone", speaker: true }, { id: "mine" }]);
    const r = applyTemplate(p, hymns);
    expect(r.kinds).toEqual([{ id: "tone", speaker: true }, { id: "mine" }, { id: "refrain", speaker: true }]);
    expect(applyTemplate(r, hymns)).toBe(r);
  });

  it("renameTemplateKind / removeTemplateKind touch every template", () => {
    const other: KindTemplate = { id: "other", label: "O", kinds: [{ id: "x" }] };
    const renamed = renameTemplateKind([hymns, other], "refrain", "kehrvers");
    expect(renamed[0]?.kinds).toEqual([{ id: "kehrvers", speaker: true }, { id: "tone" }]);
    expect(renamed[1]).toBe(other);
    const merged = renameTemplateKind([hymns], "refrain", "tone");
    expect(merged[0]?.kinds).toEqual([{ id: "tone", speaker: true }]);
    const removed = removeTemplateKind([hymns, other], "tone");
    expect(removed[0]?.kinds).toEqual([{ id: "refrain", speaker: true }]);
    expect(removed[1]).toBe(other);
  });

  it("templates.json is not a prayer file", () => {
    expect(isPrayerFilename("templates.json")).toBe(false);
    expect(isPrayerFilename(".orthodox-prayer-toolkit/templates.json")).toBe(false);
  });
});

describe("migratePrayer", () => {
  it("declares used custom kinds in first-appearance order with legacy speaker flags", () => {
    const { prayer, changed } = migratePrayer(legacy(), {
      styles: { litany: { speaker: "true" }, refrain: { speaker: "false" } },
    });
    expect(changed).toBe(true);
    expect(prayer.kinds).toEqual([{ id: "litany", speaker: true }, { id: "refrain" }]);
    expect(prayer.formatVersion).toBe(3);
    expect(validate(prayer).ok).toBe(true);
  });

  it("also reads a boolean legacy speaker token", () => {
    const { prayer } = migratePrayer(legacy(), { styles: { litany: { speaker: true } } });
    expect(prayer.kinds?.[0]).toEqual({ id: "litany", speaker: true });
  });

  it("is lossless: blocks, texts, speakers and variants are byte-identical", () => {
    const before = legacy();
    const { prayer } = migratePrayer(before, { styles: { litany: { speaker: "true" } } });
    expect(json(prayer.structure)).toBe(json(legacy().structure));
    expect(json(prayer.variants)).toBe(json(legacy().variants));
    const { kinds: _k, formatVersion: _f, ...rest } = prayer;
    const { formatVersion: _g, ...restBefore } = legacy();
    expect(rest).toEqual(restBefore);
    expect(json(before)).toBe(json(legacy()));
  });

  it("is idempotent", () => {
    const styles = { litany: { speaker: "true" } };
    const once = migratePrayer(legacy(), { styles }).prayer;
    const twice = migratePrayer(once, { styles });
    expect(twice.changed).toBe(false);
    expect(twice.prayer).toBe(once);
    expect(migratePrayer(once).changed).toBe(false);
  });

  it("is additive: keeps existing entries and only appends missing kinds", () => {
    const p: Prayer = { ...legacy(), kinds: [{ id: "refrain", speaker: true }, { id: "spare" }] };
    const { prayer } = migratePrayer(p, { styles: { refrain: { speaker: "false" } } });
    expect(prayer.kinds).toEqual([{ id: "refrain", speaker: true }, { id: "spare" }, { id: "litany" }]);
  });

  it("leaves preset-only prayers alone and normalizes only formatVersion", () => {
    expect(migratePrayer(base())).toEqual({ prayer: base(), changed: false });
    const stale = migratePrayer({ ...base(), formatVersion: 2 });
    expect(stale.changed).toBe(true);
    expect("formatVersion" in stale.prayer).toBe(false);
  });

  it("sets speaker when a block of an undeclared kind already has one", () => {
    const p = legacy();
    p.structure[1]!.speaker = "choir";
    expect(migratePrayer(p).prayer.kinds).toEqual([{ id: "litany" }, { id: "refrain", speaker: true }]);
    const declared: Prayer = { ...p, kinds: [{ id: "refrain" }] };
    expect(migratePrayer(declared).prayer.kinds).toEqual([{ id: "refrain" }, { id: "litany" }]);
  });

  it("never declares invalid kind ids; validate reports them at the block", () => {
    const p = legacy();
    p.structure[1]!.kind = "my kind";
    const { prayer } = migratePrayer(p);
    expect(prayer.kinds).toEqual([{ id: "litany" }]);
    const r = validate(prayer);
    expect(!r.ok && r.errors.map((e) => [e.path, e.code])).toEqual([
      ["/structure/1/kind", "kind-undeclared"],
    ]);
  });

  it("drops an empty kinds array", () => {
    const { prayer, changed } = migratePrayer({ ...base(), kinds: [] });
    expect(changed).toBe(true);
    expect(prayer).toEqual(base());
    expect(validate(prayer).ok).toBe(true);
  });

  it("keeps duplicate and preset ids in input kinds for validate to report", () => {
    const p: Prayer = { ...legacy(), kinds: [{ id: "refrain" }, { id: "refrain" }, { id: "verse" }] };
    const { prayer } = migratePrayer(p);
    expect(prayer.kinds).toEqual([{ id: "refrain" }, { id: "refrain" }, { id: "verse" }, { id: "litany" }]);
    expect(migratePrayer(prayer).changed).toBe(false);
    const r = validate(prayer);
    expect(!r.ok && r.errors.map((e) => [e.path, e.code])).toEqual([
      ["/kinds/1/id", "kind-duplicate"],
      ["/kinds/2/id", "kind-preset-declared"],
    ]);
  });

  it("returns malformed and newer-format input unchanged", () => {
    for (const bad of [null, [], { id: "x" }, { structure: [{ kind: 1 }], variants: [] }, { structure: [], variants: [], kinds: "x" }]) {
      const r = migratePrayer(bad as unknown as Prayer);
      expect(r.changed).toBe(false);
      expect(r.prayer).toBe(bad);
    }
    const newer = { ...legacy(), formatVersion: 4 };
    expect(migratePrayer(newer).prayer).toBe(newer);
  });
});

describe("planLibraryMigration", () => {
  const styles = {
    litany: { speaker: "true", fontSize: "1rem" },
    stylesOnly: { color: "accent" },
    speakerOnly: { speaker: "true" },
    verse: { speaker: "true", initialCap: "true" },
  };

  it("migrates prayers, adds the legacy-kinds template and strips legacy tokens", () => {
    const presetsOnly = base();
    const plan = planLibraryMigration({ prayers: [legacy(), presetsOnly], styles, templates: { templates: [] } });
    expect(plan.needed).toBe(true);
    expect(plan.prayers[0]?.changed).toBe(true);
    expect(plan.prayers[0]?.prayer.kinds).toEqual([{ id: "litany", speaker: true }, { id: "refrain" }]);
    expect(plan.prayers[1]).toEqual({ prayer: presetsOnly, changed: false });
    expect(plan.templates).toEqual([
      {
        id: LEGACY_KINDS_TEMPLATE_ID,
        label: "Bisherige Kinds",
        kinds: [
          { id: "litany", speaker: true },
          { id: "refrain" },
          { id: "speakerOnly", speaker: true },
          { id: "stylesOnly" },
        ],
      },
    ]);
    expect(plan.styles).toEqual({
      litany: { fontSize: "1rem" },
      stylesOnly: { color: "accent" },
      verse: { initialCap: "true" },
    });
    expect(validateTemplates({ templates: plan.templates }).ok).toBe(true);
    expect(sanitizeStyles(plan.styles).errors).toEqual([]);
  });

  it("is idempotent: a migrated library plans nothing", () => {
    const first = planLibraryMigration({ prayers: [legacy()], styles });
    const second = planLibraryMigration({
      prayers: first.prayers.map((p) => p.prayer),
      styles: first.styles,
      templates: { templates: first.templates },
    });
    expect(second).toEqual({
      prayers: [{ prayer: first.prayers[0]!.prayer, changed: false }],
      templates: null,
      styles: null,
      templateErrors: [],
      needed: false,
    });
    // Deleting the template later must not resurrect it.
    const later = planLibraryMigration({
      prayers: first.prayers.map((p) => p.prayer),
      styles: first.styles,
      templates: { templates: [] },
    });
    expect(later.needed).toBe(false);
    expect(later.templates).toBeNull();
  });

  it("creates no template when the library has no custom kinds", () => {
    const plan = planLibraryMigration({
      prayers: [base()],
      styles: { verse: { speaker: "true", fontSize: "1rem" } },
    });
    expect(plan.templates).toBeNull();
    expect(plan.styles).toEqual({ verse: { fontSize: "1rem" } });
    expect(plan.needed).toBe(true);
    expect(planLibraryMigration({ prayers: [base()] }).needed).toBe(false);
  });

  it("never overwrites an existing legacy-kinds template", () => {
    const mine: KindTemplate = { id: LEGACY_KINDS_TEMPLATE_ID, label: "Meins", kinds: [] };
    const plan = planLibraryMigration({ prayers: [legacy()], styles, templates: { templates: [mine] } });
    expect(plan.templates).toBeNull();
    expect(plan.prayers[0]?.changed).toBe(true);
  });

  it("never rewrites an invalid templates.json and holds back styles", () => {
    const raw = { templates: [{ id: "hymns", label: "H", kinds: [], note: "keep me" }] };
    const plan = planLibraryMigration({ prayers: [legacy()], styles, templates: raw });
    expect(plan.templateErrors.map((e) => e.path)).toEqual(["/templates/0/note"]);
    expect(plan.templates).toBeNull();
    expect(plan.styles).toBeNull();
    expect(plan.prayers[0]?.changed).toBe(true);
    expect(plan.needed).toBe(true);
    const unreadable = planLibraryMigration({ prayers: [base()], styles, templates: "x" });
    expect(unreadable.needed).toBe(false);
    expect(unreadable.templateErrors).toHaveLength(1);
  });

  it("legacy-kinds template takes speaker flags from block speakers", () => {
    const p = legacy();
    p.structure[1]!.speaker = "choir";
    const plan = planLibraryMigration({ prayers: [p] });
    expect(plan.templates?.[0]?.kinds).toEqual([{ id: "litany" }, { id: "refrain", speaker: true }]);
  });

  it("appends to existing templates", () => {
    const hymns: KindTemplate = { id: "hymns", label: "Hymnen", kinds: [] };
    const plan = planLibraryMigration({ prayers: [legacy()], templates: { templates: [hymns] } });
    expect(plan.templates?.map((t) => t.id)).toEqual(["hymns", LEGACY_KINDS_TEMPLATE_ID]);
    expect(plan.templates?.[0]).toEqual(hymns);
    expect(plan.styles).toBeNull();
  });
});

describe("library kind index", () => {
  const sources = {
    prayerKinds: [["verse", "refrain"], ["heading"]],
    templates: [{ kinds: [{ id: "from-template" }, { id: "tpl-only" }] }],
    styles: { refrain: {}, orphan: {}, "from-template": {}, verse: {} },
  };

  it("unions prayer and template kinds (no style keys)", () => {
    expect(libraryKindsInUse(sources)).toEqual([
      "from-template",
      "heading",
      "refrain",
      "tpl-only",
      "verse",
    ]);
  });

  it("adds style keys for the full library vocabulary", () => {
    expect(discoverKinds(sources)).toEqual([
      "from-template",
      "heading",
      "orphan",
      "refrain",
      "tpl-only",
      "verse",
    ]);
    expect(discoverKinds({ styles: "not an object" })).toEqual([]);
  });

  it("flags custom style keys used by no prayer and no template", () => {
    expect(unusedStyleKeys(sources)).toEqual(["orphan"]);
    // Presets are never unused.
    expect(unusedStyleKeys({ styles: { annotation: {} } })).toEqual([]);
  });

  it("reads kinds from unvalidated prayer JSON", () => {
    expect(
      rawPrayerKinds({
        structure: [{ kind: "refrain" }, { kind: 3 }, null, { kind: "verse" }],
        kinds: [{ id: "tone" }, { id: 1 }, "x"],
      }),
    ).toEqual(["refrain", "tone", "verse"]);
    expect(rawPrayerKinds(null)).toEqual([]);
    expect(rawPrayerKinds({ structure: "nope" })).toEqual([]);
  });
});

describe("styles.json helpers", () => {
  const STYLE = { fontSize: "1rem", color: "base", fontWeight: "400", fontStyle: "normal" } as const;

  it("finds, restores and strips legacy tokens", () => {
    const raw = { refrain: { ...STYLE, speaker: "true" }, tone: STYLE, odd: 3 };
    expect(legacyStyleFields(raw)).toEqual({ refrain: { speaker: "true" } });
    expect(hasLegacyStyleFields(raw)).toBe(true);
    expect(hasLegacyStyleFields({ tone: STYLE })).toBe(false);
    expect(hasLegacyStyleFields(undefined)).toBe(false);

    // A style edit keeps the token; removing the style keeps only the token.
    expect(
      stylesFileObject({ refrain: { ...STYLE, color: "accent" }, tone: STYLE }, raw),
    ).toEqual({ refrain: { ...STYLE, color: "accent", speaker: "true" }, tone: STYLE, odd: 3 });
    expect(stylesFileObject({ tone: STYLE }, raw, { remove: ["refrain"] })).toEqual({
      refrain: { speaker: "true" },
      tone: STYLE,
      odd: 3,
    });

    expect(stripLegacyStyleFields(raw)).toEqual({ refrain: STYLE, tone: STYLE, odd: 3 });
    expect(stripLegacyStyleFields({ only: { speaker: "true" } })).toEqual({});
    expect(stripLegacyStyleFields({ tone: STYLE })).toBeNull();
    expect(stripLegacyStyleFields(null)).toBeNull();
  });

  it("merges an edit back over the raw file without losing what it cannot read", () => {
    const raw = {
      verse: { ...STYLE, htmlTag: "h2", glow: "yes", fontSize: "huge" },
      "bad kind": { color: "base" },
      junk: { nothing: 1 },
      tone: STYLE,
    };
    const edited = {
      // htmlTag cleared on purpose; fontSize now valid; glow untouched.
      verse: { ...STYLE, color: "accent" as const },
      tone: STYLE,
      added: STYLE,
    };
    expect(stylesFileObject(edited, raw)).toEqual({
      verse: { ...STYLE, color: "accent", glow: "yes" },
      "bad kind": { color: "base" },
      junk: { nothing: 1 },
      tone: STYLE,
      added: STYLE,
    });
    // A kind the edit does not mention stays; only `remove` drops it.
    expect(stylesFileObject({}, { tone: STYLE })).toEqual({ tone: STYLE });
    expect(stylesFileObject({}, { tone: { ...STYLE, glow: "x" } }, { remove: ["tone"] })).toEqual({});
    // No file yet.
    expect(stylesFileObject({ tone: STYLE }, undefined)).toEqual({ tone: STYLE });
    expect(() => stylesFileObject({ tone: STYLE }, [1, 2])).toThrow(/not a JSON object/);
    expect(() => stylesFileObject({ tone: STYLE }, null)).toThrow(/not a JSON object/);
  });

  it("renames and removes style keys without merging", () => {
    const map = { refrain: STYLE, tone: STYLE };
    expect(renameStyleKey(map, "refrain", "kehrvers")).toEqual({ tone: STYLE, kehrvers: STYLE });
    expect(renameStyleKey(map, "missing", "x")).toBe(map);
    expect(renameStyleKey(map, "refrain", "refrain")).toBe(map);
    expect(() => renameStyleKey(map, "refrain", "tone")).toThrow(/already exists/);
    expect(removeStyleKey(map, "tone")).toEqual({ refrain: STYLE });
    expect(removeStyleKey(map, "missing")).toBe(map);
  });
});

describe("templateIdFromLabel", () => {
  it("slugs the label and keeps ids unique", () => {
    expect(templateIdFromLabel("Hymnen für Sonntag", [])).toBe("hymnen-fur-sonntag");
    expect(templateIdFromLabel("Hymns", ["hymns", "hymns-2"])).toBe("hymns-3");
    expect(templateIdFromLabel("  ***  ", [])).toBe("template");
    expect(isValidTemplateId(templateIdFromLabel("Ἦχος πλ. δʹ", []))).toBe(true);
  });
});

describe("template kind list editing", () => {
  const t: KindTemplate = {
    id: "hymns",
    label: "Hymns",
    kinds: [{ id: "refrain", speaker: true }, { id: "tone-label" }],
  };

  it("adds a kind once, never a preset or invalid id", () => {
    expect(addTemplateKind(t, { id: "stich" }).kinds.map((k) => k.id)).toEqual([
      "refrain",
      "tone-label",
      "stich",
    ]);
    expect(addTemplateKind(t, { id: "x", speaker: true }).kinds[2]).toEqual({
      id: "x",
      speaker: true,
    });
    expect(addTemplateKind(t, { id: "refrain" })).toBe(t);
    expect(addTemplateKind(t, { id: "verse" })).toBe(t);
    expect(addTemplateKind(t, { id: "1bad" })).toBe(t);
  });

  it("toggles the speaker flag without writing speaker: false", () => {
    expect(setTemplateKindSpeaker(t, "refrain", false).kinds[0]).toEqual({ id: "refrain" });
    expect(setTemplateKindSpeaker(t, "tone-label", true).kinds[1]).toEqual({
      id: "tone-label",
      speaker: true,
    });
    expect(setTemplateKindSpeaker(t, "refrain", true)).toBe(t);
    expect(setTemplateKindSpeaker(t, "missing", true)).toBe(t);
  });

  it("moves a kind one step and ignores moves past the ends", () => {
    expect(moveTemplateKind(t, "tone-label", -1).kinds.map((k) => k.id)).toEqual([
      "tone-label",
      "refrain",
    ]);
    expect(moveTemplateKind(t, "refrain", -1)).toBe(t);
    expect(moveTemplateKind(t, "tone-label", 1)).toBe(t);
    expect(moveTemplateKind(t, "missing", 1)).toBe(t);
  });
});

describe("speakers only on kinds that take them", () => {
  const withSpeakerBlocks = (): Prayer => ({
    id: "dialog",
    type: "prayer",
    formatVersion: 3,
    variants: [
      { lang: "en", variant: "standard", title: "Dialog", license: "unknown", source: "test" },
    ],
    kinds: [{ id: "refrain", speaker: true }, { id: "plain" }],
    structure: [
      {
        id: "b1",
        kind: "refrain",
        speaker: "priest",
        translations: [{ lang: "en", variant: "standard", text: "Blessed is our God." }],
      },
      {
        id: "b2",
        kind: "verse",
        speaker: "people",
        translations: [{ lang: "en", variant: "standard", text: "Amen." }],
      },
    ],
    meta: {},
  });

  it("validate rejects a speaker on a kind that takes none", () => {
    const p = withSpeakerBlocks();
    p.structure[1] = { ...p.structure[1]!, kind: "heading" };
    const result = validate(p);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.code)).toContain("speaker-kind-not-allowed");
    }
    p.structure[0] = { ...p.structure[0]!, kind: "plain" };
    p.structure[1] = { ...p.structure[1]!, kind: "verse" };
    expect(validate(p).ok).toBe(false);
  });

  it("setKindSpeaker(false) drops the speakers of that kind", () => {
    const off = setKindSpeaker(withSpeakerBlocks(), "refrain", false);
    expect(off.structure[0]!.speaker).toBeUndefined();
    expect(off.structure[1]!.speaker).toBe("people");
    expect(validate(off).ok).toBe(true);
  });

  it("deleteKind and renameKind onto a preset without speakers drop them", () => {
    const deleted = deleteKind(withSpeakerBlocks(), "refrain", "annotation");
    expect(deleted.structure[0]!.kind).toBe("annotation");
    expect(deleted.structure[0]!.speaker).toBeUndefined();
    expect(validate(deleted).ok).toBe(true);

    const renamed = renameKind(withSpeakerBlocks(), "refrain", "heading");
    expect(renamed.structure[0]!.speaker).toBeUndefined();
    expect(validate(renamed).ok).toBe(true);

    const toVerse = renameKind(withSpeakerBlocks(), "refrain", "verse");
    expect(toVerse.structure[0]!.speaker).toBe("priest");
  });

  it("dropDisallowedSpeakers keeps a prayer without stray speakers as is", () => {
    const p = withSpeakerBlocks();
    expect(dropDisallowedSpeakers(p)).toBe(p);
  });
});
