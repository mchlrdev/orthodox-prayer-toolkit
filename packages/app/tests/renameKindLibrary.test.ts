import { describe, expect, it, vi } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../electron/preload";
import {
  patchCatalogPrayer,
  type LibraryCatalog,
} from "../src/catalog";
import {
  planKindRename,
  prayerUsesKind,
  renameKindAcrossLibrary,
} from "../src/session/renameKindLibrary";

const col = { lang: "de", variant: "standard" };

function prayer(id: string, kinds: string[]): Prayer {
  return {
    id,
    type: "prayer",
    tone: null,
    variants: [
      {
        lang: "de",
        variant: "standard",
        title: id,
        license: "unknown",
        source: "test",
      },
    ],
    structure: kinds.map((kind, i) => ({
      id: `b${i}`,
      kind,
      translations: [],
    })),
    meta: {},
  };
}

function catalogOf(
  files: Record<string, Prayer>,
  options?: { stubs?: Record<string, Prayer> },
): LibraryCatalog {
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
  for (const [path, p] of Object.entries(files)) {
    catalog = patchCatalogPrayer(catalog, path, p);
  }
  for (const path of Object.keys(options?.stubs ?? {})) {
    catalog = {
      ...catalog,
      scanComplete: false,
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
    };
  }
  return catalog;
}

function fakeApi(files: Record<string, Prayer>): PrayerToolkitApi {
  const store = { ...files };
  const api: PrayerToolkitApi = {
    getStartupLibrary: async () => null,
    openLibraryFolder: async () => null,
    createLibraryFolder: async () => null,
    openLibraryPath: async (root) => root,
    listJsonFiles: async () => Object.keys(store),
    readText: async (_root, path) => JSON.stringify(store[path]),
    readTexts: async (root, paths) =>
      Promise.all(
        paths.map(async (path) => ({
          path,
          text: await api.readText(root, path),
        })),
      ),
    writeText: async (_root, path, content) => {
      store[path] = JSON.parse(content) as Prayer;
    },
    deleteFile: async () => undefined,
    renameFile: async () => undefined,
    exists: async (_root, path) => path in store,
    readAppStyles: async () => null,
    writeAppStyles: async () => undefined,
    readLibraryStyles: async () => null,
    writeLibraryStyles: async () => undefined,
    saveExport: async () => null,
    showItem: async () => undefined,
    basename: async (p) => p.split("/").pop() ?? p,
    onCloseRequested: () => () => undefined,
    confirmClose: () => undefined,
    setDirty: () => undefined,
    getAppInfo: async () => ({ version: "0.0.0-test", packaged: false }),
    checkForUpdates: async () => ({ status: "dev", version: "0.0.0-test" }),
    installUpdate: async () => ({ ok: false }),
    onUpdateStatus: () => () => undefined,
  };
  return api;
}

describe("prayerUsesKind", () => {
  it("detects kind membership", () => {
    expect(prayerUsesKind(prayer("a", ["verse", "rubric"]), "rubric")).toBe(
      true,
    );
    expect(prayerUsesKind(prayer("a", ["verse"]), "rubric")).toBe(false);
  });
});

