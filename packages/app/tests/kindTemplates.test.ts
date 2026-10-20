import { describe, expect, it } from "vitest";
import {
  LEGACY_KINDS_TEMPLATE_ID,
  discoverKinds,
  validate,
  type KindStyle,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import { collectCatalog, scanLibraryCatalog } from "../src/catalog";
import {
  addKindToPrayer,
  applyCatalogChunk,
  applyKindRename,
  applyTemplateToPrayer,
  beginCreatePrayer,
  commitCreatePrayer,
  createKindTemplate,
  deleteKindInPrayer,
  deleteKindTemplate,
  dismissLibraryMigration,
  editDraft,
  emptySessionState,
  libraryMigrationStatus,
  migrateLibrary,
  persistLibraryStyles,
  putPrayerFromText,
  removeLibraryStyle,
  requestKindRename,
  saveAllDirty,
  saveBlockedReason,
  saveSelected,
  setCreateTemplate,
  setPrayerKindSpeaker,
  kindRenameConfirmMessage,
  libraryKindSources,
  undoDraft,
  unusedLibraryStyles,
  updateKindTemplate,
  type PrayerSessionState,
} from "../src/session";
import { memoryToolkit, STYLES_PATH, TEMPLATES_PATH } from "./memoryToolkit";

function prayer(id: string, kinds: string[], extra: Partial<Prayer> = {}): Prayer {
  return {
    id,
    type: "prayer",
    tone: null,
    variants: [
      { lang: "de", variant: "standard", title: id, license: "unknown", source: "t" },
    ],
    structure: kinds.map((kind, i) => ({ id: `b${i}`, kind, translations: [] })),
    ...extra,
  };
}

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const STYLE: KindStyle = {
  fontSize: "1rem",
  color: "accent",
  fontWeight: "400",
  fontStyle: "italic",
};

/** Library in the pre-`kinds` format: undeclared kinds + legacy speaker token. */
function legacyLibrary(extra: Record<string, string> = {}) {
  return memoryToolkit({
    "litany.json": text(prayer("litany", ["verse", "refrain"])),
    "hymn.json": text(prayer("hymn", ["heading", "tone-label"])),
    "plain.json": text(prayer("plain", ["verse"])),
    [STYLES_PATH]: text({
      refrain: { ...STYLE, speaker: "true" },
      "tone-label": STYLE,
    }),
    ...extra,
  });
}

async function openLibrary(
  api: ReturnType<typeof memoryToolkit>["api"],
): Promise<PrayerSessionState> {
  const catalog = await collectCatalog(scanLibraryCatalog("/lib", api));
  return applyCatalogChunk(emptySessionState(), catalog, { replace: true }).state;
}

async function openPrayer(
  state: PrayerSessionState,
  lib: ReturnType<typeof memoryToolkit>,
  path: string,
): Promise<PrayerSessionState> {
  return putPrayerFromText(state, path, lib.files[path]!).state;
}

describe("migration on open", () => {
  it("opens an old file migrated in memory and flags the catalog entry", async () => {
    const lib = legacyLibrary();
    const before = lib.files["litany.json"];
    let state = await openLibrary(lib.api);
    const entry = state.catalog!.entries.find((e) => e.path === "litany.json")!;
    expect(entry.valid).toBe(true);
    expect(entry.needsMigration).toBe(true);
    expect(
      state.catalog!.entries.find((e) => e.path === "plain.json")!.needsMigration,
    ).toBe(false);

    state = await openPrayer(state, lib, "litany.json");
    const draft = state.drafts["litany.json"]!;
    expect(draft.dirty).toBe(false);
    expect(draft.prayer.kinds).toEqual([{ id: "refrain", speaker: true }]);
    expect(validate(draft.prayer).ok).toBe(true);
    // Still flagged: the disk bytes are untouched.
    expect(lib.files["litany.json"]).toBe(before);
    expect(
      state.catalog!.entries.find((e) => e.path === "litany.json")!.needsMigration,
    ).toBe(true);
  });

  it("reports the pending migration and lets the user decline", async () => {
    const lib = legacyLibrary();
    const state = await openLibrary(lib.api);
    expect(libraryMigrationStatus(state)).toEqual({
      prayers: 2,
      legacyTokens: true,
      pending: true,
      templatesBroken: false,
      blocked: null,
    });
    const declined = dismissLibraryMigration(state);
    expect(libraryMigrationStatus(declined).pending).toBe(false);
    expect(lib.log).toEqual([]);
  });
});

describe("migrateLibrary", () => {
  it("writes prayers, then templates.json, then styles.json without legacy tokens", async () => {
    const lib = legacyLibrary();
    const state = await openLibrary(lib.api);
    const { state: next, report } = await migrateLibrary(state, lib.api);

    expect(lib.log).toEqual(["litany.json", "hymn.json", TEMPLATES_PATH, STYLES_PATH]);
    expect(report).toMatchObject({
      skippedUnsaved: [],
      failed: [],
      templatesWritten: true,
      stylesWritten: true,
    });
    const litany = lib.json("litany.json") as Prayer;
    expect(litany.formatVersion).toBe(3);
    expect(litany.kinds).toEqual([{ id: "refrain", speaker: true }]);
    expect(lib.json(TEMPLATES_PATH)).toEqual({
      templates: [
        {
          id: LEGACY_KINDS_TEMPLATE_ID,
          label: "Bisherige Kinds",
          kinds: [{ id: "refrain", speaker: true }, { id: "tone-label" }],
        },
      ],
    });
    expect(lib.json(STYLES_PATH)).toEqual({ refrain: STYLE, "tone-label": STYLE });

    expect(libraryMigrationStatus(next)).toMatchObject({
      prayers: 0,
      legacyTokens: false,
      pending: false,
    });
    expect(next.catalog!.templates.map((t) => t.id)).toEqual([LEGACY_KINDS_TEMPLATE_ID]);
  });

  it("keeps the legacy tokens when a prayer write fails", async () => {
    const lib = legacyLibrary();
    const state = await openLibrary(lib.api);
    lib.failWrites.add("hymn.json");
    const { state: next, report } = await migrateLibrary(state, lib.api);

    expect(report!.failed.map((f) => f.path)).toEqual(["hymn.json"]);
    expect(report!.stylesWritten).toBe(false);
    expect(lib.log).toEqual(["litany.json", TEMPLATES_PATH]);
    expect((lib.json(STYLES_PATH) as Record<string, KindStyle>).refrain?.speaker).toBe(
      "true",
    );
    expect(libraryMigrationStatus(next)).toMatchObject({ prayers: 1, legacyTokens: true });
  });

  it("skips prayers with unsaved edits and does not strip tokens yet", async () => {
    const lib = legacyLibrary();
    let state = await openPrayer(await openLibrary(lib.api), lib, "hymn.json");
    const draft = state.drafts["hymn.json"]!.prayer;
    state = editDraft(state, { ...draft, description: "edited" }).state;
    const before = lib.files["hymn.json"];

    const { state: next, report } = await migrateLibrary(state, lib.api);
    expect(report!.skippedUnsaved).toEqual(["hymn.json"]);
    expect(lib.files["hymn.json"]).toBe(before);
    expect(lib.log).not.toContain(STYLES_PATH);
    expect(next.drafts["hymn.json"]!.prayer.description).toBe("edited");
    expect(next.drafts["hymn.json"]!.dirty).toBe(true);
  });

  it("updates a clean open draft so the watcher sees an own write", async () => {
    const lib = legacyLibrary();
    const state = await openPrayer(await openLibrary(lib.api), lib, "litany.json");
    const { state: next } = await migrateLibrary(state, lib.api);
    expect(next.drafts["litany.json"]!.diskText).toBe(lib.files["litany.json"]);
    expect(next.drafts["litany.json"]!.dirty).toBe(false);
  });
});

describe("legacy speaker tokens survive style edits before migration", () => {
  it("keeps tokens when a style is edited or removed", async () => {
    const lib = legacyLibrary();
    let state = await openLibrary(lib.api);
    // The sanitized map has no speaker token; the file must keep it.
    expect(state.catalog!.libraryStyles.refrain?.speaker).toBeUndefined();

    state = (
      await persistLibraryStyles(state, lib.api, {
        ...state.catalog!.libraryStyles,
        refrain: { ...STYLE, color: "base" },
      })
    ).state;
    expect(lib.json(STYLES_PATH)).toMatchObject({
      refrain: { ...STYLE, color: "base", speaker: "true" },
    });

    state = (await removeLibraryStyle(state, lib.api, "refrain")).state;
    expect(lib.json(STYLES_PATH)).toMatchObject({ refrain: { speaker: "true" } });
    expect(state.catalog!.libraryStyles.refrain).toBeUndefined();

    // Migration afterwards still knows refrain allowed speakers.
    await migrateLibrary(state, lib.api);
    expect((lib.json("litany.json") as Prayer).kinds).toEqual([
      { id: "refrain", speaker: true },
    ]);
    expect(lib.json(STYLES_PATH)).not.toHaveProperty("refrain");
  });
});

describe("library-wide kind rename", () => {
  it("renames declared-only prayers (scanned and unscanned), templates and the style key", async () => {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["verse"], { kinds: [{ id: "refrain", speaker: true }] })),
      "b.json": text(prayer("b", ["refrain"], { kinds: [{ id: "refrain" }] })),
      "c.json": text(prayer("c", ["verse"], { kinds: [{ id: "refrain" }] })),
      "d.json": text(prayer("d", ["verse"])),
      [STYLES_PATH]: text({ refrain: { ...STYLE, speaker: "true" } }),
      [TEMPLATES_PATH]: text({
        templates: [{ id: "hymns", label: "Hymnen", kinds: [{ id: "refrain" }] }],
      }),
    });
    let state = await openLibrary(lib.api);
    // c.json not scanned yet: detection must read it.
    state = {
      ...state,
      catalog: {
        ...state.catalog!,
        scanComplete: false,
        entries: state.catalog!.entries.map((e) =>
          e.path === "c.json" ? { ...e, scanned: false, kinds: [] } : e,
        ),
      },
    };
    state = await openPrayer(state, lib, "b.json");

    const requested = await requestKindRename(state, lib.api, "refrain", "kehrvers");
    const plan = requested.state.pendingKindRename!;
    expect(plan.affectedPaths.sort()).toEqual(["a.json", "b.json", "c.json"]);

    const { state: next } = await applyKindRename(requested.state, lib.api, plan);
    expect((lib.json("a.json") as Prayer).kinds).toEqual([
      { id: "kehrvers", speaker: true },
    ]);
    expect((lib.json("c.json") as Prayer).kinds).toEqual([{ id: "kehrvers" }]);
    expect((lib.json("b.json") as Prayer).structure[0]!.kind).toBe("kehrvers");
    expect(lib.files["d.json"]).toBe(text(prayer("d", ["verse"])));
    expect(lib.json(TEMPLATES_PATH)).toEqual({
      templates: [{ id: "hymns", label: "Hymnen", kinds: [{ id: "kehrvers" }] }],
    });
    // Style key renamed; its legacy token moves with it.
    expect(lib.json(STYLES_PATH)).toEqual({
      kehrvers: { ...STYLE, speaker: "true" },
    });
    expect(next.drafts["b.json"]!.prayer.kinds).toEqual([{ id: "kehrvers" }]);
    expect(next.catalog!.templates[0]!.kinds).toEqual([{ id: "kehrvers" }]);
    expect(next.pendingKindRename).toBeNull();
  });
});

