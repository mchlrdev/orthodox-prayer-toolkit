import type { ModelStatus, PrayerToolkitApi } from "../electron/preload";
import { newestNotesVersion, RELEASE_NOTES } from "./releaseNotes";
import { viteAppVersion } from "./viteAppVersion";

const PREFIX = "/__ptk";

const STAND_IN_MODEL: ModelStatus = {
  model: { name: "Stand-in model", version: "dev", size: 0 },
  state: "stand-in",
  received: 0,
};

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed: ${res.status}`);
  }
  return data;
}

/**
 * Browser-dev implementation of the toolkit API (Vite middleware → examples/).
 */
export function createBrowserToolkitApi(): PrayerToolkitApi {
  return {
    getStartupLibrary: async () => {
      const data = await getJson<{ root: string | null }>(`${PREFIX}/startup`);
      return data.root;
    },

    openLibraryFolder: async () => {
      // Folder picking needs Electron; browser preview stays on examples.
      return null;
    },

    createLibraryFolder: async () => {
      // Creating libraries needs Electron.
      return null;
    },

    openLibraryPath: async () => {
      throw new Error(
        "Browser preview is pinned to the examples library. Run pnpm dev:electron to open another folder.",
      );
    },

    listJsonFiles: async (libraryRoot) => {
      const data = await getJson<{ files: string[] }>(
        `${PREFIX}/list?root=${encodeURIComponent(libraryRoot)}`,
      );
      return data.files;
    },

    readText: async (libraryRoot, relativePath) => {
      const data = await getJson<{ content: string }>(
        `${PREFIX}/read?root=${encodeURIComponent(libraryRoot)}&path=${encodeURIComponent(relativePath)}`,
      );
      return data.content;
    },

    readTexts: async (libraryRoot, relativePaths) => {
      const data = await getJson<{ files: { path: string; text: string }[] }>(
        `${PREFIX}/readTexts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ root: libraryRoot, paths: relativePaths }),
        },
      );
      return data.files;
    },

    writeText: async (libraryRoot, relativePath, content) => {
      await getJson(`${PREFIX}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: libraryRoot, path: relativePath, content }),
      });
    },

    createText: async (libraryRoot, relativePath, content) => {
      const data = await getJson<{ created: boolean }>(`${PREFIX}/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: libraryRoot, path: relativePath, content }),
      });
      return data.created;
    },

    deleteFile: async (libraryRoot, relativePath) => {
      await getJson(`${PREFIX}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: libraryRoot, path: relativePath }),
      });
    },

    renameFile: async (libraryRoot, fromRelative, toRelative) => {
      await getJson(`${PREFIX}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root: libraryRoot,
          from: fromRelative,
          to: toRelative,
        }),
      });
    },

    exists: async (libraryRoot, relativePath) => {
      const data = await getJson<{ exists: boolean }>(
        `${PREFIX}/exists?root=${encodeURIComponent(libraryRoot)}&path=${encodeURIComponent(relativePath)}`,
      );
      return data.exists;
    },

    readLibraryStyles: async (libraryRoot) => {
      const data = await getJson<{ content: string | null }>(
        `${PREFIX}/styles/library?root=${encodeURIComponent(libraryRoot)}`,
      );
      return data.content;
    },

    writeLibraryStyles: async (libraryRoot, content) => {
      await getJson(`${PREFIX}/styles/library`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: libraryRoot, content }),
      });
    },

    readLibraryTemplates: async (libraryRoot) => {
      const data = await getJson<{ content: string | null }>(
        `${PREFIX}/templates/library?root=${encodeURIComponent(libraryRoot)}`,
      );
      return data.content;
    },

    writeLibraryTemplates: async (libraryRoot, content) => {
      await getJson(`${PREFIX}/templates/library`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: libraryRoot, content }),
      });
    },

    readLibraryMemory: async (libraryRoot) => {
      const data = await getJson<{ content: string | null }>(
        `${PREFIX}/memory/library?root=${encodeURIComponent(libraryRoot)}`,
      );
      return data.content;
    },

    writeLibraryMemory: async (libraryRoot, content) => {
      await getJson(`${PREFIX}/memory/library`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: libraryRoot, content }),
      });
    },

    fetchSource: async (address) => {
      const params = new URLSearchParams({ url: address });
      return getJson(`${PREFIX}/fetch?${params}`) as Promise<{
        url: string;
        contentType: string;
        text: string;
      }>;
    },

    // Agent access needs the desktop app (a local server in the main process).
    setAgentAccess: async () => null,
    getAgentAccess: async () => null,
    onAgentRequest: () => () => undefined,
    respondAgentRequest: () => undefined,

    // The Built-in model lives in the desktop app; browser dev uses a stand-in.
    getModelStatus: async () => STAND_IN_MODEL,
    downloadModel: async () => undefined,
    cancelModelDownload: async () => undefined,
    removeModel: async () => undefined,
    onModelStatus: () => () => undefined,
    // Browser dev decides with the stand-in model in the window (standInModel.ts).
    startDecision: async () => {
      throw new Error("The Built-in model needs the desktop app");
    },
    startGenerate: async () => {
      throw new Error("The Built-in model needs the desktop app");
    },
    cancelDecision: async () => undefined,
    onDecision: () => () => undefined,

    // Text recognition for scans needs the desktop app.
    getOcrLanguages: async () => [],
    downloadOcrLanguage: async () => {
      throw new Error("Text recognition needs the desktop app");
    },
    cancelOcrDownload: async () => undefined,
    removeOcrLanguage: async () => undefined,
    onOcrLanguages: () => () => undefined,
    recognizeImage: async () => {
      throw new Error("Text recognition needs the desktop app");
    },
    cancelRecognize: async () => undefined,
    onOcrProgress: () => () => undefined,

    pickPrayerJson: () =>
      new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          void file.text().then((content) => {
            resolve({ name: file.name, content });
          });
        });
        input.addEventListener("cancel", () => resolve(null));
        input.click();
      }),

    saveExport: async (defaultName, content) => {
      const lower = defaultName.toLowerCase();
      const mime = lower.endsWith(".html")
        ? "text/html;charset=utf-8"
        : lower.endsWith(".rtf")
          ? "application/rtf;charset=utf-8"
          : lower.endsWith(".docx")
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/json";
      const blob =
        typeof content === "string"
          ? new Blob([content], { type: mime })
          : new Blob([content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer], {
              type: mime,
            });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
      return defaultName;
    },

    showItem: async () => {
      // no-op in browser
    },

    basename: async (path) => {
      const parts = path.replace(/\\/g, "/").split("/");
      return parts[parts.length - 1] ?? path;
    },

    onCloseRequested: () => () => {},
    onFindRequested: () => () => {},
    onFindNextRequested: () => () => {},
    confirmClose: () => {},
    watchLibrary: async () => {},
    onLibraryChanged: () => () => {},
    onCommand: () => () => {},
    runEdit: async (action) => {
      if (action === "paste") {
        try {
          const text = await navigator.clipboard.readText();
          if (text) document.execCommand("insertText", false, text);
        } catch {
          // Browser blocked clipboard; shortcuts still paste.
        }
        return;
      }
      document.execCommand(action);
    },
    onInstallRequested: () => () => {},
    confirmInstall: () => {},
    setDirty: () => {},

    getAppInfo: async () => ({
      version: viteAppVersion() ?? newestNotesVersion(RELEASE_NOTES),
      packaged: false,
    }),
    checkForUpdates: async () => ({
      status: "dev" as const,
      version: viteAppVersion() ?? newestNotesVersion(RELEASE_NOTES),
    }),
    installUpdate: async () => ({ ok: false }),
    onUpdateStatus: () => () => {},
  };
}