describe("planKindRename", () => {
  it("lists disk prayers that use the kind", async () => {
    const files = {
      "a.json": prayer("a", ["rubric"]),
      "b.json": prayer("b", ["strophe"]),
      "c.json": prayer("c", ["rubric", "heading"]),
    };
    const api = fakeApi(files);
    const plan = await planKindRename(
      api,
      catalogOf(files),
      "rubric",
      "instruction",
      { drafts: {} },
    );
    expect(plan.affectedPaths.sort()).toEqual(["a.json", "c.json"]);
  });

  it("uses catalog kinds and does not read unrelated files", async () => {
    const files = {
      "a.json": prayer("a", ["rubric"]),
      "b.json": prayer("b", ["strophe"]),
    };
    const api = fakeApi(files);
    const readSpy = vi.spyOn(api, "readText");
    const listSpy = vi.spyOn(api, "listJsonFiles");
    const plan = await planKindRename(
      api,
      catalogOf(files),
      "rubric",
      "instruction",
      { drafts: {} },
    );
    expect(plan.affectedPaths).toEqual(["a.json"]);
    expect(readSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("reads unscanned stubs only", async () => {
    const scanned = { "a.json": prayer("a", ["verse"]) };
    const stubs = { "c.json": prayer("c", ["rubric"]) };
    const api = fakeApi({ ...scanned, ...stubs });
    const readSpy = vi.spyOn(api, "readText");
    const plan = await planKindRename(
      api,
      catalogOf(scanned, { stubs }),
      "rubric",
      "instruction",
      { drafts: {} },
    );
    expect(plan.affectedPaths).toEqual(["c.json"]);
    expect(readSpy.mock.calls.map((c) => c[1])).toEqual(["c.json"]);
  });

  it("lets a dirty draft win over catalog kinds", async () => {
    const files = {
      "a.json": prayer("a", ["rubric"]),
      "b.json": prayer("b", ["rubric"]),
    };
    const dirtyB = prayer("b", ["verse"]);
    const api = fakeApi(files);
    const readSpy = vi.spyOn(api, "readText");
    const plan = await planKindRename(
      api,
      catalogOf(files),
      "rubric",
      "instruction",
      {
        drafts: {
          "b.json": {
            prayer: dirtyB,
            errors: [],
            visibleVariants: [col],
            dirty: true,
          },
        },
      },
    );
    expect(plan.affectedPaths).toEqual(["a.json"]);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("refuses built-in preset kinds", async () => {
    const files = { "a.json": prayer("a", ["verse"]) };
    const api = fakeApi(files);
    const plan = await planKindRename(api, catalogOf(files), "verse", "strophe", {
      drafts: {},
    });
    expect(plan.affectedPaths).toEqual([]);
  });
});

describe("renameKindAcrossLibrary", () => {
  it("rewrites all affected prayers and style keys", async () => {
    const store = {
      "a.json": prayer("a", ["rubric"]),
      "b.json": prayer("b", ["rubric"]),
    };
    const api = fakeApi(store);
    const writeSpy = vi.spyOn(api, "writeText");
    const catalog = catalogOf(store);

    const plan = await planKindRename(api, catalog, "rubric", "instruction", {
      drafts: {},
    });
    const result = await renameKindAcrossLibrary(api, catalog, plan, {
      drafts: {},
      appStyles: {
        rubric: {
          fontSize: "1rem",
          color: "base",
          fontWeight: "400",
          fontStyle: "normal",
        },
      },
      libraryStyles: {},
    });

    expect(result.writtenPaths.sort()).toEqual(["a.json", "b.json"]);
    expect(result.appStyles.instruction?.color).toBe("base");
    expect(result.appStyles.rubric).toBeUndefined();
    expect(writeSpy).toHaveBeenCalledTimes(2);

    const rewritten = JSON.parse(
      await api.readText("/lib", "a.json"),
    ) as Prayer;
    expect(rewritten.structure.every((b) => b.kind === "instruction")).toBe(
      true,
    );
  });

  it("updates an open draft and unsaved map", async () => {
    const open = prayer("open", ["rubric"]);
    const files = { "open.json": open };
    const api = fakeApi(files);
    const catalog = catalogOf(files);
    const drafts = {
      "open.json": {
        prayer: open,
        errors: [],
        visibleVariants: [col],
        dirty: true,
      },
    };
    const plan = await planKindRename(api, catalog, "rubric", "instruction", {
      drafts,
    });
    const result = await renameKindAcrossLibrary(api, catalog, plan, {
      drafts,
      appStyles: {},
      libraryStyles: {},
    });

    expect(result.drafts["open.json"]?.prayer.structure[0]?.kind).toBe(
      "instruction",
    );
    expect(result.drafts["open.json"]?.dirty).toBe(true);
  });

  it("does not rewrite built-in preset kinds", async () => {
    const store = {
      "a.json": prayer("a", ["verse"]),
    };
    const api = fakeApi(store);
    const writeSpy = vi.spyOn(api, "writeText");
    const appStyles = {
      verse: {
        fontSize: "1rem",
        color: "base" as const,
        fontWeight: "400" as const,
        fontStyle: "normal" as const,
      },
    };

    const result = await renameKindAcrossLibrary(
      api,
      catalogOf(store),
      { from: "verse", to: "strophe", affectedPaths: ["a.json"] },
      {
        drafts: {},
        appStyles,
        libraryStyles: {},
      },
    );

    expect(result.writtenPaths).toEqual([]);
    expect(result.appStyles).toBe(appStyles);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(
      (JSON.parse(await api.readText("/lib", "a.json")) as Prayer).structure[0]
        ?.kind,
    ).toBe("verse");
  });
});