describe("per-prayer kind operations", () => {
  async function openPlain() {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["verse", "refrain"], { kinds: [{ id: "refrain" }] })),
      "b.json": text(prayer("b", ["refrain"], { kinds: [{ id: "refrain" }] })),
    });
    const state = await openPrayer(await openLibrary(lib.api), lib, "a.json");
    return { lib, state };
  }

  it("adds a custom kind to the open prayer only (undoable, no style write)", async () => {
    const { lib, state } = await openPlain();
    const added = addKindToPrayer(state, "tone-label", { speaker: true }).state;
    expect(added.drafts["a.json"]!.prayer.kinds).toEqual([
      { id: "refrain" },
      { id: "tone-label", speaker: true },
    ]);
    expect(added.drafts["a.json"]!.dirty).toBe(true);
    expect(lib.log).toEqual([]);
    expect(undoDraft(added).drafts["a.json"]!.prayer.kinds).toEqual([{ id: "refrain" }]);

    const rejected = addKindToPrayer(added, "verse");
    expect(rejected.state).toBe(added);
    expect(rejected.notices[0]?.title).toBe("Cannot add kind");
  });

  it("deletes a kind in this prayer only, as one undo step", async () => {
    const { lib, state } = await openPlain();
    const deleted = deleteKindInPrayer(state, "refrain").state;
    const p = deleted.drafts["a.json"]!.prayer;
    expect(p.kinds).toBeUndefined();
    expect(p.structure.map((b) => b.kind)).toEqual(["verse", "verse"]);
    expect(lib.log).toEqual([]);
    expect(deleted.drafts["a.json"]!.history?.past.length).toBe(1);
    const undone = undoDraft(deleted).drafts["a.json"]!.prayer;
    expect(undone.kinds).toEqual([{ id: "refrain" }]);
    expect(undone.structure.map((b) => b.kind)).toEqual(["verse", "refrain"]);
    // Presets cannot be deleted.
    expect(deleteKindInPrayer(state, "verse").state).toBe(state);
  });

  it("toggles speaker allowance per prayer", async () => {
    const { state } = await openPlain();
    const on = setPrayerKindSpeaker(state, "refrain", true).state;
    expect(on.drafts["a.json"]!.prayer.kinds).toEqual([{ id: "refrain", speaker: true }]);
    const off = setPrayerKindSpeaker(on, "refrain", false).state;
    expect(off.drafts["a.json"]!.prayer.kinds).toEqual([{ id: "refrain" }]);
  });
});

