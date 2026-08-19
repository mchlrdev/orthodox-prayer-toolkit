import type { PrayerToolkitApi } from "../electron/preload";

const PREFIX = "/__ptk";

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

    readAppStyles: async () => {
      const data = await getJson<{ content: string | null }>(
        `${PREFIX}/styles/app`,
      );
      return data.content;
    },

    writeAppStyles: async (content) => {
      await getJson(`${PREFIX}/styles/app`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
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
    confirmClose: () => {},
    setDirty: () => {},

    getAppInfo: async () => ({
      version: __APP_VERSION__,
      packaged: false,
    }),
    checkForUpdates: async () => ({
      status: "dev" as const,
      version: __APP_VERSION__,
    }),
    installUpdate: async () => ({ ok: false }),
    onUpdateStatus: () => () => {},
  };
}
