import { describe, expect, it, vi } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../electron/preload";
import { exportPrayerVariant } from "../src/session/exportPrayerVariant";

const samplePrayer = (): Prayer => ({
  id: "morning",
  type: "prayer",
  tone: null,
  variants: [
    {
      lang: "de",
      variant: "standard",
      title: "Morgen",
      license: "unknown",
      source: "test",
    },
    {
      lang: "cu",
      variant: "synodal-cyrl",
      title: "Оутро",
      license: "unknown",
      source: "test",
    },
  ],
  structure: [
    {
      id: "b1",
      kind: "verse",
      translations: [
        { lang: "de", variant: "standard", text: "Herr, erbarme dich." },
        { lang: "cu", variant: "synodal-cyrl", text: "Господи помилуй." },
      ],
    },
  ],
  meta: {},
});

function fakeApi(
  overrides: Partial<PrayerToolkitApi> = {},
): PrayerToolkitApi {
  const api: PrayerToolkitApi = {
    getStartupLibrary: async () => null,
    openLibraryFolder: async () => null,
    createLibraryFolder: async () => null,
    openLibraryPath: async (root) => root,
    listJsonFiles: async () => [],
    readText: async () => "",
    readTexts: async (root, paths) =>
      Promise.all(
        paths.map(async (path) => ({
          path,
          text: await api.readText(root, path),
        })),
      ),
    writeText: async () => undefined,
    deleteFile: async () => undefined,
    renameFile: async () => undefined,
    exists: async () => false,
    readAppStyles: async () => null,
    writeAppStyles: async () => undefined,
    readLibraryStyles: async () => null,
    writeLibraryStyles: async () => undefined,
    saveExport: async () => null,
    pickPrayerJson: async () => null,
    showItem: async () => undefined,
    basename: async (p) => p.split("/").pop() ?? p,
    onCloseRequested: () => () => undefined,
    confirmClose: () => undefined,
    setDirty: () => undefined,
    getAppInfo: async () => ({ version: "0.0.0-test", packaged: false }),
    checkForUpdates: async () => ({ status: "dev", version: "0.0.0-test" }),
    installUpdate: async () => ({ ok: false }),
    onUpdateStatus: () => () => undefined,
    ...overrides,
  };
  return api;
}

describe("exportPrayerVariant", () => {
  it("saves flat JSON for the chosen language and variant", async () => {
    const saveExport = vi.fn(async () => "/tmp/morning.cu.synodal-cyrl.flat.json");
    const api = fakeApi({ saveExport });

    const path = await exportPrayerVariant(api, samplePrayer(), {
      lang: "cu",
      variant: "synodal-cyrl",
    });

    expect(path).toBe("/tmp/morning.cu.synodal-cyrl.flat.json");
    expect(saveExport).toHaveBeenCalledOnce();
    const [name, content] = saveExport.mock.calls[0]!;
    expect(name).toBe("morning.cu.synodal-cyrl.flat.json");
    expect(JSON.parse(content as string)).toMatchObject({
      id: "morning",
      lang: "cu",
      variant: "synodal-cyrl",
      title: "Оутро",
      structure: [{ id: "b1", kind: "verse", text: "Господи помилуй." }],
    });
  });

  it("saves HTML for the chosen language and variant", async () => {
    const saveExport = vi.fn(async () => "/tmp/morning.de.standard.html");
    const api = fakeApi({ saveExport });

    const path = await exportPrayerVariant(
      api,
      samplePrayer(),
      { lang: "de", variant: "standard" },
      "html",
      {
        html: {
          tagMap: { verse: "p" },
          wrapperEnabled: false,
          wrapperTag: "article",
          wrapperAttributes: "",
        },
      },
    );

    expect(path).toBe("/tmp/morning.de.standard.html");
    expect(saveExport).toHaveBeenCalledOnce();
    const [name, content] = saveExport.mock.calls[0]!;
    expect(name).toBe("morning.de.standard.html");
    expect(content).toBe(
      '<p data-kind="verse">Herr, erbarme dich.</p>\n',
    );
  });

  it("saves wrapped HTML with parsed attributes", async () => {
    const saveExport = vi.fn(async () => "/tmp/morning.de.standard.html");
    const api = fakeApi({ saveExport });

    await exportPrayerVariant(
      api,
      samplePrayer(),
      { lang: "de", variant: "standard" },
      "html",
      {
        html: {
          tagMap: { verse: "p" },
          wrapperEnabled: true,
          wrapperTag: "article",
          wrapperAttributes: 'class="prayer"',
        },
      },
    );

    const content = saveExport.mock.calls[0]![1] as string;
    expect(content.startsWith("<article ")).toBe(true);
    expect(content).toContain('class="prayer"');
    expect(content).toContain('data-lang="de"');
    expect(content).toContain('<p data-kind="verse">Herr, erbarme dich.</p>');
  });

  it("passes includeBlocksWithoutTranslation into flat export", async () => {
    const saveExport = vi.fn(async () => "/tmp/out.flat.json");
    const api = fakeApi({ saveExport });
    const prayer = samplePrayer();
    prayer.structure.push({
      id: "b2",
      kind: "annotation",
      translations: [],
    });

    await exportPrayerVariant(
      api,
      prayer,
      { lang: "de", variant: "standard" },
      "flat-json",
      { includeBlocksWithoutTranslation: true },
    );

    const content = JSON.parse(saveExport.mock.calls[0]![1] as string) as {
      structure: Array<{ id: string; text?: string }>;
    };
    expect(content.structure.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(content.structure[1]).toEqual({
      id: "b2",
      kind: "annotation",
      text: "",
    });
  });

  it("saves Layout RTF with prefix stem", async () => {
    const saveExport = vi.fn(async () => "/tmp/morning.de.standard.rtf");
    const api = fakeApi({ saveExport });

    await exportPrayerVariant(
      api,
      samplePrayer(),
      { lang: "de", variant: "standard" },
      "layout",
      {
        layout: { layoutFormat: "rtf", prefixStem: "opt" },
      },
    );

    const [name, content] = saveExport.mock.calls[0]!;
    expect(name).toBe("morning.de.standard.rtf");
    expect(typeof content).toBe("string");
    expect(content as string).toContain("opt_verse");
    expect(content as string).toContain("Herr, erbarme dich.");
  });

  it("saves Layout DOCX as binary", async () => {
    const saveExport = vi.fn(async () => "/tmp/morning.de.standard.docx");
    const api = fakeApi({ saveExport });

    await exportPrayerVariant(
      api,
      samplePrayer(),
      { lang: "de", variant: "standard" },
      "layout",
      {
        layout: { layoutFormat: "docx", prefixStem: "" },
      },
    );

    const [name, content] = saveExport.mock.calls[0]!;
    expect(name).toBe("morning.de.standard.docx");
    expect(content).toBeInstanceOf(Uint8Array);
    // ZIP local file signature
    expect((content as Uint8Array)[0]).toBe(0x50);
    expect((content as Uint8Array)[1]).toBe(0x4b);
  });
});