describe("kind templates", () => {
  it("creates, updates and deletes templates in templates.json", async () => {
    const lib = memoryToolkit({ "a.json": text(prayer("a", ["verse"])) });
    let state = await openLibrary(lib.api);

    const created = await createKindTemplate(state, lib.api, {
      label: "Hymnen für Sonntag",
      kinds: [{ id: "refrain", speaker: true }],
    });
    expect(created.templateId).toBe("hymnen-fur-sonntag");
    state = created.state;
    expect(lib.json(TEMPLATES_PATH)).toEqual({
      templates: [
        {
          id: "hymnen-fur-sonntag",
          label: "Hymnen für Sonntag",
          kinds: [{ id: "refrain", speaker: true }],
        },
      ],
    });

    state = (
      await updateKindTemplate(state, lib.api, "hymnen-fur-sonntag", {
        label: "Hymnen",
        kinds: [{ id: "refrain" }, { id: "tone-label" }],
      })
    ).state;
    expect(state.catalog!.templates).toEqual([
      {
        id: "hymnen-fur-sonntag",
        label: "Hymnen",
        kinds: [{ id: "refrain" }, { id: "tone-label" }],
      },
    ]);

    const dup = await createKindTemplate(state, lib.api, { label: "Hymnen für Sonntag" });
    expect(dup.templateId).toBe("hymnen-fur-sonntag-2");
    state = dup.state;

    state = (await deleteKindTemplate(state, lib.api, "hymnen-fur-sonntag")).state;
    expect((lib.json(TEMPLATES_PATH) as { templates: { id: string }[] }).templates.map((t) => t.id)).toEqual([
      "hymnen-fur-sonntag-2",
    ]);
    expect(state.catalog!.templates.map((t) => t.id)).toEqual(["hymnen-fur-sonntag-2"]);
  });

  it("refuses to rewrite a templates.json that has errors", async () => {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["verse"])),
      [TEMPLATES_PATH]: text({ templates: [{ id: "Bad Id", label: "x", kinds: [] }] }),
    });
    const state = await openLibrary(lib.api);
    expect(state.catalog!.templateErrors.length).toBeGreaterThan(0);
    const result = await createKindTemplate(state, lib.api, { label: "New" });
    expect(result.templateId).toBeNull();
    expect(result.notices[0]?.color).toBe("accent");
    expect(lib.log).toEqual([]);
  });

  it("applies a template to the open prayer additively", async () => {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["verse"], { kinds: [{ id: "refrain" }] })),
      [TEMPLATES_PATH]: text({
        templates: [
          { id: "hymns", label: "Hymnen", kinds: [{ id: "refrain", speaker: true }, { id: "tone-label" }] },
        ],
      }),
    });
    const state = await openPrayer(await openLibrary(lib.api), lib, "a.json");
    const next = applyTemplateToPrayer(state, "hymns").state;
    expect(next.drafts["a.json"]!.prayer.kinds).toEqual([
      { id: "refrain" },
      { id: "tone-label" },
    ]);
    expect(undoDraft(next).drafts["a.json"]!.prayer.kinds).toEqual([{ id: "refrain" }]);
  });

  it("stamps a template into a new prayer", async () => {
    const lib = memoryToolkit({
      [TEMPLATES_PATH]: text({
        templates: [{ id: "hymns", label: "Hymnen", kinds: [{ id: "refrain", speaker: true }] }],
      }),
    });
    let state = await openLibrary(lib.api);
    state = (await beginCreatePrayer(state, lib.api)).state;
    state = setCreateTemplate(state, "hymns");
    expect(state.createTemplateId).toBe("hymns");
    expect(state.createDraft!.kinds).toEqual([{ id: "refrain", speaker: true }]);
    // Switching back to "No template" removes the stamp.
    expect(setCreateTemplate(state, null).createDraft!.kinds).toBeUndefined();

    const { state: created } = await commitCreatePrayer(state, lib.api);
    const written = lib.json("new-prayer-1.json") as Prayer;
    expect(written.formatVersion).toBe(3);
    expect(written.kinds).toEqual([{ id: "refrain", speaker: true }]);
    expect(created.createTemplateId).toBeNull();
    // Editing the template later never touches the prayer.
    await updateKindTemplate(created, lib.api, "hymns", { kinds: [] });
    expect((lib.json("new-prayer-1.json") as Prayer).kinds).toEqual([
      { id: "refrain", speaker: true },
    ]);
  });
});

