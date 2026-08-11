import { beforeEach, describe, expect, it } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  loadAppearancePrefs,
  saveAppearancePrefs,
} from "../src/appearancePrefs";

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

describe("appearancePrefs", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it("defaults to system", () => {
    expect(loadAppearancePrefs()).toEqual({ colorScheme: "system" });
  });

  it("persists light/dark/system", () => {
    saveAppearancePrefs({ colorScheme: "dark" });
    expect(loadAppearancePrefs().colorScheme).toBe("dark");
    saveAppearancePrefs({ colorScheme: "light" });
    expect(loadAppearancePrefs().colorScheme).toBe("light");
    saveAppearancePrefs({ colorScheme: "system" });
    expect(loadAppearancePrefs().colorScheme).toBe("system");
  });

  it("falls back when storage is corrupt", () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "{not-json");
    expect(loadAppearancePrefs()).toEqual({ colorScheme: "system" });
  });
});
