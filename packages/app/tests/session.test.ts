import { describe, expect, it, vi } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import { patchCatalogPrayer, type LibraryCatalog } from "../src/catalog";
import {
  applyDraftEdit,
  validationErrorsFor,
  validationFor,
} from "../src/session/draftEdit";
import { persistPrayer } from "../src/session/persistPrayer";
import {
  deletePrayer,
  editDraft,
  emptySessionState,
  mergeOpResult,
  openPrayer,
  requestLeave,
  saveSelected,
  sidebarEntries,
} from "../src/session/operations";
import type { PrayerToolkitApi } from "../electron/preload";

const samplePrayer = (): Prayer => ({
  id: "morning",
  type: "prayer",
  tone: null,
  variants: [
    {
      lang: "de",
      variant: "standard",
      title: "Morgen",
      license: "unknown",
      source: "test",
    },
  ],
  structure: [
    {
      id: "b1",
      kind: "verse",
      translations: [
        { lang: "de", variant: "standard", text: "Herr, erbarme dich." },
      ],
    },
  ],
    meta: {},
});

function fakeApi(
  overrides: Partial<PrayerToolkitApi> = {},
): PrayerToolkitApi {
  const api: PrayerToolkitApi = {
    getStartupLibrary: async () => null,
    openLibraryFolder: async () => null,
    createLibraryFolder: async () => null,
    openLibraryPath: async (root) => root,
    listJsonFiles: async () => [],
    readText: async () => "",
    readTexts: async (root, paths) =>
      Promise.all(
        paths.map(async (path) => ({
          path,
          text: await api.readText(root, path),
        })),
      ),
    writeText: async () => undefined,
    createText: async (root, path, content) => {
      if (await api.exists(root, path)) return false;
      await api.writeText(root, path, content);
      return true;
    },
    deleteFile: async () => undefined,
    renameFile: async () => undefined,
    exists: async () => false,
    readLibraryStyles: async () => null,
    writeLibraryStyles: async () => undefined,
    readLibraryTemplates: async () => null,
    writeLibraryTemplates: async () => undefined,
    saveExport: async () => null,
    pickPrayerJson: async () => null,
    showItem: async () => undefined,
    basename: async (p) => p.split("/").pop() ?? p,
    onCloseRequested: () => () => undefined,
    confirmClose: () => undefined,
    setDirty: () => undefined,
    getAppInfo: async () => ({ version: "0.0.0-test", packaged: false }),
    checkForUpdates: async () => ({ status: "dev", version: "0.0.0-test" }),
    installUpdate: async () => ({ ok: false }),
    onUpdateStatus: () => () => undefined,
    watchLibrary: async () => undefined,
    onLibraryChanged: () => () => undefined,
    onCommand: () => () => undefined,
    runEdit: async () => undefined,
    onInstallRequested: () => () => undefined,
    confirmInstall: () => undefined,
    ...overrides,
  };
  return api;
}

describe("applyDraftEdit", () => {
  it("keeps valid prayers with reconciled columns", () => {
    const prayer = samplePrayer();
    const session = applyDraftEdit(prayer, [
      { lang: "de", variant: "standard" },
    ]);
    expect(session.errors).toEqual([]);
    expect(session.dirty).toBe(true);
    expect(session.visibleVariants).toEqual([
      { lang: "de", variant: "standard" },
    ]);
    expect(session.prayer.id).toBe("morning");
  });

  it("preserves previous errors until validate runs", () => {
    const prayer = samplePrayer();
    prayer.id = "";
    const session = applyDraftEdit(
      prayer,
      [{ lang: "de", variant: "standard" }],
      [{ path: "/id", message: "stale" }],
    );
    expect(session.errors).toEqual([{ path: "/id", message: "stale" }]);
    expect(session.dirty).toBe(true);
  });
});