describe("kind discovery for styles", () => {
  it("lists prayer, template and style kinds and flags unused style keys", async () => {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["verse"], { kinds: [{ id: "refrain" }] })),
      [STYLES_PATH]: text({ refrain: STYLE, orphan: STYLE, "from-template": STYLE }),
      [TEMPLATES_PATH]: text({
        templates: [{ id: "t", label: "T", kinds: [{ id: "from-template" }, { id: "tpl-only" }] }],
      }),
    });
    const state = await openLibrary(lib.api);
    expect(discoverKinds(libraryKindSources(state.catalog, state.drafts))).toEqual([
      "from-template",
      "orphan",
      "refrain",
      "tpl-only",
      "verse",
    ]);
    expect(unusedLibraryStyles(state)).toEqual(["orphan"]);
    // Not before the scan is complete.
    expect(
      unusedLibraryStyles({ ...state, catalog: { ...state.catalog!, scanComplete: false } }),
    ).toEqual([]);
  });
});

describe("unused style keys and broken files", () => {
  it("counts kinds of files that parse but do not validate as used", async () => {
    const broken = { ...prayer("broken", ["refrain"]), variants: "nope" };
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["verse"])),
      "broken.json": text(broken),
      [STYLES_PATH]: text({ refrain: STYLE, orphan: STYLE }),
    });
    const state = await openLibrary(lib.api);
    const entry = state.catalog!.entries.find((e) => e.path === "broken.json")!;
    expect(entry.valid).toBe(false);
    expect(entry.kinds).toEqual(["refrain"]);
    expect(unusedLibraryStyles(state)).toEqual(["orphan"]);
  });

  it("offers nothing while a file is not JSON", async () => {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["verse"])),
      "bad.json": "{ not json",
      [STYLES_PATH]: text({ orphan: STYLE }),
    });
    const state = await openLibrary(lib.api);
    expect(state.catalog!.entries.find((e) => e.path === "bad.json")!.readable).toBe(false);
    expect(unusedLibraryStyles(state)).toEqual([]);
  });
});

