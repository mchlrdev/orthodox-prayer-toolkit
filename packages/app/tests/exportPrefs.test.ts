import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exportPrefsPatchFromForm,
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

  it("persists parallelGutterColumn false when the user turns the gutter off", () => {
    saveExportPrefs("/lib", "a.json", {
      parallel: {
        left: { lang: "de", variant: "standard" },
        right: { lang: "en", variant: "standard" },
        gutterColumn: false,
      },
    });

    expect(loadExportPrefs("/lib", "a.json")?.parallelGutterColumn).toBe(false);
  });

  it("round-trips parallelSpeakerGutterColumn false", () => {
    saveExportPrefs("/lib", "a.json", {
      parallel: {
        left: { lang: "de", variant: "standard" },
        right: { lang: "en", variant: "standard" },
        speakerGutterColumn: false,
      },
    });

    expect(loadExportPrefs("/lib", "a.json")?.parallelSpeakerGutterColumn).toBe(
      false,
    );
  });

  it("saves Word table column order without clobbering HTML fields", () => {
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
      layout: {
        layoutFormat: "docx",
        layoutPrefixStem: "opt",
      },
      parallel: {
        left: { lang: "de", variant: "standard" },
        right: { lang: "en", variant: "standard" },
        gutterColumn: true,
      },
    });

    expect(loadExportPrefs("/lib", "a.json")).toEqual({
      includeBlocksWithoutTranslation: false,
      tagMap: { verse: "p" },
      wrapperEnabled: false,
      wrapperTag: "article",
      wrapperAttributes: "",
      layoutFormat: "docx",
      layoutPrefixStem: "opt",
      parallelLeft: { lang: "de", variant: "standard" },
      parallelRight: { lang: "en", variant: "standard" },
      parallelGutterColumn: true,
    });
  });

  it("round-trips format and variant with the rest of the form", () => {
    saveExportPrefs("/lib", "a.json", {
      format: "docx-parallel",
      variant: { lang: "en", variant: "standard" },
    });

    expect(loadExportPrefs("/lib", "a.json")).toEqual({
      format: "docx-parallel",
      variant: { lang: "en", variant: "standard" },
    });
  });

  it("rejects stored prefs with an unknown format", () => {
    localStorage.setItem(
      "orthodox-prayer-toolkit.export-prefs",
      JSON.stringify({
        "/lib": {
          "a.json": { format: "pdf" },
        },
      }),
    );
    expect(loadExportPrefs("/lib", "a.json")).toBeNull();
  });

  it("keeps HTML prefs when a later Word-table snapshot is saved", () => {
    saveExportPrefs("/lib", "a.json", {
      format: "html",
      html: {
        tagMap: { verse: "p" },
        wrapperEnabled: true,
        wrapperTag: "section",
        wrapperAttributes: 'class="keep"',
      },
    });

    saveExportPrefs(
      "/lib",
      "a.json",
      exportPrefsPatchFromForm({
        format: "docx-parallel",
        variant: { lang: "de", variant: "standard" },
        includeBlocksWithoutTranslation: false,
        html: {
          tagMap: { verse: "p" },
          wrapperEnabled: true,
          wrapperTag: "section",
          wrapperAttributes: 'class="keep"',
        },
        layout: { layoutFormat: "docx", layoutPrefixStem: "opt" },
        parallelLeft: { lang: "de", variant: "standard" },
        parallelRight: { lang: "en", variant: "standard" },
        gutterColumn: false,
        speakerGutterColumn: false,
        speakers: {
          placement: "inline",
          parallelPlacement: "inline-left",
          form: "name",
          separator: ": ",
        },
      }),
    );

    expect(loadExportPrefs("/lib", "a.json")).toEqual({
      format: "docx-parallel",
      variant: { lang: "de", variant: "standard" },
      includeBlocksWithoutTranslation: false,
      tagMap: { verse: "p" },
      wrapperEnabled: true,
      wrapperTag: "section",
      wrapperAttributes: 'class="keep"',
      layoutFormat: "docx",
      layoutPrefixStem: "opt",
      parallelLeft: { lang: "de", variant: "standard" },
      parallelRight: { lang: "en", variant: "standard" },
      parallelGutterColumn: false,
      parallelSpeakerGutterColumn: false,
      speakerPlacement: "inline",
      speakerParallelPlacement: "inline-left",
      speakerForm: "name",
      speakerSeparator: ": ",
    });
  });

  it("does not drop HTML prefs when a Word-table close omits html from the patch", () => {
    saveExportPrefs("/lib", "a.json", {
      format: "html",
      html: {
        tagMap: { verse: "p" },
        wrapperEnabled: true,
        wrapperTag: "section",
        wrapperAttributes: 'class="keep"',
      },
    });

    saveExportPrefs("/lib", "a.json", {
      format: "docx-parallel",
      parallel: {
        left: { lang: "de", variant: "standard" },
        right: { lang: "en", variant: "standard" },
        gutterColumn: false,
      },
    });

    expect(loadExportPrefs("/lib", "a.json")).toEqual({
      format: "docx-parallel",
      tagMap: { verse: "p" },
      wrapperEnabled: true,
      wrapperTag: "section",
      wrapperAttributes: 'class="keep"',
      parallelLeft: { lang: "de", variant: "standard" },
      parallelRight: { lang: "en", variant: "standard" },
      parallelGutterColumn: false,
    });
  });
});