describe("validationErrorsFor", () => {
  it("returns errors for invalid prayers", () => {
    const prayer = samplePrayer();
    prayer.id = "";
    expect(validationErrorsFor(prayer).length).toBeGreaterThan(0);
  });
});
describe("validationFor", () => {
  it("returns speaker warnings without errors", () => {
    const prayer = samplePrayer();
    prayer.formatVersion = 2;
    prayer.structure[0] = { ...prayer.structure[0]!, speaker: "priest" };
    const { errors, warnings } = validationFor(prayer);
    expect(errors).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.code).toBe("speaker-name-missing");
    expect(warnings[0]!.message).toContain("\u201cPriest\u201d");
    expect(validationErrorsFor(prayer)).toEqual([]);
  });

  it("applyDraftEdit keeps previous warnings until validate runs", () => {
    const w = [{ path: "/x", message: "m", code: "speaker-name-missing" }];
    const d = applyDraftEdit(samplePrayer(), [], [], w);
    expect(d.warnings).toEqual(w);
  });
});

describe("persistPrayer", () => {
  it("writes in place when the id matches the filename", async () => {
    const writeText = vi.fn(async () => undefined);
    const api = fakeApi({ writeText });
    const result = await persistPrayer(
      api,
      "/lib",
      "morning.json",
      samplePrayer(),
    );
    expect(result).toEqual({ ok: true, path: "morning.json" });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[1]).toBe("morning.json");
  });

  it("renames when the id changes and the target is free", async () => {
    const writeText = vi.fn(async () => undefined);
    const deleteFile = vi.fn(async () => undefined);
    const api = fakeApi({
      writeText,
      deleteFile,
      exists: async () => false,
    });
    const prayer = samplePrayer();
    prayer.id = "evening";
    const result = await persistPrayer(api, "/lib", "morning.json", prayer);
    expect(result).toEqual({ ok: true, path: "evening.json" });
    expect(writeText.mock.calls[0]?.[1]).toBe("evening.json");
    expect(deleteFile).toHaveBeenCalledWith("/lib", "morning.json");
  });

  it("blocks rename when the target already exists", async () => {
    const api = fakeApi({ exists: async () => true });
    const prayer = samplePrayer();
    prayer.id = "evening";
    const result = await persistPrayer(api, "/lib", "morning.json", prayer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/collision/i);
    }
  });
});