describe("styles.json that is not JSON", () => {
  it("is never overwritten", async () => {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["verse"])),
      [STYLES_PATH]: "{ broken",
    });
    const state = await openLibrary(lib.api);
    expect(state.catalog!.libraryStylesRaw).toBeNull();
    const result = await persistLibraryStyles(state, lib.api, { verse: STYLE });
    expect(result.state).toBe(state);
    expect(result.notices[0]?.message).toMatch(/not a valid JSON object/);
    expect(lib.files[STYLES_PATH]).toBe("{ broken");
    expect(lib.log).toEqual([]);
  });
});

describe("migration while styles.json is unreadable", () => {
  it("waits, refuses to write old-format drafts, and keeps the speaker flag for later", async () => {
    const lib = legacyLibrary();
    const goodStyles = lib.files[STYLES_PATH]!;
    lib.files[STYLES_PATH] = "{ broken";
    let state = await openLibrary(lib.api);

    const status = libraryMigrationStatus(state);
    expect(status.prayers).toBe(2);
    expect(status.pending).toBe(false);
    expect(status.blocked).toMatch(/styles\.json/);

    const run = await migrateLibrary(state, lib.api);
    expect(run.report).toBeNull();
    expect(run.notices[0]?.title).toBe("Cannot migrate yet");
    expect(lib.log).toEqual([]);

    // The in-memory migration lacks the speaker flag: saving it is refused.
    state = await openPrayer(state, lib, "litany.json");
    const draft = state.drafts["litany.json"]!.prayer;
    state = editDraft(state, { ...draft, description: "edited" }).state;
    const saved = await saveSelected(state, lib.api);
    expect(saved.notices[0]?.title).toBe("Cannot save");
    expect(saveBlockedReason(state, "litany.json")).not.toBeNull();
    const savedAll = await saveAllDirty(state, lib.api);
    expect(savedAll.notices[0]?.title).toBe("Cannot save all");
    expect(lib.log).toEqual([]);

    // Fixed file: the flag survives the migration.
    lib.files[STYLES_PATH] = goodStyles;
    const fixed = await openLibrary(lib.api);
    expect(libraryMigrationStatus(fixed).pending).toBe(true);
    await migrateLibrary(fixed, lib.api);
    expect((lib.json("litany.json") as Prayer).kinds).toEqual([{ id: "refrain", speaker: true }]);
  });

  it("treats a styles.json that is valid JSON but not an object as unreadable", async () => {
    const lib = legacyLibrary();
    lib.files[STYLES_PATH] = "[1, 2]";
    const state = await openLibrary(lib.api);
    expect(libraryMigrationStatus(state).blocked).toMatch(/styles\.json/);
    const result = await persistLibraryStyles(state, lib.api, { verse: STYLE });
    expect(result.notices[0]?.message).toMatch(/not a valid JSON object/);
    expect(lib.files[STYLES_PATH]).toBe("[1, 2]");
  });

  it("does not offer migration for legacy tokens alone while templates.json is broken", async () => {
    const lib = memoryToolkit({
      "a.json": text(
        prayer("a", ["refrain"], { formatVersion: 3, kinds: [{ id: "refrain" }] }),
      ),
      [STYLES_PATH]: text({ refrain: { ...STYLE, speaker: "true" } }),
      [TEMPLATES_PATH]: "{ broken",
    });
    const status = libraryMigrationStatus(await openLibrary(lib.api));
    expect(status).toMatchObject({ prayers: 0, legacyTokens: true, pending: false });
    expect(status.blocked).toMatch(/templates\.json/);
  });
});

