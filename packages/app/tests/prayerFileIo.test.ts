import { describe, expect, it, vi } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../electron/preload";
import { patchCatalogPrayer, type LibraryCatalog } from "../src/catalog";
import { emptySessionState } from "../src/session/operations";
import {
  exportPrayerFile,
  importPrayerFile,
  resolveImportedPrayerPath,
} from "../src/session/prayerFileIo";

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
    deleteFile: async () => undefined,
    renameFile: async () => undefined,
    exists: async () => false,
    readAppStyles: async () => null,
    writeAppStyles: async () => undefined,
    readLibraryStyles: async () => null,
    writeLibraryStyles: async () => undefined,
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
    ...overrides,
  };
  return api;
}

function catalogOf(files: Record<string, Prayer>): LibraryCatalog {
  let catalog: LibraryCatalog = {
    root: "/lib",
    entries: [],
    collisions: [],
    kinds: [],
    variants: [],
    manifest: null,
    libraryStyles: {},
    styleErrors: [],
    scanComplete: true,
  };
  for (const [path, prayer] of Object.entries(files)) {
    catalog = patchCatalogPrayer(catalog, path, prayer);
  }
  return catalog;
}

describe("resolveImportedPrayerPath", () => {
  it("names the file from the prayer id, not the source name", () => {
    const content = JSON.stringify(samplePrayer());
    expect(resolveImportedPrayerPath("copy.json", content)).toEqual({
      ok: true,
      path: "morning.json",
      id: "morning",
    });
  });

  it("keeps the source basename when JSON has no id", () => {
    expect(resolveImportedPrayerPath("draft.json", "{}\n")).toEqual({
      ok: true,
      path: "draft.json",
      id: null,
    });
  });

  it("rejects reserved library filenames", () => {
    const result = resolveImportedPrayerPath("manifest.json", "{}\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/manifest\.json/);
  });

  it("rejects ids that would leave the library root", () => {
    const result = resolveImportedPrayerPath(
      "evil.json",
      JSON.stringify({ id: "../secret" }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("exportPrayerFile", () => {
  it("saves the on-disk prayer JSON under {id}.json", async () => {
    const raw = `${JSON.stringify(samplePrayer(), null, 2)}\n`;
    const saveExport = vi.fn(async () => "/tmp/morning.json");
    const api = fakeApi({
      readText: async () => raw,
      saveExport,
    });
    const state = { ...emptySessionState(), catalog: catalogOf({
      "morning.json": samplePrayer(),
    }) };
    const entry = state.catalog!.entries[0]!;
    const result = await exportPrayerFile(state, api, entry);
    expect(result.exportedPath).toBe("/tmp/morning.json");
    expect(saveExport).toHaveBeenCalledWith("morning.json", raw);
    expect(result.notices[0]?.title).toBe("Exported");
  });

  it("exports the unsaved draft instead of disk when dirty", async () => {
    const saveExport = vi.fn(async () => "/tmp/morning.json");
    const readText = vi.fn(async () => {
      throw new Error("disk should not be read for a dirty draft");
    });
    const api = fakeApi({ readText, saveExport });
    const prayer = samplePrayer();
    prayer.variants[0]!.title = "Unsaved";
    const catalog = catalogOf({ "morning.json": samplePrayer() });
    const state = {
      ...emptySessionState(),
      catalog,
      selectedPath: "morning.json",
      drafts: {
        "morning.json": {
          prayer,
          errors: [],
          visibleVariants: [{ lang: "de", variant: "standard" }],
          dirty: true,
        },
      },
    };
    const result = await exportPrayerFile(
      state,
      api,
      catalog.entries[0]!,
    );
    expect(readText).not.toHaveBeenCalled();
    const [, content] = saveExport.mock.calls[0]!;
    expect(JSON.parse(content as string).variants[0].title).toBe("Unsaved");
    expect(result.exportedPath).toBe("/tmp/morning.json");
  });
});

describe("importPrayerFile", () => {
  it("copies the picked JSON into the library and selects it", async () => {
    const incoming = `${JSON.stringify(samplePrayer(), null, 2)}\n`;
    const writeText = vi.fn(async () => undefined);
    const api = fakeApi({
      pickPrayerJson: async () => ({ name: "copy.json", content: incoming }),
      writeText,
    });
    const state = {
      ...emptySessionState(),
      catalog: catalogOf({ "evening.json": { ...samplePrayer(), id: "evening" } }),
    };
    const result = await importPrayerFile(state, api);
    expect(writeText).toHaveBeenCalledWith("/lib", "morning.json", incoming);
    expect(result.state.selectedPath).toBe("morning.json");
    expect(result.state.catalog?.entries.map((e) => e.path).sort()).toEqual([
      "evening.json",
      "morning.json",
    ]);
    expect(result.notices[0]).toEqual({
      color: "dark",
      title: "Imported",
      message: "morning.json",
    });
  });

  it("does nothing when the picker is cancelled", async () => {
    const writeText = vi.fn(async () => undefined);
    const api = fakeApi({
      pickPrayerJson: async () => null,
      writeText,
    });
    const state = { ...emptySessionState(), catalog: catalogOf({}) };
    const result = await importPrayerFile(state, api);
    expect(writeText).not.toHaveBeenCalled();
    expect(result.notices).toEqual([]);
    expect(result.state).toBe(state);
  });

  it("refuses to overwrite an existing prayer file", async () => {
    const writeText = vi.fn(async () => undefined);
    const api = fakeApi({
      pickPrayerJson: async () => ({
        name: "morning.json",
        content: JSON.stringify(samplePrayer()),
      }),
      writeText,
    });
    const state = {
      ...emptySessionState(),
      catalog: catalogOf({ "morning.json": samplePrayer() }),
    };
    const result = await importPrayerFile(state, api);
    expect(writeText).not.toHaveBeenCalled();
    expect(result.notices[0]?.title).toBe("Id collision");
  });

  it("refuses an id that already exists under another filename", async () => {
    const writeText = vi.fn(async () => undefined);
    const api = fakeApi({
      pickPrayerJson: async () => ({
        name: "morning.json",
        content: JSON.stringify(samplePrayer()),
      }),
      writeText,
    });
    const catalog = catalogOf({ "old-morning.json": samplePrayer() });
    const state = { ...emptySessionState(), catalog };
    const result = await importPrayerFile(state, api);
    expect(writeText).not.toHaveBeenCalled();
    expect(result.notices[0]?.message).toMatch(/old-morning\.json/);
  });
});
