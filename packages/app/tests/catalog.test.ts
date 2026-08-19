import { describe, expect, it, vi } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../electron/preload";
import {
  collectCatalog,
  entriesUsingKind,
  mergeCatalogs,
  patchCatalogPrayer,
  patchCatalogText,
  removeCatalogPath,
  scanCatalogFile,
  scanLibraryCatalog,
  type LibraryCatalog,
} from "../src/catalog";
import { loadLibrary } from "../src/library";

const BODY = "UNIQUE_PRAYER_BODY_MARKER";

function prayer(id: string, kind: string, title = `Title ${id}`): Prayer {
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
          { lang: "de", variant: "standard", text: `${BODY} ${id}` },
        ],
      },
    ],
    meta: {},
  };
}

function fakeToolkit(
  files: Record<string, string>,
  overrides: Partial<PrayerToolkitApi> = {},
): PrayerToolkitApi {
  const api: PrayerToolkitApi = {
    getStartupLibrary: async () => null,
    openLibraryFolder: async () => null,
    createLibraryFolder: async () => null,
    openLibraryPath: async (root) => root,
    listJsonFiles: async () => Object.keys(files),
    readText: async (_root, path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`Missing file: ${path}`);
      return text;
    },
    readTexts: async (root, paths) =>
      Promise.all(
        paths.map(async (path) => ({
          path,
          text: await api.readText(root, path),
        })),
      ),
    writeText: async (_root, path, content) => {
      files[path] = content;
    },
    deleteFile: async () => undefined,
    renameFile: async () => undefined,
    exists: async (_root, path) => path in files,
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

async function allYields(
  gen: AsyncIterable<LibraryCatalog>,
): Promise<LibraryCatalog[]> {
  const out: LibraryCatalog[] = [];
  for await (const catalog of gen) out.push(catalog);
  return out;
}

describe("scanLibraryCatalog", () => {
  it("yields one complete catalog for an empty library", async () => {
    const yields = await allYields(scanLibraryCatalog("/lib", fakeToolkit({})));
    expect(yields).toHaveLength(1);
    const catalog = yields[0]!;
    expect(catalog.scanComplete).toBe(true);
    expect(catalog.entries).toEqual([]);
    expect(catalog.kinds).toEqual([]);
    expect(catalog.variants).toEqual([]);
    expect(catalog.root).toBe("/lib");
  });

  it("yields stubs then a complete catalog for two valid prayers", async () => {
    const files = {
      "alpha.json": JSON.stringify(prayer("alpha", "verse")),
      "beta.json": JSON.stringify(prayer("beta", "rubric")),
    };
    const yields = await allYields(
      scanLibraryCatalog("/lib", fakeToolkit(files)),
    );
    expect(yields).toHaveLength(2);

    const stubs = yields[0]!;
    expect(stubs.scanComplete).toBe(false);
    expect(stubs.entries.map((e) => e.path)).toEqual([
      "alpha.json",
      "beta.json",
    ]);
    expect(stubs.entries.every((e) => e.scanned === false)).toBe(true);
    expect(stubs.entries.every((e) => e.title === null)).toBe(true);
    expect(stubs.kinds).toEqual([]);

    const complete = yields[1]!;
    expect(complete.scanComplete).toBe(true);
    expect(complete.entries.every((e) => e.scanned)).toBe(true);
    expect(complete.entries.map((e) => e.title)).toEqual([
      "Title alpha",
      "Title beta",
    ]);
    expect(complete.kinds).toEqual(["rubric", "verse"]);
    expect(complete.variants).toEqual([{ lang: "de", variant: "standard" }]);
    expect(complete).not.toHaveProperty("validPrayers");
    expect(JSON.stringify(complete)).not.toContain(BODY);
    for (const entry of complete.entries) {
      expect(entry).not.toHaveProperty("structure");
      expect(entry).not.toHaveProperty("prayer");
    }
  });

  it("fills scanned across multiple yields when chunkSize is 1", async () => {
    const files = {
      "a.json": JSON.stringify(prayer("a", "verse")),
      "b.json": JSON.stringify(prayer("b", "rubric")),
      "c.json": JSON.stringify(prayer("c", "heading")),
    };
    const yields = await allYields(
      scanLibraryCatalog("/lib", fakeToolkit(files), { chunkSize: 1 }),
    );
    expect(yields).toHaveLength(4);
    expect(yields[0]!.entries.filter((e) => e.scanned)).toHaveLength(0);
    expect(yields[1]!.entries.filter((e) => e.scanned)).toHaveLength(1);
    expect(yields[2]!.entries.filter((e) => e.scanned)).toHaveLength(2);
    expect(yields[3]!.entries.filter((e) => e.scanned)).toHaveLength(3);
    expect(yields[3]!.scanComplete).toBe(true);
    expect(yields[3]!.kinds).toEqual(["heading", "rubric", "verse"]);
  });

  it("marks invalid JSON as scanned and invalid", async () => {
    const catalog = await collectCatalog(
      scanLibraryCatalog("/lib", fakeToolkit({ "bad.json": "{not json" })),
    );
    expect(catalog.entries).toHaveLength(1);
    expect(catalog.entries[0]).toMatchObject({
      path: "bad.json",
      id: null,
      scanned: true,
      valid: false,
      kinds: [],
      variants: [],
    });
    expect(catalog.entries[0]!.errors[0]?.message).toMatch(/Invalid JSON/);
    expect(catalog.scanComplete).toBe(true);
  });

  it("reads prayer files with chunked readTexts, not N times readText", async () => {
    const files = {
      "manifest.json": JSON.stringify({ description: "demo" }),
      "a.json": JSON.stringify(prayer("a", "verse")),
      "b.json": JSON.stringify(prayer("b", "verse")),
      "c.json": JSON.stringify(prayer("c", "verse")),
    };
    const readText = vi.fn(async (_root: string, path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`Missing file: ${path}`);
      return text;
    });
    const readTexts = vi.fn(async (_root: string, paths: string[]) =>
      paths.map((path) => {
        const text = files[path];
        if (text === undefined) throw new Error(`Missing file: ${path}`);
        return { path, text };
      }),
    );
    const api = fakeToolkit(files, { readText, readTexts });
    await collectCatalog(scanLibraryCatalog("/lib", api, { chunkSize: 2 }));

    expect(readTexts.mock.calls.map((call) => call[1])).toEqual([
      ["a.json", "b.json"],
      ["c.json"],
    ]);
    expect(readText.mock.calls.map((call) => call[1])).toEqual([
      "manifest.json",
    ]);
  });
});

