import { describe, expect, it } from "vitest";
import {
  renameKind,
  setTemplateKindSpeaker,
  moveTemplateKind,
  type KindTemplate,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import { collectCatalog, scanLibraryCatalog } from "../src/catalog";
import {
  applyCatalogChunk,
  applyKindRename,
  patchLibraryKindStyle,
  requestKindRename,
  beginCreatePrayer,
  createLibraryOpQueue,
  deleteKindTemplate,
  editDraft,
  emptySessionState,
  putPrayerFromText,
  setCreateTemplate,
  updateKindTemplate,
  type PrayerSessionState,
  type SessionNotice,
} from "../src/session";
import { memoryToolkit, STYLES_PATH, TEMPLATES_PATH } from "./memoryToolkit";

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function prayer(id: string): Prayer {
  return {
    id,
    type: "prayer",
    tone: null,
    variants: [{ lang: "de", variant: "standard", title: id, license: "unknown", source: "t" }],
    structure: [{ id: "b1", kind: "verse", translations: [] }],
  };
}

const hymns: KindTemplate = {
  id: "hymns",
  label: "Hymns",
  kinds: [{ id: "refrain" }, { id: "tone-label" }, { id: "stich" }],
};

async function setup() {
  const lib = memoryToolkit({
    "a.json": text(prayer("a")),
    [TEMPLATES_PATH]: text({ templates: [hymns] }),
  });
  // Hold every templates.json write until released, to interleave edits.
  const pending: (() => void)[] = [];
  const write = lib.api.writeLibraryTemplates;
  lib.api.writeLibraryTemplates = (root, content) =>
    new Promise<void>((resolve, reject) => {
      pending.push(() => {
        write(root, content).then(resolve, reject);
      });
    });
  const catalog = await collectCatalog(scanLibraryCatalog("/lib", lib.api));
  let state: PrayerSessionState = applyCatalogChunk(emptySessionState(), catalog, {
    replace: true,
  }).state;
  const notices: SessionNotice[] = [];
  const run = createLibraryOpQueue({
    get: () => state,
    set: (next) => {
      state = next;
    },
    emit: (n) => notices.push(...n),
  });
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
      pending.splice(0).forEach((release) => release());
    }
  };
  return {
    lib,
    run,
    flush,
    notices,
    get state() {
      return state;
    },
    set state(next: PrayerSessionState) {
      state = next;
    },
  };
}

const templatesOnDisk = (lib: ReturnType<typeof memoryToolkit>) =>
  (lib.json(TEMPLATES_PATH) as { templates: KindTemplate[] }).templates;

describe("library op queue", () => {
  it("applies quick successive template edits on the latest templates", async () => {
    const t = await setup();
    const label = t.run((s) => updateKindTemplate(s, t.lib.api, "hymns", { label: "Hymnen" }));
    const speaker = t.run((s) =>
      updateKindTemplate(s, t.lib.api, "hymns", (x) => setTemplateKindSpeaker(x, "refrain", true)),
    );
    const move1 = t.run((s) =>
      updateKindTemplate(s, t.lib.api, "hymns", (x) => moveTemplateKind(x, "stich", -1)),
    );
    const move2 = t.run((s) =>
      updateKindTemplate(s, t.lib.api, "hymns", (x) => moveTemplateKind(x, "stich", -1)),
    );
    await t.flush();
    await Promise.all([label, speaker, move1, move2]);

    const expected: KindTemplate = {
      id: "hymns",
      label: "Hymnen",
      kinds: [{ id: "stich" }, { id: "refrain", speaker: true }, { id: "tone-label" }],
    };
    expect(templatesOnDisk(t.lib)).toEqual([expected]);
    expect(t.state.catalog!.templates).toEqual([expected]);
  });

  it("keeps draft edits made while a template write is in flight", async () => {
    const t = await setup();
    t.state = putPrayerFromText(t.state, "a.json", t.lib.files["a.json"]!).state;
    const op = t.run((s) => updateKindTemplate(s, t.lib.api, "hymns", { label: "Hymnen" }));
    await new Promise((r) => setTimeout(r, 0));
    const draft = t.state.drafts["a.json"]!.prayer;
    t.state = editDraft(t.state, { ...draft, description: "typed meanwhile" }).state;
    await t.flush();
    await op;
    expect(t.state.drafts["a.json"]!.prayer.description).toBe("typed meanwhile");
    expect(t.state.drafts["a.json"]!.dirty).toBe(true);
    expect(t.state.catalog!.templates[0]!.label).toBe("Hymnen");
  });

  it("removes the stamped kinds when the chosen template is deleted", async () => {
    const t = await setup();
    t.state = (await beginCreatePrayer(t.state, t.lib.api)).state;
    t.state = setCreateTemplate(t.state, "hymns");
    expect(t.state.createDraft!.kinds).toHaveLength(3);
    const op = t.run((s) => deleteKindTemplate(s, t.lib.api, "hymns"));
    await t.flush();
    await op;
    expect(t.state.createTemplateId).toBeNull();
    expect(t.state.createDraft!.kinds).toBeUndefined();
  });

  it("keeps running after a failing op", async () => {
    const t = await setup();
    const failing = t.run(async () => {
      throw new Error("boom");
    });
    const next = t.run((s) => updateKindTemplate(s, t.lib.api, "hymns", { label: "After" }));
    await t.flush();
    await expect(failing).rejects.toThrow("boom");
    await next;
    expect(templatesOnDisk(t.lib)[0]!.label).toBe("After");
  });
});

