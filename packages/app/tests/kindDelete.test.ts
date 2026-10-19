import { describe, expect, it } from "vitest";
import {
  resolveStyles,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../electron/preload";
import { patchCatalogPrayer, type LibraryCatalog } from "../src/catalog";
import {
  applyKindDelete,
  discoverKinds,
  emptySessionState,
  requestKindDelete,
  type PrayerSessionState,
} from "../src/session";

function prayer(id: string, kinds: string[]): Prayer {
  return {
    id,
    type: "prayer",
    tone: null,
    variants: [
      { lang: "de", variant: "standard", title: id, license: "unknown", source: "t" },
    ],
    structure: kinds.map((kind, i) => ({ id: `b${i}`, kind, translations: [] })),
    meta: {},
  };
}

const RUBRIC: StyleMap = {
  rubric: { fontSize: "1rem", color: "accent", fontWeight: "400", fontStyle: "italic" },
};

function fakeApi(files: Record<string, Prayer>) {
  const store = { ...files };
  const writes = { app: [] as string[], library: [] as string[] };
  const api = {
    readText: async (_root: string, path: string) => JSON.stringify(store[path]),
    writeText: async (_root: string, path: string, content: string) => {
      store[path] = JSON.parse(content) as Prayer;
    },
    writeAppStyles: async (text: string) => {
      writes.app.push(text);
    },
    writeLibraryStyles: async (_root: string, text: string) => {
      writes.library.push(text);
    },
  } as unknown as PrayerToolkitApi;
  return { api, store, writes };
}

/** Library on disk + the open prayer as a session draft (as the app holds it). */
function sessionWith(
  files: Record<string, Prayer>,
  selectedPath: string,
): PrayerSessionState {
  let catalog: LibraryCatalog = {
    root: "/lib",
    entries: [],
    collisions: [],
    kinds: [],
    variants: [],
    manifest: null,
    libraryStyles: RUBRIC,
    styleErrors: [],
    scanComplete: true,
  };
  for (const [path, p] of Object.entries(files)) {
    catalog = patchCatalogPrayer(catalog, path, p);
  }
  const open = files[selectedPath]!;
  return {
    ...emptySessionState({ ...RUBRIC }),
    catalog,
    selectedPath,
    drafts: {
      [selectedPath]: {
        prayer: open,
        saved: open,
        errors: [],
        visibleVariants: [{ lang: "de", variant: "standard" }],
        dirty: false,
      },
    },
  };
}

/** The Kinds pane lists Object.keys(resolvedStyles) — same inputs as the app. */
function listedKinds(state: PrayerSessionState): string[] {
  return Object.keys(
    resolveStyles({
      discoveredKinds: discoverKinds(state.catalog, state.drafts),
      libraryOverrides: state.catalog?.libraryStyles,
    }),
  );
}

describe("removing a custom kind (Prayer settings → Kinds → Remove)", () => {
  it("drops it from the kind list when only the open prayer uses it", async () => {
    const files = { "a.json": prayer("a", ["verse", "rubric"]) };
    const { api, writes } = fakeApi(files);
    const state = sessionWith(files, "a.json");
    expect(listedKinds(state)).toContain("rubric");

    const result = await requestKindDelete(state, api, "rubric");
    const next = result.state;

    expect(next.pendingKindDelete).toBeNull();
    // Blocks reassigned in the draft as an undoable edit (file not written).
    expect(next.drafts["a.json"]!.prayer.structure.map((b) => b.kind)).toEqual([
      "verse",
      "verse",
    ]);
    expect(next.drafts["a.json"]!.dirty).toBe(true);
    expect(next.drafts["a.json"]!.history?.past.length).toBe(1);
    // Both style maps lose the key in the same state (no racing writes).
    expect(next.appStyles.rubric).toBeUndefined();
    expect(next.catalog!.libraryStyles.rubric).toBeUndefined();
    expect(JSON.parse(writes.library.at(-1)!)).not.toHaveProperty("rubric");
    // The catalog entry on disk still lists it; the draft wins.
    expect(next.catalog!.kinds).toContain("rubric");
    expect(listedKinds(next)).not.toContain("rubric");
  });

  it("asks first when other prayers use it, then rewrites them", async () => {
    const files = {
      "a.json": prayer("a", ["rubric"]),
      "b.json": prayer("b", ["verse", "rubric"]),
      "c.json": prayer("c", ["verse"]),
    };
    const { api, store } = fakeApi(files);
    const state = sessionWith(files, "a.json");

    const asked = await requestKindDelete(state, api, "rubric");
    expect(asked.state.pendingKindDelete?.affectedPaths.sort()).toEqual([
      "a.json",
      "b.json",
    ]);
    // Nothing changed yet.
    expect(listedKinds(asked.state)).toContain("rubric");

    const done = await applyKindDelete(
      asked.state,
      api,
      asked.state.pendingKindDelete!,
    );
    expect(done.state.pendingKindDelete).toBeNull();
    expect(store["b.json"]!.structure.map((b) => b.kind)).toEqual([
      "verse",
      "verse",
    ]);
    expect(done.state.drafts["a.json"]!.prayer.structure[0]!.kind).toBe("verse");
    expect(done.state.appStyles.rubric).toBeUndefined();
    expect(listedKinds(done.state)).not.toContain("rubric");
  });

  it("never removes a preset kind", async () => {
    const files = { "a.json": prayer("a", ["heading"]) };
    const { api } = fakeApi(files);
    const state = sessionWith(files, "a.json");
    const result = await requestKindDelete(state, api, "heading");
    expect(result.state).toBe(state);
  });
});