describe("migrateLibrary with files it cannot read", () => {
  it("reports non-JSON prayers as failed and keeps the legacy tokens", async () => {
    const lib = legacyLibrary({ "bad.json": "{ not json" });
    const state = await openLibrary(lib.api);
    const { report } = await migrateLibrary(state, lib.api);
    expect(report!.failed).toEqual([{ path: "bad.json", reason: "invalid JSON" }]);
    expect(report!.stylesWritten).toBe(false);
    expect(lib.log).not.toContain(STYLES_PATH);
    expect((lib.json(STYLES_PATH) as Record<string, KindStyle>).refrain?.speaker).toBe("true");
    // The readable prayers are still migrated.
    expect((lib.json("litany.json") as Prayer).kinds).toEqual([{ id: "refrain", speaker: true }]);
  });
});

describe("kind rename refusals", () => {
  function library(extra: Record<string, string> = {}) {
    return memoryToolkit({
      "a.json": text(prayer("a", ["refrain"], { kinds: [{ id: "refrain" }] })),
      "b.json": text(prayer("b", ["tone"], { kinds: [{ id: "tone" }] })),
      [STYLES_PATH]: text({
        refrain: { ...STYLE, color: "base" },
        styled: STYLE,
        legacy: { speaker: "true" },
      }),
      [TEMPLATES_PATH]: text({
        templates: [{ id: "t", label: "T", kinds: [{ id: "tpl-only" }] }],
      }),
      ...extra,
    });
  }

  async function refused(
    lib: ReturnType<typeof memoryToolkit>,
    to: string,
    prepare?: (s: PrayerSessionState) => PrayerSessionState,
  ) {
    let state = await openPrayer(await openLibrary(lib.api), lib, "a.json");
    if (prepare) state = prepare(state);
    const before = { ...lib.files };
    const result = await requestKindRename(state, lib.api, "refrain", to);
    expect(result.state.pendingKindRename).toBeNull();
    expect(lib.log).toEqual([]);
    expect(lib.files).toEqual(before);
    return result.notices[0]?.message;
  }

  it("refuses a target that exists anywhere in the library", async () => {
    // Another prayer (not in this prayer's picker), a template, a style key,
    // a token-only raw style entry.
    for (const to of ["tone", "tpl-only", "styled", "legacy"]) {
      expect(await refused(library(), to)).toBe(`Kind “${to}” already exists in the library`);
    }
  });

  it("refuses a preset target", async () => {
    expect(await refused(library(), "verse")).toBe(
      "Kind “verse” already exists in the library",
    );
  });

  it("refuses a target used only in a not-yet-scanned file", async () => {
    const lib = library({ "c.json": text(prayer("c", ["hidden"])) });
    const msg = await refused(lib, "hidden", (s) => ({
      ...s,
      catalog: {
        ...s.catalog!,
        scanComplete: false,
        entries: s.catalog!.entries.map((e) =>
          e.path === "c.json" ? { ...e, scanned: false, kinds: [] } : e,
        ),
      },
    }));
    expect(msg).toBe("Kind “hidden” already exists in the library");
  });

  it("refuses while templates.json has errors (nothing written)", async () => {
    const lib = library({
      [TEMPLATES_PATH]: text({ templates: [{ id: "Bad Id", label: "x", kinds: [] }] }),
    });
    expect(await refused(lib, "kehrvers")).toMatch(/templates\.json has errors/);
  });

  it("refuses when an affected prayer cannot be rewritten", async () => {
    const lib = library({
      "broken.json": text({ ...prayer("broken", ["refrain"]), variants: "nope" }),
    });
    expect(await refused(lib, "kehrvers")).toMatch(/broken\.json/);
  });
});

