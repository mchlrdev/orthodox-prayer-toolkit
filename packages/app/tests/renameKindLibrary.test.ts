import { describe, expect, it, vi } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../electron/preload";
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

function fakeApi(files: Record<string, Prayer>): PrayerToolkitApi {
  const store = { ...files };
  return {
    getStartupLibrary: async () => null,
    openLibraryFolder: async () => null,
    createLibraryFolder: async () => null,
    openLibraryPath: async (root) => root,
    listJsonFiles: async () => Object.keys(store),
    readText: async (_root, path) => JSON.stringify(store[path]),
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
  };
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
    const api = fakeApi({
      "a.json": prayer("a", ["verse"]),
      "b.json": prayer("b", ["rubric"]),
      "c.json": prayer("c", ["verse", "heading"]),
    });
    const plan = await planKindRename(api, "/lib", "verse", "strophe", {
      unsaved: {},
      selectedPath: null,
      draft: null,
    });
    expect(plan.affectedPaths.sort()).toEqual(["a.json", "c.json"]);
  });
});

describe("renameKindAcrossLibrary", () => {
  it("rewrites all affected prayers and style keys", async () => {
    const store = {
      "a.json": prayer("a", ["verse"]),
      "b.json": prayer("b", ["verse"]),
    };
    const api = fakeApi(store);
    const writeSpy = vi.spyOn(api, "writeText");

    const plan = await planKindRename(api, "/lib", "verse", "strophe", {
      unsaved: {},
      selectedPath: null,
      draft: null,
    });
    const result = await renameKindAcrossLibrary(api, "/lib", plan, {
      unsaved: {},
      selectedPath: null,
      draft: null,
      appStyles: {
        verse: {
          fontSize: "1rem",
          color: "base",
          fontWeight: "400",
          fontStyle: "normal",
        },
      },
      libraryStyles: {},
    });

    expect(result.writtenPaths.sort()).toEqual(["a.json", "b.json"]);
    expect(result.appStyles.strophe?.color).toBe("base");
    expect(result.appStyles.verse).toBeUndefined();
    expect(writeSpy).toHaveBeenCalledTimes(2);

    const rewritten = JSON.parse(
      await api.readText("/lib", "a.json"),
    ) as Prayer;
    expect(rewritten.structure.every((b) => b.kind === "strophe")).toBe(true);
  });

  it("updates an open draft and unsaved map", async () => {
    const open = prayer("open", ["verse"]);
    const api = fakeApi({ "open.json": open });
    const plan = await planKindRename(api, "/lib", "verse", "strophe", {
      unsaved: {
        "open.json": {
          prayer: open,
          errors: [],
          visibleVariants: [col],
        },
      },
      selectedPath: "open.json",
      draft: open,
    });
    const result = await renameKindAcrossLibrary(api, "/lib", plan, {
      unsaved: {
        "open.json": {
          prayer: open,
          errors: [],
          visibleVariants: [col],
        },
      },
      selectedPath: "open.json",
      draft: open,
      appStyles: {},
      libraryStyles: {},
    });

    expect(result.draft?.structure[0]?.kind).toBe("strophe");
    expect(result.unsaved["open.json"]?.prayer.structure[0]?.kind).toBe(
      "strophe",
    );
  });
});
