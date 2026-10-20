import { beforeEach, describe, expect, it } from "vitest";
import {
  notesForRunning,
  shouldShowWhatsNew,
  unseenNotes,
} from "../src/releaseNotes";
import { viteAppVersion } from "../src/viteAppVersion";
import {
  loadLastSeenWhatsNew,
  saveLastSeenWhatsNew,
  WHATS_NEW_STORAGE_KEY,
} from "../src/whatsNewPrefs";

function installMemoryLocalStorage() {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

const HISTORY = [
  { version: "0.3.5", items: ["Kind templates"] },
  { version: "0.3.4", items: ["Word table Own column"] },
  { version: "0.3.1", items: ["Commit Block edits on idle"] },
];

describe("notesForRunning", () => {
  it("includes every entry ≤ running, newest first", () => {
    expect(notesForRunning(HISTORY, "0.3.5").map((e) => e.version)).toEqual([
      "0.3.5",
      "0.3.4",
      "0.3.1",
    ]);
  });

  it("excludes entries ahead of running", () => {
    expect(notesForRunning(HISTORY, "0.3.4").map((e) => e.version)).toEqual([
      "0.3.4",
      "0.3.1",
    ]);
  });

  it("skips empty items", () => {
    const notes = [
      { version: "0.3.5", items: ["Kind templates"] },
      { version: "0.3.4", items: [] },
      { version: "0.3.1", items: ["Commit Block edits on idle"] },
    ];
    expect(notesForRunning(notes, "0.3.5").map((e) => e.version)).toEqual([
      "0.3.5",
      "0.3.1",
    ]);
  });
});

describe("unseenNotes", () => {
  it("lastSeen 0.3.1, running 0.3.5 → 0.3.4 and 0.3.5, not 0.3.1", () => {
    expect(
      unseenNotes(HISTORY, "0.3.1", "0.3.5").map((e) => e.version),
    ).toEqual(["0.3.5", "0.3.4"]);
  });

  it("lastSeen 0.3.4, running 0.3.5 → 0.3.5 only", () => {
    expect(
      unseenNotes(HISTORY, "0.3.4", "0.3.5").map((e) => e.version),
    ).toEqual(["0.3.5"]);
  });

  it("lastSeen null → all of notesForRunning", () => {
    expect(unseenNotes(HISTORY, null, "0.3.4").map((e) => e.version)).toEqual([
      "0.3.4",
      "0.3.1",
    ]);
  });
});

describe("shouldShowWhatsNew", () => {
  it("lastSeen 0.3.4, running 0.3.4 → closed (0.3.5 is ahead of running)", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: "0.3.4",
        runningVersion: "0.3.4",
        notes: HISTORY,
      }),
    ).toBe(false);
  });

  it("lastSeen 0.3.4, running 0.3.5 → opens; notesForRunning still includes older rows", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: "0.3.4",
        runningVersion: "0.3.5",
        notes: HISTORY,
      }),
    ).toBe(true);
    expect(notesForRunning(HISTORY, "0.3.5").map((e) => e.version)).toEqual([
      "0.3.5",
      "0.3.4",
      "0.3.1",
    ]);
  });

  it("lastSeen null, running 0.3.4 → opens; 0.3.5 excluded", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: null,
        runningVersion: "0.3.4",
        notes: HISTORY,
      }),
    ).toBe(true);
    expect(notesForRunning(HISTORY, "0.3.4").map((e) => e.version)).toEqual([
      "0.3.4",
      "0.3.1",
    ]);
  });

  it("stays closed when items are empty", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: null,
        runningVersion: "0.4.0",
        notes: [{ version: "0.4.0", items: [] }],
      }),
    ).toBe(false);
  });

  it("stays closed when lastSeen equals running and nothing newer is ≤ running", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: "0.3.5",
        runningVersion: "0.3.5",
        notes: HISTORY,
      }),
    ).toBe(false);
  });

  it("stays closed when runningVersion is empty", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: null,
        runningVersion: "",
        notes: HISTORY,
      }),
    ).toBe(false);
  });
});

describe("viteAppVersion", () => {
  it("reads the Vite define without throwing", () => {
    expect(viteAppVersion()).toBe("0.0.0-test");
  });
});

describe("whatsNewPrefs", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it("returns null when nothing is stored", () => {
    expect(loadLastSeenWhatsNew()).toBeNull();
  });

  it("persists lastSeenWhatsNew", () => {
    saveLastSeenWhatsNew("0.4.0");
    expect(loadLastSeenWhatsNew()).toBe("0.4.0");
  });

  it("falls back when storage is corrupt", () => {
    localStorage.setItem(WHATS_NEW_STORAGE_KEY, "{not-json");
    expect(loadLastSeenWhatsNew()).toBeNull();
  });
});