describe("loadLibrary", () => {
  it("collects the completed catalog", async () => {
    const opened = await loadLibrary(
      "/lib",
      fakeToolkit({ "a.json": JSON.stringify(prayer("a", "verse")) }),
    );
    expect(opened.scanComplete).toBe(true);
    expect(opened.entries[0]?.scanned).toBe(true);
    expect(opened.entries[0]?.title).toBe("Title a");
  });
});

describe("patchCatalogPrayer", () => {
  it("updates title and kinds without rescan", async () => {
    const files = { "a.json": JSON.stringify(prayer("a", "verse")) };
    const readTexts = vi.fn(async (_root: string, paths: string[]) =>
      paths.map((path) => ({ path, text: files[path]! })),
    );
    const api = fakeToolkit(files, { readTexts });
    const catalog = await collectCatalog(scanLibraryCatalog("/lib", api));
    readTexts.mockClear();

    const patched = patchCatalogPrayer(
      catalog,
      "a.json",
      prayer("a", "rubric", "Patched"),
    );
    expect(readTexts).not.toHaveBeenCalled();
    expect(patched.entries[0]?.title).toBe("Patched");
    expect(patched.entries[0]?.kinds).toEqual(["rubric"]);
    expect(patched.kinds).toEqual(["rubric"]);
    expect(JSON.stringify(patched)).not.toContain(BODY);
  });
});

describe("removeCatalogPath", () => {
  it("drops the entry and recomputes unions", async () => {
    const catalog = await collectCatalog(
      scanLibraryCatalog(
        "/lib",
        fakeToolkit({
          "a.json": JSON.stringify(prayer("a", "verse")),
          "b.json": JSON.stringify(prayer("b", "rubric")),
        }),
      ),
    );
    const next = removeCatalogPath(catalog, "a.json");
    expect(next.entries.map((e) => e.path)).toEqual(["b.json"]);
    expect(next.kinds).toEqual(["rubric"]);
    expect(next.kinds).not.toContain("verse");
  });
});

describe("entriesUsingKind", () => {
  it("uses catalog metadata, not disk", async () => {
    const files = {
      "a.json": JSON.stringify(prayer("a", "verse")),
      "b.json": JSON.stringify(prayer("b", "rubric")),
    };
    const catalog = await collectCatalog(
      scanLibraryCatalog("/lib", fakeToolkit(files)),
    );
    files["a.json"] = "deleted-from-disk";
    const using = entriesUsingKind(catalog, "verse");
    expect(using.map((e) => e.path)).toEqual(["a.json"]);
    expect(entriesUsingKind(catalog, "heading")).toEqual([]);
  });
});

