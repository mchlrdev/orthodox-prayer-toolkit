import { inflateRawSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import { loadExportPrefs, saveExportPrefs } from "../src/exportPrefs";
import {
  exportPrayerVariant,
  presetFromSeparator,
  prayerHasSpeakers,
  separatorFromPreset,
} from "../src/session/exportPrayerVariant";
import type { PrayerToolkitApi } from "../electron/preload";

function installMemoryLocalStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

const prayer = (speaker?: string): Prayer => ({
  id: "dlg",
  type: "prayer",
  tone: null,
  variants: [
    {
      lang: "de",
      variant: "standard",
      title: "Dialog",
      license: "unknown",
      source: "t",
      ...(speaker
        ? { speakers: [{ id: speaker, name: "Priester", short: "P" }] }
        : {}),
    },
  ],
  structure: [
    {
      id: "b1",
      kind: "verse",
      ...(speaker ? { speaker } : {}),
      translations: [{ lang: "de", variant: "standard", text: "Christus ist auferstanden!" }],
    },
  ],
  meta: {},
} as unknown as Prayer);

function api(saveExport: PrayerToolkitApi["saveExport"]): PrayerToolkitApi {
  return { saveExport } as unknown as PrayerToolkitApi;
}

function unzipTexts(buf: Uint8Array): Record<string, string> {
  const files: Record<string, string> = {};
  const view = Buffer.from(buf);
  let offset = 0;
  while (offset + 30 <= view.length) {
    if (view.readUInt32LE(offset) !== 0x04034b50) break;
    const method = view.readUInt16LE(offset + 8);
    const compSize = view.readUInt32LE(offset + 18);
    const nameLen = view.readUInt16LE(offset + 26);
    const extraLen = view.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = view.subarray(nameStart, nameStart + nameLen).toString("utf8");
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = view.subarray(dataStart, dataStart + compSize);
    files[name] = (
      method === 0 ? compressed : inflateRawSync(compressed)
    ).toString("utf8");
    offset = dataStart + compSize;
  }
  return files;
}

function dialogPrayer(): Prayer {
  const de = { lang: "de", variant: "standard" };
  const en = { lang: "en", variant: "standard" };
  return {
    formatVersion: 2,
    id: "dlg",
    type: "prayer",
    variants: [
      {
        ...de,
        title: "Dialog",
        license: "CC0",
        source: "test",
        speakers: { priest: { name: "Priester" } },
      },
      {
        ...en,
        title: "Dialog",
        license: "CC0",
        source: "test",
        speakers: { priest: { name: "Priest" } },
      },
    ],
    structure: [
      {
        id: "h",
        kind: "heading",
        translations: [
          { ...de, text: "Gruss" },
          { ...en, text: "Greeting" },
        ],
      },
      {
        id: "b1",
        kind: "verse",
        speaker: "priest",
        translations: [
          { ...de, text: "Friede" },
          { ...en, text: "Peace" },
        ],
      },
    ],
  };
}

describe("speaker export prefs", () => {
  let map: Map<string, string>;
  beforeEach(() => {
    map = installMemoryLocalStorage();
  });

  it("round-trips speaker prefs per format family", () => {
    saveExportPrefs("/lib", "a.json", {
      speakers: { placement: "column", form: "short", separator: ". " },
    });
    saveExportPrefs("/lib", "a.json", {
      speakers: {
        parallelPlacement: "inline-both",
        form: "name",
        separator: " – ",
      },
    });
    expect(loadExportPrefs("/lib", "a.json")).toEqual({
      speakerPlacement: "column",
      speakerParallelPlacement: "inline-both",
      speakerForm: "name",
      speakerSeparator: " – ",
    });
  });

  it("keeps old prefs readable with speaker fields missing", () => {
    map.set(
      "orthodox-prayer-toolkit.export-prefs",
      JSON.stringify({
        "/lib": { "a.json": { includeBlocksWithoutTranslation: true } },
      }),
    );
    const p = loadExportPrefs("/lib", "a.json");
    expect(p).toEqual({ includeBlocksWithoutTranslation: true });
    expect(p?.speakerPlacement).toBeUndefined();
  });

  it("drops prefs with invalid speaker values", () => {
    map.set(
      "orthodox-prayer-toolkit.export-prefs",
      JSON.stringify({
        "/lib": { "a.json": { speakerPlacement: "inline-left" } },
      }),
    );
    expect(loadExportPrefs("/lib", "a.json")).toBeNull();
  });
});

describe("speaker helpers", () => {
  it("detects speakers on blocks", () => {
    expect(prayerHasSpeakers(prayer())).toBe(false);
    expect(prayerHasSpeakers(prayer("priest"))).toBe(true);
  });

  it("maps separator presets", () => {
    expect(separatorFromPreset("colon")).toBe(": ");
    expect(separatorFromPreset("dot")).toBe(". ");
    expect(separatorFromPreset("none")).toBe("");
    expect(presetFromSeparator(": ")).toBe("colon");
    expect(presetFromSeparator("")).toBe("none");
    expect(presetFromSeparator(" – ")).toBe("custom");
  });
});

describe("exportPrayerVariant speakers", () => {
  const v = { lang: "de", variant: "standard" };

  it("passes speaker options to HTML export", async () => {
    const save = vi.fn(async () => "/x");
    await exportPrayerVariant(api(save), prayer("priest"), v, "html", {
      html: { tagMap: {}, wrapperEnabled: false, wrapperTag: "article", wrapperAttributes: "" },
      speakers: { placement: "inline", form: "short", separator: ". " },
    });
    const html = save.mock.calls[0]![1] as string;
    expect(html).toContain("P.");
    expect(html).not.toContain("Priester");
  });

  it("turns speakers off", async () => {
    const save = vi.fn(async () => "/x");
    await exportPrayerVariant(api(save), prayer("priest"), v, "html", {
      html: { tagMap: {}, wrapperEnabled: false, wrapperTag: "article", wrapperAttributes: "" },
      speakers: { placement: "off" },
    });
    expect(save.mock.calls[0]![1] as string).not.toContain("Priester");
  });

  it("Word table omitted speakers use Core own-column default with gutter", async () => {
    const save = vi.fn(async () => "/x");
    await exportPrayerVariant(api(save), dialogPrayer(), v, "docx-parallel", {
      parallel: {
        columns: [
          { lang: "de", variant: "standard" },
          { lang: "en", variant: "standard" },
        ],
        prefixStem: "opt",
      },
    });
    const doc =
      unzipTexts(save.mock.calls[0]![1] as Uint8Array)["word/document.xml"] ??
      "";
    expect(doc.match(/<w:gridCol /g)).toHaveLength(5);
    expect(doc).toContain('<w:gridCol w:w="1440"/>');
    expect(doc).toContain("Priester:");
  });

  it("omits speaker options when the prayer has no speakers", async () => {
    const withOpts = vi.fn(async () => "/x");
    const without = vi.fn(async () => "/x");
    const html = { tagMap: {}, wrapperEnabled: false, wrapperTag: "article", wrapperAttributes: "" };
    await exportPrayerVariant(api(withOpts), prayer(), v, "html", {
      html,
      speakers: { placement: "off", form: "short" },
    });
    await exportPrayerVariant(api(without), prayer(), v, "html", { html });
    expect(withOpts.mock.calls[0]![1]).toBe(without.mock.calls[0]![1]);
  });
});