describe("kind rename confirm and drafts", () => {
  it("asks first when a template is affected, even for one prayer", async () => {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["refrain"], { kinds: [{ id: "refrain" }] })),
      [TEMPLATES_PATH]: text({
        templates: [{ id: "t", label: "T", kinds: [{ id: "refrain" }] }],
      }),
    });
    const state = await openLibrary(lib.api);
    const { state: next } = await requestKindRename(state, lib.api, "refrain", "kehrvers");
    const plan = next.pendingKindRename!;
    expect(plan).toEqual({
      from: "refrain",
      to: "kehrvers",
      affectedPaths: ["a.json"],
      affectedTemplates: ["t"],
    });
    expect(kindRenameConfirmMessage(plan)).toBe(
      "Rename “refrain” to “kehrvers” in 1 prayer and 1 kind template? This writes those files now.",
    );
    expect(lib.log).toEqual([]);
  });

  it("keeps the applied prayer rename when templates.json / styles.json cannot be written", async () => {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["refrain"], { formatVersion: 3, kinds: [{ id: "refrain" }] })),
      [TEMPLATES_PATH]: text({
        templates: [{ id: "t", label: "T", kinds: [{ id: "refrain" }] }],
      }),
      [STYLES_PATH]: text({ refrain: STYLE }),
    });
    let state = await openPrayer(await openLibrary(lib.api), lib, "a.json");
    const requested = await requestKindRename(state, lib.api, "refrain", "kehrvers");
    lib.failWrites.add(TEMPLATES_PATH);
    lib.failWrites.add(STYLES_PATH);
    const { state: next, notices } = await applyKindRename(
      requested.state,
      lib.api,
      requested.state.pendingKindRename!,
    );
    expect((lib.json("a.json") as Prayer).kinds).toEqual([{ id: "kehrvers" }]);
    const draft = next.drafts["a.json"]!;
    expect(draft.prayer.kinds).toEqual([{ id: "kehrvers" }]);
    expect(draft.saved?.kinds).toEqual([{ id: "kehrvers" }]);
    expect(draft.diskText).toBe(lib.files["a.json"]);
    expect(draft.dirty).toBe(false);
    expect(next.catalog!.entries.find((e) => e.path === "a.json")!.kinds).toContain("kehrvers");
    expect(next.pendingKindRename).toBeNull();
    expect(notices.map((n) => n.title)).toEqual([
      "Kind partly renamed",
      "Templates not renamed",
      "Kind style not renamed",
    ]);
  });

  it("applies right away for one prayer and no template", async () => {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["refrain"], { kinds: [{ id: "refrain" }] })),
    });
    const state = await openLibrary(lib.api);
    const { state: next } = await requestKindRename(state, lib.api, "refrain", "kehrvers");
    expect(next.pendingKindRename).toBeNull();
    expect((lib.json("a.json") as Prayer).kinds).toEqual([{ id: "kehrvers" }]);
  });

  it("keeps open drafts in line with disk and never writes unsaved edits", async () => {
    const lib = memoryToolkit({
      "a.json": text(prayer("a", ["refrain"], { kinds: [{ id: "refrain" }] })),
      "b.json": text(prayer("b", ["refrain"], { kinds: [{ id: "refrain" }] })),
    });
    let state = await openLibrary(lib.api);
    state = await openPrayer(state, lib, "b.json");
    state = editDraft(state, { ...state.drafts["b.json"]!.prayer, description: "unsaved" }).state;
    state = await openPrayer(state, lib, "a.json");

    const requested = await requestKindRename(state, lib.api, "refrain", "kehrvers");
    const { state: next } = await applyKindRename(
      requested.state,
      lib.api,
      requested.state.pendingKindRename!,
    );

    const a = next.drafts["a.json"]!;
    expect(a.dirty).toBe(false);
    expect(a.saved).toBe(a.prayer);
    expect(a.diskText).toBe(lib.files["a.json"]);
    expect(a.prayer.kinds).toEqual([{ id: "kehrvers" }]);

    const b = next.drafts["b.json"]!;
    const disk = lib.json("b.json") as Prayer;
    expect(disk.description).toBeUndefined();
    expect(disk.kinds).toEqual([{ id: "kehrvers" }]);
    expect(b.dirty).toBe(true);
    expect(b.prayer.description).toBe("unsaved");
    expect(b.prayer.kinds).toEqual([{ id: "kehrvers" }]);
    expect(b.saved?.kinds).toEqual([{ id: "kehrvers" }]);
    expect(b.diskText).toBe(lib.files["b.json"]);
    // Undo back to the file state is clean again; history uses the new id.
    const selectedB = { ...next, selectedPath: "b.json" };
    const undone = undoDraft(selectedB).drafts["b.json"]!;
    expect(undone.prayer.kinds).toEqual([{ id: "kehrvers" }]);
    expect(undone.dirty).toBe(false);
  });
});