/** Library whose writes all wait until `release()`, to interleave edits. */
async function heldLibrary(files: Record<string, string>) {
  const lib = memoryToolkit(files);
  const held: (() => void)[] = [];
  const hold =
    <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
    (...args: A) =>
      new Promise<void>((resolve, reject) => {
        held.push(() => {
          fn(...args).then(resolve, reject);
        });
      });
  lib.api.writeLibraryStyles = hold(lib.api.writeLibraryStyles);
  lib.api.writeText = hold(lib.api.writeText);
  const catalog = await collectCatalog(scanLibraryCatalog("/lib", lib.api));
  const box = {
    state: applyCatalogChunk(emptySessionState(), catalog, { replace: true }).state,
  };
  const run = createLibraryOpQueue({
    get: () => box.state,
    set: (next) => {
      box.state = next;
    },
    emit: () => undefined,
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const release = async () => {
    for (let i = 0; i < 30; i += 1) {
      await tick();
      held.splice(0).forEach((go) => go());
    }
  };
  return { lib, box, run, tick, release };
}

describe("queued style edits", () => {
  it("applies two fast patches of one kind against the latest style map", async () => {
    const t = await heldLibrary({ "a.json": text(prayer("a")) });
    const bold = t.run((s) => patchLibraryKindStyle(s, t.lib.api, "verse", { fontWeight: "700" }));
    const color = t.run((s) => patchLibraryKindStyle(s, t.lib.api, "verse", { color: "accent" }));
    await t.release();
    await Promise.all([bold, color]);
    const verse = (t.lib.json(STYLES_PATH) as Record<string, Record<string, string>>).verse!;
    expect(verse.fontWeight).toBe("700");
    expect(verse.color).toBe("accent");
    expect(t.box.state.catalog!.libraryStyles.verse).toMatchObject({
      fontWeight: "700",
      color: "accent",
    });
  });
});

describe("queued kind rename", () => {
  it("keeps a draft edit made during the rename and replays the rename on it", async () => {
    const withKind = (id: string): Prayer => ({
      ...prayer(id),
      formatVersion: 3,
      kinds: [{ id: "refrain" }],
      structure: [{ id: "b1", kind: "refrain", translations: [] }],
    });
    const t = await heldLibrary({
      "a.json": text(withKind("a")),
      "b.json": text(withKind("b")),
    });
    t.box.state = putPrayerFromText(t.box.state, "a.json", t.lib.files["a.json"]!).state;

    // Two prayers affected: the rename asks first.
    await t.run((s) => requestKindRename(s, t.lib.api, "refrain", "kehrvers"));
    expect(t.box.state.pendingKindRename?.to).toBe("kehrvers");

    const op = t.run(
      (s) => applyKindRename(s, t.lib.api, s.pendingKindRename!),
      { rebaseDraft: () => (p) => renameKind(p, "refrain", "kehrvers") },
    );
    await t.tick();
    const draft = t.box.state.drafts["a.json"]!.prayer;
    t.box.state = editDraft(t.box.state, { ...draft, description: "typed meanwhile" }).state;
    await t.release();
    await op;

    const merged = t.box.state.drafts["a.json"]!;
    expect(merged.prayer.description).toBe("typed meanwhile");
    expect(merged.prayer.kinds).toEqual([{ id: "kehrvers" }]);
    expect(merged.prayer.structure[0]!.kind).toBe("kehrvers");
    expect(merged.saved?.kinds).toEqual([{ id: "kehrvers" }]);
    expect(merged.diskText).toBe(t.lib.files["a.json"]);
    expect(merged.dirty).toBe(true);
    expect(t.box.state.pendingKindRename).toBeNull();
    expect((t.lib.json("b.json") as Prayer).kinds).toEqual([{ id: "kehrvers" }]);
  });
});
