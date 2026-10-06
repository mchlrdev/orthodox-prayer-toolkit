import { describe, expect, it } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import { patchCatalogPrayer, type LibraryCatalog } from "../src/catalog";
import {
  editDraft,
  emptySessionState,
  putPrayerFromText,
  redoDraft,
  undoDraft,
} from "../src/session/operations";
import {
  applyDiskChange,
  keepLocalVersion,
  takeDiskVersion,
} from "../src/session/diskSync";
import { prayerFileText } from "../src/session/persistPrayer";
import { HISTORY_LIMIT, recordEdit } from "../src/session/history";
import type { PrayerSessionState } from "../src/session/types";

function prayerAt(id: string, text: string): Prayer {
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
    structure: [
      {
        id: "b1",
        kind: "verse",
        translations: [{ lang: "de", variant: "standard", text }],
      },
    ],
    meta: {},
  };
}

function withText(p: Prayer, text: string): Prayer {
  const next = structuredClone(p);
  next.structure[0]!.translations[0]!.text = text;
  return next;
}

function opened(path = "a.json", text = "one"): PrayerSessionState {
  const prayer = prayerAt(path.replace(/\.json$/, ""), text);
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
  catalog = patchCatalogPrayer(catalog, path, prayer);
  const state = { ...emptySessionState(), catalog };
  return putPrayerFromText(state, path, prayerFileText(prayer)).state;
}

const draftOf = (s: PrayerSessionState, path = "a.json") => s.drafts[path]!;

describe("undo history", () => {
  it("undoes and redoes whole-prayer edits; back at saved is clean", () => {
    let s = opened();
    const p0 = draftOf(s).prayer;
    s = editDraft(s, withText(p0, "two"), { now: 0 }).state;
    s = editDraft(s, withText(draftOf(s).prayer, "three"), { now: 5000 }).state;
    expect(draftOf(s).history?.past).toHaveLength(2);

    s = undoDraft(s);
    expect(draftOf(s).prayer.structure[0]!.translations[0]!.text).toBe("two");
    expect(draftOf(s).dirty).toBe(true);
    s = undoDraft(s);
    expect(draftOf(s).prayer).toBe(p0);
    expect(draftOf(s).dirty).toBe(false);
    expect(undoDraft(s)).toBe(s);

    s = redoDraft(s);
    expect(draftOf(s).prayer.structure[0]!.translations[0]!.text).toBe("two");
    expect(draftOf(s).dirty).toBe(true);
  });

  it("a new edit clears redo", () => {
    let s = opened();
    s = editDraft(s, withText(draftOf(s).prayer, "two"), { now: 0 }).state;
    s = undoDraft(s);
    s = editDraft(s, withText(draftOf(s).prayer, "x"), { now: 9000 }).state;
    expect(draftOf(s).history?.future).toHaveLength(0);
    expect(redoDraft(s)).toBe(s);
  });

  it("coalesces same-key edits inside the window", () => {
    let s = opened();
    const p0 = draftOf(s).prayer;
    s = editDraft(s, withText(p0, "t"), { coalesceKey: "k", now: 0 }).state;
    s = editDraft(s, withText(p0, "ti"), { coalesceKey: "k", now: 500 }).state;
    s = editDraft(s, withText(p0, "tit"), { coalesceKey: "k", now: 900 }).state;
    expect(draftOf(s).history?.past).toHaveLength(1);
    s = undoDraft(s);
    expect(draftOf(s).prayer).toBe(p0);
  });

  it("caps the history", () => {
    const p = prayerAt("a", "x");
    let h = recordEdit(undefined, p, { now: 0 });
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
      h = recordEdit(h, p, { now: i * 10_000 });
    }
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("disk changes", () => {
  it("ignores own writes", () => {
    const s = opened();
    const text = draftOf(s).diskText!;
    expect(applyDiskChange(s, "a.json", text).state).toBe(s);
  });

  it("reloads a clean open prayer", () => {
    const s = opened();
    const next = applyDiskChange(
      s,
      "a.json",
      prayerFileText(prayerAt("a", "external")),
    ).state;
    expect(draftOf(next).prayer.structure[0]!.translations[0]!.text).toBe(
      "external",
    );
    expect(draftOf(next).dirty).toBe(false);
  });

  it("flags a conflict instead of touching unsaved edits", () => {
    let s = opened();
    s = editDraft(s, withText(draftOf(s).prayer, "mine"), { now: 0 }).state;
    const changed = applyDiskChange(
      s,
      "a.json",
      prayerFileText(prayerAt("a", "theirs")),
    ).state;
    expect(draftOf(changed).diskConflict).toBe("changed");
    expect(draftOf(changed).prayer.structure[0]!.translations[0]!.text).toBe(
      "mine",
    );

    const deleted = applyDiskChange(s, "a.json", null).state;
    expect(draftOf(deleted).diskConflict).toBe("deleted");
    expect(keepLocalVersion(deleted, "a.json").drafts["a.json"]?.diskConflict)
      .toBeUndefined();
  });

  it("drops a clean prayer deleted on disk", () => {
    const s = opened();
    const result = applyDiskChange(s, "a.json", null);
    expect(result.state.drafts["a.json"]).toBeUndefined();
    expect(result.state.selectedPath).toBeNull();
    expect(result.state.catalog?.entries).toHaveLength(0);
    expect(result.notices[0]?.title).toBe("Deleted on disk");
  });

  it("adds new files to the catalog", () => {
    const s = opened();
    const next = applyDiskChange(
      s,
      "b.json",
      prayerFileText(prayerAt("b", "new")),
    ).state;
    expect(next.catalog?.entries.map((e) => e.path).sort()).toEqual([
      "a.json",
      "b.json",
    ]);
    expect(next.drafts["b.json"]).toBeUndefined();
  });

  it("taking the disk version discards local edits", () => {
    let s = opened();
    s = editDraft(s, withText(draftOf(s).prayer, "mine"), { now: 0 }).state;
    const text = prayerFileText(prayerAt("a", "theirs"));
    const next = takeDiskVersion(s, "a.json", text);
    expect(draftOf(next).dirty).toBe(false);
    expect(draftOf(next).diskText).toBe(text);
  });
});
