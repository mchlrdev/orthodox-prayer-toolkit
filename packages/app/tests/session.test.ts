import { describe, expect, it, vi } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import { applyDraftEdit, validationErrorsFor } from "../src/session/draftEdit";
import { persistPrayer } from "../src/session/persistPrayer";
import { parseAppStyles } from "../src/session/parseAppStyles";
import type { PrayerToolkitApi } from "../electron/preload";

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
  ],
  structure: [
    {
      id: "b1",
      kind: "verse",
      translations: [
        { lang: "de", variant: "standard", text: "Herr, erbarme dich." },
      ],
    },
  ],
    meta: {},
});

function fakeApi(
  overrides: Partial<PrayerToolkitApi> = {},
): PrayerToolkitApi {
  return {
    getStartupLibrary: async () => null,
    openLibraryFolder: async () => null,
    createLibraryFolder: async () => null,
    openLibraryPath: async (root) => root,
    listJsonFiles: async () => [],
    readText: async () => "",
    writeText: async () => undefined,
    deleteFile: async () => undefined,
    renameFile: async () => undefined,
    exists: async () => false,
    readAppStyles: async () => null,
    writeAppStyles: async () => undefined,
    readLibraryStyles: async () => null,
    writeLibraryStyles: async () => undefined,
    saveExport: async () => null,
    showItem: async () => undefined,
    basename: async (p) => p.split("/").pop() ?? p,
    onCloseRequested: () => () => undefined,
    confirmClose: () => undefined,
    setDirty: () => undefined,
    ...overrides,
  };
}

describe("applyDraftEdit", () => {
  it("keeps valid prayers with reconciled columns", () => {
    const prayer = samplePrayer();
    const session = applyDraftEdit(prayer, [
      { lang: "de", variant: "standard" },
    ]);
    expect(session.errors).toEqual([]);
    expect(session.visibleVariants).toEqual([
      { lang: "de", variant: "standard" },
    ]);
    expect(session.prayer.id).toBe("morning");
  });

  it("preserves previous errors until validate runs", () => {
    const prayer = samplePrayer();
    prayer.id = "";
    const session = applyDraftEdit(
      prayer,
      [{ lang: "de", variant: "standard" }],
      [{ path: "/id", message: "stale" }],
    );
    expect(session.errors).toEqual([{ path: "/id", message: "stale" }]);
  });
});

describe("validationErrorsFor", () => {
  it("returns errors for invalid prayers", () => {
    const prayer = samplePrayer();
    prayer.id = "";
    expect(validationErrorsFor(prayer).length).toBeGreaterThan(0);
  });
});
describe("persistPrayer", () => {
  it("writes in place when the id matches the filename", async () => {
    const writeText = vi.fn(async () => undefined);
    const api = fakeApi({ writeText });
    const result = await persistPrayer(
      api,
      "/lib",
      "morning.json",
      samplePrayer(),
    );
    expect(result).toEqual({ ok: true, path: "morning.json" });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[1]).toBe("morning.json");
  });

  it("renames when the id changes and the target is free", async () => {
    const writeText = vi.fn(async () => undefined);
    const deleteFile = vi.fn(async () => undefined);
    const api = fakeApi({
      writeText,
      deleteFile,
      exists: async () => false,
    });
    const prayer = samplePrayer();
    prayer.id = "evening";
    const result = await persistPrayer(api, "/lib", "morning.json", prayer);
    expect(result).toEqual({ ok: true, path: "evening.json" });
    expect(writeText.mock.calls[0]?.[1]).toBe("evening.json");
    expect(deleteFile).toHaveBeenCalledWith("/lib", "morning.json");
  });

  it("blocks rename when the target already exists", async () => {
    const api = fakeApi({ exists: async () => true });
    const prayer = samplePrayer();
    prayer.id = "evening";
    const result = await persistPrayer(api, "/lib", "morning.json", prayer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/collision/i);
    }
  });
});

describe("parseAppStyles", () => {
  it("falls back to defaults on bad JSON", () => {
    const styles = parseAppStyles("{not json");
    expect(styles.verse).toBeDefined();
  });
});
