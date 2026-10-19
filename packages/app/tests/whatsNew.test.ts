import { beforeEach, describe, expect, it } from "vitest";
import { shouldShowWhatsNew } from "../src/releaseNotes";
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

const notes = {
  version: "0.4.0",
  items: ["Commit Block edits on idle"],
};

describe("shouldShowWhatsNew", () => {
  it("opens when lastSeen is empty and items exist", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: null,
        runningVersion: "0.4.0",
        notes,
      }),
    ).toBe(true);
  });

  it("stays closed when lastSeen already equals the running version", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: "0.4.0",
        runningVersion: "0.4.0",
        notes,
      }),
    ).toBe(false);
  });

  it("still opens when notes.version lags the running version (missed bump)", () => {
    // v0.3.3 shipped with notes.version "0.3.2".
    expect(
      shouldShowWhatsNew({
        lastSeen: "0.3.2",
        runningVersion: "0.3.3",
        notes: { version: "0.3.2", items: ["Word table Own column"] },
      }),
    ).toBe(true);
  });

  it("stays closed when items are empty", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: null,
        runningVersion: "0.4.0",
        notes: { version: "0.4.0", items: [] },
      }),
    ).toBe(false);
  });

  it("opens after an update when lastSeen is the previous version", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: "0.3.0",
        runningVersion: "0.4.0",
        notes,
      }),
    ).toBe(true);
  });

  it("stays closed when runningVersion is empty", () => {
    expect(
      shouldShowWhatsNew({
        lastSeen: null,
        runningVersion: "",
        notes,
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
