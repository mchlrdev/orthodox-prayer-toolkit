import type { PrayerToolkitApi } from "../electron/preload";

export const STYLES_PATH = ".orthodox-prayer-toolkit/styles.json";
export const TEMPLATES_PATH = ".orthodox-prayer-toolkit/templates.json";

/**
 * In-memory library for session tests: prayer files plus `styles.json` /
 * `templates.json` under their real relative paths. `log` records every
 * write in order; `failWrites` makes writes to those paths throw.
 */
export function memoryToolkit(initial: Record<string, string>) {
  const files: Record<string, string> = { ...initial };
  const log: string[] = [];
  const failWrites = new Set<string>();

  const write = async (path: string, content: string) => {
    if (failWrites.has(path)) throw new Error(`disk full: ${path}`);
    log.push(path);
    files[path] = content;
  };
  const read = (path: string): string => {
    const text = files[path];
    if (text === undefined) throw new Error(`Missing file: ${path}`);
    return text;
  };

  const api: PrayerToolkitApi = {
    getStartupLibrary: async () => null,
    openLibraryFolder: async () => null,
    createLibraryFolder: async () => null,
    openLibraryPath: async (root) => root,
    listJsonFiles: async () => Object.keys(files),
    readText: async (_root, path) => read(path),
    readTexts: async (_root, paths) =>
      paths.map((path) => ({ path, text: read(path) })),
    writeText: async (_root, path, content) => write(path, content),
    deleteFile: async (_root, path) => {
      delete files[path];
    },
    renameFile: async () => undefined,
    exists: async (_root, path) => path in files,
    readLibraryStyles: async () => files[STYLES_PATH] ?? null,
    writeLibraryStyles: async (_root, content) => write(STYLES_PATH, content),
    readLibraryTemplates: async () => files[TEMPLATES_PATH] ?? null,
    writeLibraryTemplates: async (_root, content) =>
      write(TEMPLATES_PATH, content),
    saveExport: async () => null,
    pickPrayerJson: async () => null,
    showItem: async () => undefined,
    basename: async (p) => p.split("/").pop() ?? p,
    onFindRequested: () => () => undefined,
    onFindNextRequested: () => () => undefined,
    onCloseRequested: () => () => undefined,
    confirmClose: () => undefined,
    setDirty: () => undefined,
    watchLibrary: async () => undefined,
    onLibraryChanged: () => () => undefined,
    onCommand: () => () => undefined,
    runEdit: async () => undefined,
    onInstallRequested: () => () => undefined,
    confirmInstall: () => undefined,
    getAppInfo: async () => ({ version: "0.0.0-test", packaged: false }),
    checkForUpdates: async () => ({ status: "dev", version: "0.0.0-test" }),
    installUpdate: async () => ({ ok: false }),
    onUpdateStatus: () => () => undefined,
  };

  const json = (path: string): unknown => JSON.parse(read(path));
  return { api, files, log, failWrites, json };
}