describe("scanCatalogFile", () => {
  it("turns a stub into a scanned entry", async () => {
    const files = {
      "a.json": JSON.stringify(prayer("a", "verse")),
      "b.json": JSON.stringify(prayer("b", "rubric")),
    };
    const gen = scanLibraryCatalog("/lib", fakeToolkit(files));
    const first = await gen.next();
    const stubs = first.value!;
    expect(stubs.entries.find((e) => e.path === "a.json")?.scanned).toBe(false);

    const next = await scanCatalogFile(stubs, fakeToolkit(files), "a.json");
    const entry = next.entries.find((e) => e.path === "a.json");
    expect(entry?.scanned).toBe(true);
    expect(entry?.title).toBe("Title a");
    expect(entry?.kinds).toEqual(["verse"]);
    expect(next.entries.find((e) => e.path === "b.json")?.scanned).toBe(false);
    expect(next.scanComplete).toBe(false);
    expect(next.kinds).toEqual(["verse"]);

    await gen.return(undefined);
  });

  it("keeps scanComplete when scanning a leftover stub", async () => {
    const files: Record<string, string> = {
      "a.json": JSON.stringify(prayer("a", "verse")),
    };
    const complete = await collectCatalog(
      scanLibraryCatalog("/lib", fakeToolkit(files)),
    );
    files["extra.json"] = JSON.stringify(prayer("extra", "heading"));
    const withStub: LibraryCatalog = {
      ...complete,
      scanComplete: true,
      entries: [
        ...complete.entries,
        {
          path: "extra.json",
          id: "extra",
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
    const next = await scanCatalogFile(
      withStub,
      fakeToolkit(files),
      "extra.json",
    );
    expect(next.scanComplete).toBe(true);
    expect(next.entries.find((e) => e.path === "extra.json")?.scanned).toBe(
      true,
    );
    expect(next.kinds).toEqual(["heading", "verse"]);
  });
});

describe("patchCatalogText", () => {
  it("marks invalid JSON without storing the prayer body", () => {
    const catalog: LibraryCatalog = {
      root: "/lib",
      entries: [
        {
          path: "a.json",
          id: "a",
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
      collisions: [],
      kinds: [],
      variants: [],
      manifest: null,
      libraryStyles: {},
      styleErrors: [],
      scanComplete: false,
    };
    const next = patchCatalogText(catalog, "a.json", "{not json");
    expect(next.entries[0]?.scanned).toBe(true);
    expect(next.entries[0]?.valid).toBe(false);
    expect(JSON.stringify(next)).not.toContain("{not json");
  });
});

describe("mergeCatalogs", () => {
  it("keeps a scanned entry over a later stub from the scan", () => {
    const scanned = patchCatalogPrayer(
      {
        root: "/lib",
        entries: [],
        collisions: [],
        kinds: [],
        variants: [],
        manifest: null,
        libraryStyles: {},
        styleErrors: [],
        scanComplete: false,
      },
      "a.json",
      prayer("a", "verse", "Opened"),
    );
    const stubs: LibraryCatalog = {
      ...scanned,
      entries: [
        {
          path: "a.json",
          id: "a",
          title: null,
          description: null,
          valid: true,
          errors: [],
          filenameMismatch: false,
          kinds: [],
          variants: [],
          scanned: false,
        },
        {
          path: "b.json",
          id: "b",
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
    const merged = mergeCatalogs(stubs, scanned);
    expect(merged.entries.find((e) => e.path === "a.json")?.title).toBe(
      "Opened",
    );
    expect(merged.entries.find((e) => e.path === "a.json")?.scanned).toBe(true);
    expect(merged.entries.find((e) => e.path === "b.json")?.scanned).toBe(
      false,
    );
  });

  it("does not restore omitted paths from the base catalog", () => {
    const morning = patchCatalogPrayer(
      {
        root: "/lib",
        entries: [],
        collisions: [],
        kinds: [],
        variants: [],
        manifest: null,
        libraryStyles: {},
        styleErrors: [],
        scanComplete: true,
      },
      "morning.json",
      prayer("morning", "verse", "Morgen"),
    );
    const evening = patchCatalogPrayer(
      removeCatalogPath(morning, "morning.json"),
      "evening.json",
      prayer("evening", "verse", "Abend"),
    );
    const merged = mergeCatalogs(evening, morning, {
      omitPaths: ["morning.json"],
    });
    expect(merged.entries.map((e) => e.path)).toEqual(["evening.json"]);
  });
});
