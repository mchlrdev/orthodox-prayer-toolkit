import { beforeEach, describe, expect, it } from "vitest";
import {
  APPEARANCE_STORAGE_KEY,
  clampEditorFontSize,
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

  it("defaults to system and 16px editor text", () => {
    expect(loadAppearancePrefs()).toEqual({
      colorScheme: "system",
      editorFontSize: 16,
    });
  });

  it("persists light/dark/system and editor font size", () => {
    saveAppearancePrefs({ colorScheme: "dark", editorFontSize: 20 });
    expect(loadAppearancePrefs()).toEqual({
      colorScheme: "dark",
      editorFontSize: 20,
    });
    saveAppearancePrefs({ colorScheme: "light", editorFontSize: 16 });
    expect(loadAppearancePrefs().colorScheme).toBe("light");
    saveAppearancePrefs({ colorScheme: "system", editorFontSize: 16 });
    expect(loadAppearancePrefs().colorScheme).toBe("system");
  });

  it("keeps editor font size at 16 when an older prefs blob omits it", () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ colorScheme: "dark" }),
    );
    expect(loadAppearancePrefs()).toEqual({
      colorScheme: "dark",
      editorFontSize: 16,
    });
  });

  it("falls back when storage is corrupt", () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "{not-json");
    expect(loadAppearancePrefs()).toEqual({
      colorScheme: "system",
      editorFontSize: 16,
    });
  });

  it("clamps editor font size to 12–28px", () => {
    expect(clampEditorFontSize(10.4)).toBe(12);
    expect(clampEditorFontSize(16.4)).toBe(16);
    expect(clampEditorFontSize(99)).toBe(28);
    expect(clampEditorFontSize("nope")).toBe(16);
  });
});