describe("style saves never drop what the app cannot read", () => {
  const RAW = {
    refrain: { ...STYLE, glow: "yes", speaker: "true" },
    "bad kind": { color: "base" },
    junk: { nothing: 1 },
    tone: STYLE,
  };

  function lib() {
    return memoryToolkit({
      "a.json": text(prayer("a", ["refrain", "tone"])),
      [STYLES_PATH]: text(RAW),
    });
  }

  it("keeps invalid entries and fields on edit, drops only on purpose", async () => {
    const l = lib();
    let state = await openLibrary(l.api);
    expect(state.catalog!.styleErrors.length).toBeGreaterThan(0);

    state = (
      await persistLibraryStyles(state, l.api, {
        ...state.catalog!.libraryStyles,
        tone: { ...STYLE, color: "base" },
      })
    ).state;
    expect(l.json(STYLES_PATH)).toEqual({ ...RAW, tone: { ...STYLE, color: "base" } });
    // The catalog still reports what the file contains.
    expect(state.catalog!.styleErrors.length).toBeGreaterThan(0);

    state = (await removeLibraryStyle(state, l.api, "tone")).state;
    expect(l.json(STYLES_PATH)).not.toHaveProperty("tone");
    expect(l.json(STYLES_PATH)).toMatchObject({ "bad kind": { color: "base" }, junk: { nothing: 1 } });
  });

  it("moves unreadable fields with a renamed kind", async () => {
    const l = lib();
    const state = await openLibrary(l.api);
    await requestKindRename(state, l.api, "refrain", "kehrvers");
    const written = l.json(STYLES_PATH) as Record<string, unknown>;
    expect(written).not.toHaveProperty("refrain");
    expect(written.kehrvers).toEqual({ ...STYLE, glow: "yes", speaker: "true" });
    expect(written["bad kind"]).toEqual({ color: "base" });
  });

  it("migration strips only the speaker token", async () => {
    const l = lib();
    const state = await openLibrary(l.api);
    const { report } = await migrateLibrary(state, l.api);
    expect(report!.stylesWritten).toBe(true);
    expect(l.json(STYLES_PATH)).toEqual({
      ...RAW,
      refrain: { ...STYLE, glow: "yes" },
    });
  });
});
