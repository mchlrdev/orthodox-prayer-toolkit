import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadExportPrefs,
  saveExportPrefs,
} from "../src/exportPrefs";

function installMemoryLocalStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
  };
  vi.stubGlobal("localStorage", storage);
}

describe("exportPrefs", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  it("returns null when nothing is stored", () => {
    expect(loadExportPrefs("/lib", "a.json")).toBeNull();
  });

  it("round-trips HTML prefs bound to library root and prayer path", () => {
    saveExportPrefs("/lib", "morning.json", {
      includeBlocksWithoutTranslation: false,
      html: {
        tagMap: { verse: "p", heading: "h2" },
        wrapperEnabled: true,
        wrapperTag: "section",
        wrapperAttributes: 'class="x"',
      },
    });

    expect(loadExportPrefs("/lib", "morning.json")).toEqual({
      includeBlocksWithoutTranslation: false,
      tagMap: { verse: "p", heading: "h2" },
      wrapperEnabled: true,
      wrapperTag: "section",
      wrapperAttributes: 'class="x"',
    });
    expect(loadExportPrefs("/other", "morning.json")).toBeNull();
    expect(loadExportPrefs("/lib", "other.json")).toBeNull();
  });

  it("rejects stored prefs with disallowed tags", () => {
    localStorage.setItem(
      "orthodox-prayer-toolkit.export-prefs",
      JSON.stringify({
        "/lib": {
          "a.json": {
            tagMap: { verse: "script" },
            wrapperEnabled: false,
            wrapperTag: "article",
            wrapperAttributes: "",
          },
        },
      }),
    );
    expect(loadExportPrefs("/lib", "a.json")).toBeNull();
  });

  it("loads legacy HTML-only prefs without include-empty", () => {
    localStorage.setItem(
      "orthodox-prayer-toolkit.export-prefs",
      JSON.stringify({
        "/lib": {
          "a.json": {
            tagMap: { verse: "p" },
            wrapperEnabled: false,
            wrapperTag: "article",
            wrapperAttributes: "",
          },
        },
      }),
    );
    expect(loadExportPrefs("/lib", "a.json")).toEqual({
      tagMap: { verse: "p" },
      wrapperEnabled: false,
      wrapperTag: "article",
      wrapperAttributes: "",
    });
  });

  it("saves include-empty on flat export without clobbering HTML fields", () => {
    saveExportPrefs("/lib", "a.json", {
      includeBlocksWithoutTranslation: false,
      html: {
        tagMap: { verse: "p" },
        wrapperEnabled: true,
        wrapperTag: "section",
        wrapperAttributes: 'class="keep"',
      },
    });

    saveExportPrefs("/lib", "a.json", {
      includeBlocksWithoutTranslation: true,
    });

    expect(loadExportPrefs("/lib", "a.json")).toEqual({
      includeBlocksWithoutTranslation: true,
      tagMap: { verse: "p" },
      wrapperEnabled: true,
      wrapperTag: "section",
      wrapperAttributes: 'class="keep"',
    });
  });

  it("saves layout fields without clobbering HTML fields", () => {
    saveExportPrefs("/lib", "a.json", {
      includeBlocksWithoutTranslation: false,
      html: {
        tagMap: { verse: "p" },
        wrapperEnabled: false,
        wrapperTag: "article",
        wrapperAttributes: "",
      },
    });

    saveExportPrefs("/lib", "a.json", {
      includeBlocksWithoutTranslation: true,
      layout: {
        layoutFormat: "rtf",
        layoutPrefixStem: "lit",
      },
    });

    expect(loadExportPrefs("/lib", "a.json")).toEqual({
      includeBlocksWithoutTranslation: true,
      tagMap: { verse: "p" },
      wrapperEnabled: false,
      wrapperTag: "article",
      wrapperAttributes: "",
      layoutFormat: "rtf",
      layoutPrefixStem: "lit",
    });
  });
});