describe("persistPrayer folders and collisions", () => {
  it("renames inside the prayer's folder", async () => {
    const writeText = vi.fn(async () => undefined);
    const deleteFile = vi.fn(async () => undefined);
    const api = fakeApi({ writeText, deleteFile });
    const prayer = samplePrayer();
    prayer.id = "evening";
    const result = await persistPrayer(api, "/lib", "sub/morning.json", prayer);
    expect(result).toEqual({ ok: true, path: "sub/evening.json" });
    expect(writeText.mock.calls[0]?.[1]).toBe("sub/evening.json");
    expect(deleteFile).toHaveBeenCalledWith("/lib", "sub/morning.json");
  });

  it("blocks a rename onto an id that lives in another folder", async () => {
    const writeText = vi.fn(async () => undefined);
    const api = fakeApi({ writeText });
    const prayer = samplePrayer();
    prayer.id = "evening";
    const result = await persistPrayer(api, "/lib", "sub/morning.json", prayer, [
      { path: "sub/morning.json", id: "morning" },
      { path: "other/evening.json", id: "evening" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("other/evening.json");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("does not overwrite a file that appears during the rename", async () => {
    const writeText = vi.fn(async () => undefined);
    const deleteFile = vi.fn(async () => undefined);
    const api = fakeApi({
      writeText,
      deleteFile,
      createText: async () => false,
    });
    const prayer = samplePrayer();
    prayer.id = "evening";
    const result = await persistPrayer(api, "/lib", "morning.json", prayer);
    expect(result.ok).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });
});

describe("session operations", () => {
  const col = { lang: "de", variant: "standard" };

  function prayerAt(id: string, title: string, kind = "verse"): Prayer {
    return {
      id,
      type: "prayer",
      tone: null,
      variants: [
        {
          lang: "de",
          variant: "standard",
          title,
          license: "unknown",
          source: "test",
        },
      ],
      structure: [
        {
          id: "b1",
          kind,
          translations: [
            { lang: "de", variant: "standard", text: `${id} body` },
          ],
        },
      ],
      meta: {},
    };
  }

  function catalogOf(
    files: Record<string, Prayer>,
    options?: { stubs?: string[]; scanComplete?: boolean },
  ): LibraryCatalog {
    let catalog: LibraryCatalog = {
      root: "/lib",
      entries: [],
      collisions: [],
      variants: [],
      manifest: null,
      libraryStyles: {},
      styleErrors: [],
      libraryStylesRaw: undefined,
      templates: [],
      templateErrors: [],
      templatesRaw: undefined,
      scanComplete: options?.scanComplete ?? true,
    };
    for (const [path, prayer] of Object.entries(files)) {
      catalog = patchCatalogPrayer(catalog, path, prayer);
    }
    for (const path of options?.stubs ?? []) {
      catalog = {
        ...catalog,
        entries: [
          ...catalog.entries,
          {
            path,
            id: path.replace(/\.json$/, ""),
            title: null,
            description: null,
            valid: true,
            errors: [],
            filenameMismatch: false,
            kinds: [],
            variants: [],
            scanned: false,
          },
        ],
        scanComplete: false,
      };
    }
    return catalog;
  }

  function stateWithCatalog(catalog: LibraryCatalog) {
    return { ...emptySessionState(), catalog };
  }

  it("marks a draft dirty and evicts a clean prayer on switch", async () => {
    const files: Record<string, Prayer> = {
      "a.json": prayerAt("a", "A"),
      "b.json": prayerAt("b", "B"),
    };
    const api = fakeApi({
      readText: async (_root, path) => JSON.stringify(files[path]),
    });
    let state = stateWithCatalog(catalogOf(files));

    const entryA = state.catalog!.entries.find((e) => e.path === "a.json")!;
    state = (await openPrayer(state, api, entryA)).state;
    expect(state.drafts["a.json"]?.dirty).toBe(false);

    const edited = structuredClone(state.drafts["a.json"]!.prayer);
    edited.variants[0]!.title = "A*";
    state = editDraft(state, edited).state;
    expect(state.drafts["a.json"]?.dirty).toBe(true);

    const entryB = state.catalog!.entries.find((e) => e.path === "b.json")!;
    state = (await openPrayer(state, api, entryB)).state;
    expect(state.selectedPath).toBe("b.json");
    expect(state.drafts["a.json"]?.dirty).toBe(true);
    expect(state.drafts["b.json"]?.dirty).toBe(false);

    state = (await openPrayer(state, api, entryA)).state;
    expect(state.selectedPath).toBe("a.json");
    expect(state.drafts["a.json"]?.dirty).toBe(true);
    expect(state.drafts["b.json"]).toBeUndefined();
  });

  it("save patches catalog title without listing or reading the library", async () => {
    const files: Record<string, Prayer> = {
      "a.json": prayerAt("a", "A"),
      "b.json": prayerAt("b", "B"),
    };
    const listJsonFiles = vi.fn(async () => Object.keys(files));
    const readTexts = vi.fn(async () => {
      throw new Error("readTexts should not run on save");
    });
    const readText = vi.fn(async (_root: string, path: string) =>
      JSON.stringify(files[path]),
    );
    const api = fakeApi({ listJsonFiles, readTexts, readText });
    let state = stateWithCatalog(catalogOf(files));
    const entryA = state.catalog!.entries.find((e) => e.path === "a.json")!;
    state = (await openPrayer(state, api, entryA)).state;

    listJsonFiles.mockClear();
    readTexts.mockClear();
    readText.mockClear();

    const edited = structuredClone(state.drafts["a.json"]!.prayer);
    edited.variants[0]!.title = "Patched A";
    state = editDraft(state, edited).state;
    state = (await saveSelected(state, api)).state;

    expect(listJsonFiles).not.toHaveBeenCalled();
    expect(readTexts).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
    expect(state.catalog?.entries.find((e) => e.path === "a.json")?.title).toBe(
      "Patched A",
    );
    expect(state.drafts["a.json"]?.dirty).toBe(false);
  });

  it("drops the old catalog path when saving a new id", async () => {
    const files: Record<string, Prayer> = {
      "morning.json": prayerAt("morning", "Morgen"),
    };
    const api = fakeApi({
      readText: async (_root, path) => JSON.stringify(files[path]),
      exists: async () => false,
    });
    let state = stateWithCatalog(catalogOf(files));
    const entry = state.catalog!.entries.find((e) => e.path === "morning.json")!;
    state = (await openPrayer(state, api, entry)).state;

    const edited = structuredClone(state.drafts["morning.json"]!.prayer);
    edited.id = "evening";
    state = editDraft(state, edited).state;
    const before = state;
    const result = await saveSelected(state, api);
    state = mergeOpResult(before, before, result);

    expect(state.catalog?.entries.map((e) => e.path)).toEqual(["evening.json"]);
    expect(sidebarEntries(state).map((e) => e.id)).toEqual(["evening"]);
    expect(state.selectedPath).toBe("evening.json");
    expect(state.drafts["morning.json"]).toBeUndefined();
    expect(state.drafts["evening.json"]?.dirty).toBe(false);
  });

  it("keeps typing that lands while a save awaits the disk", async () => {
    const files: Record<string, Prayer> = { "a.json": prayerAt("a", "A") };
    const api = fakeApi({
      readText: async (_root, path) => JSON.stringify(files[path]),
    });
    let state = stateWithCatalog(catalogOf(files));
    const entry = state.catalog!.entries.find((e) => e.path === "a.json")!;
    state = (await openPrayer(state, api, entry)).state;
    const first = structuredClone(state.drafts["a.json"]!.prayer);
    first.variants[0]!.title = "Saved title";
    state = editDraft(state, first).state;

    const start = state;
    const result = await saveSelected(start, api);
    const typed = structuredClone(first);
    typed.variants[0]!.title = "Typed meanwhile";
    const current = editDraft(start, typed).state;
    state = mergeOpResult(current, start, result);

    const draft = state.drafts["a.json"]!;
    expect(draft.prayer.variants[0]!.title).toBe("Typed meanwhile");
    expect(draft.dirty).toBe(true);
    expect(draft.saved?.variants[0]!.title).toBe("Saved title");
    expect(
      state.catalog?.entries.find((e) => e.path === "a.json")?.title,
    ).toBe("Saved title");
  });

  it("moves an edit made during a rename-on-save to the new path", async () => {
    const files: Record<string, Prayer> = {
      "morning.json": prayerAt("morning", "Morgen"),
    };
    const api = fakeApi({
      readText: async (_root, path) => JSON.stringify(files[path]),
    });
    let state = stateWithCatalog(catalogOf(files));
    const entry = state.catalog!.entries.find((e) => e.path === "morning.json")!;
    state = (await openPrayer(state, api, entry)).state;
    const renamed = structuredClone(state.drafts["morning.json"]!.prayer);
    renamed.id = "evening";
    state = editDraft(state, renamed).state;

    const start = state;
    const result = await saveSelected(start, api);
    const typed = structuredClone(renamed);
    typed.variants[0]!.title = "Abend";
    const current = editDraft(start, typed).state;
    state = mergeOpResult(current, start, result);

    expect(state.selectedPath).toBe("evening.json");
    expect(state.drafts["morning.json"]).toBeUndefined();
    expect(state.drafts["evening.json"]?.prayer.variants[0]!.title).toBe("Abend");
    expect(state.drafts["evening.json"]?.dirty).toBe(true);
    expect(state.catalog?.entries.map((e) => e.path)).toEqual(["evening.json"]);
  });

  it("keeps library styles written while a save was running", async () => {
    const files: Record<string, Prayer> = { "a.json": prayerAt("a", "A") };
    const api = fakeApi({
      readText: async (_root, path) => JSON.stringify(files[path]),
    });
    let state = stateWithCatalog(catalogOf(files));
    const entry = state.catalog!.entries.find((e) => e.path === "a.json")!;
    state = (await openPrayer(state, api, entry)).state;
    const edited = structuredClone(state.drafts["a.json"]!.prayer);
    edited.variants[0]!.title = "A2";
    state = editDraft(state, edited).state;

    const start = state;
    const result = await saveSelected(start, api);
    const libraryStyles = { verse: { color: "#112233" } };
    const current = {
      ...start,
      catalog: { ...start.catalog!, libraryStyles },
    };
    state = mergeOpResult(current, start, result);

    expect(state.catalog?.libraryStyles).toBe(libraryStyles);
    expect(state.drafts["a.json"]?.dirty).toBe(false);
  });

  it("removes a deleted prayer's draft even if it was edited meanwhile", async () => {
    const files: Record<string, Prayer> = { "a.json": prayerAt("a", "A") };
    const api = fakeApi({
      readText: async (_root, path) => JSON.stringify(files[path]),
    });
    let state = stateWithCatalog(catalogOf(files));
    const entry = state.catalog!.entries.find((e) => e.path === "a.json")!;
    state = (await openPrayer(state, api, entry)).state;

    const start = state;
    const result = await deletePrayer(start, api, entry);
    const typed = structuredClone(start.drafts["a.json"]!.prayer);
    typed.variants[0]!.title = "Typed";
    const current = editDraft(start, typed).state;
    state = mergeOpResult(current, start, result);

    expect(state.drafts["a.json"]).toBeUndefined();
    expect(state.selectedPath).toBeNull();
    expect(state.catalog?.entries).toEqual([]);
  });

  it("drops an op result when the library changed while it ran", async () => {
    const files: Record<string, Prayer> = { "a.json": prayerAt("a", "A") };
    const api = fakeApi({
      readText: async (_root, path) => JSON.stringify(files[path]),
    });
    let state = stateWithCatalog(catalogOf(files));
    const entry = state.catalog!.entries.find((e) => e.path === "a.json")!;
    state = (await openPrayer(state, api, entry)).state;
    const edited = structuredClone(state.drafts["a.json"]!.prayer);
    edited.variants[0]!.title = "A2";
    state = editDraft(state, edited).state;

    const start = state;
    const result = await saveSelected(start, api);
    const other = stateWithCatalog({ ...catalogOf({}), root: "/other" });
    expect(mergeOpResult(other, start, result)).toBe(other);
  });

  it("opens a stub with one-file read and does not wait for other files", async () => {
    const files: Record<string, Prayer> = {
      "a.json": prayerAt("a", "A"),
      "b.json": prayerAt("b", "B"),
    };
    const readText = vi.fn(async (_root: string, path: string) => {
      if (path === "b.json") throw new Error("must not read b.json");
      return JSON.stringify(files[path]);
    });
    const readTexts = vi.fn(async () => {
      throw new Error("readTexts should not run for a stub open");
    });
    const listJsonFiles = vi.fn(async () => {
      throw new Error("listJsonFiles should not run for a stub open");
    });
    const api = fakeApi({ readText, readTexts, listJsonFiles });
    const catalog = catalogOf({}, { stubs: ["a.json", "b.json"] });
    let state = stateWithCatalog(catalog);
    const stubA = catalog.entries.find((e) => e.path === "a.json")!;
    expect(stubA.scanned).toBe(false);

    state = (await openPrayer(state, api, stubA)).state;
    expect(state.selectedPath).toBe("a.json");
    expect(state.drafts["a.json"]?.prayer.id).toBe("a");
    expect(state.drafts["a.json"]?.dirty).toBe(false);
    expect(
      state.catalog?.entries.find((e) => e.path === "a.json")?.scanned,
    ).toBe(true);
    expect(
      state.catalog?.entries.find((e) => e.path === "b.json")?.scanned,
    ).toBe(false);
    expect(readText.mock.calls.map((c) => c[1])).toEqual(["a.json"]);
    expect(readTexts).not.toHaveBeenCalled();
    expect(listJsonFiles).not.toHaveBeenCalled();
  });

  it("requestLeave blocks when a draft is dirty", () => {
    const files: Record<string, Prayer> = { "a.json": prayerAt("a", "A") };
    let state = stateWithCatalog(catalogOf(files));
    state = {
      ...state,
      selectedPath: "a.json",
      drafts: {
        "a.json": {
          prayer: files["a.json"]!,
          errors: [],
          visibleVariants: [col],
          dirty: true,
        },
      },
    };
    const blocked = requestLeave(state, { type: "reload-library" });
    expect(blocked.state.pendingLeave).toEqual({ type: "reload-library" });

    state = {
      ...state,
      drafts: {
        "a.json": { ...state.drafts["a.json"]!, dirty: false },
      },
    };
    const free = requestLeave(state, { type: "reload-library" });
    expect(free.state.pendingLeave).toBeNull();
  });
});
