import { contextBridge, ipcRenderer } from "electron";
import type {
  AppInfo,
  AppUpdateCheckResult,
} from "./updateCheck";

export type { AppInfo, AppUpdateCheckResult } from "./updateCheck";

export type CreateLibraryOptions = {
  name: string;
  /** Pretty-printed JSON body for manifest.json (including trailing newline). */
  manifestJson: string;
};

export type PrayerToolkitApi = {
  getStartupLibrary: () => Promise<string | null>;
  openLibraryFolder: () => Promise<string | null>;
  /** Create a new library folder with manifest.json; returns absolute root or null if cancelled. */
  createLibraryFolder: (opts: CreateLibraryOptions) => Promise<string | null>;
  /** Allow and open an existing absolute library path (e.g. from recents). */
  openLibraryPath: (libraryRoot: string) => Promise<string>;
  listJsonFiles: (libraryRoot: string) => Promise<string[]>;
  readText: (libraryRoot: string, relativePath: string) => Promise<string>;
  writeText: (
    libraryRoot: string,
    relativePath: string,
    content: string,
  ) => Promise<void>;
  deleteFile: (libraryRoot: string, relativePath: string) => Promise<void>;
  renameFile: (
    libraryRoot: string,
    fromRelative: string,
    toRelative: string,
  ) => Promise<void>;
  exists: (libraryRoot: string, relativePath: string) => Promise<boolean>;
  readAppStyles: () => Promise<string | null>;
  writeAppStyles: (content: string) => Promise<void>;
  readLibraryStyles: (libraryRoot: string) => Promise<string | null>;
  writeLibraryStyles: (libraryRoot: string, content: string) => Promise<void>;
  saveExport: (
    defaultName: string,
    content: string | Uint8Array,
  ) => Promise<string | null>;
  showItem: (fullPath: string) => Promise<void>;
  basename: (path: string) => Promise<string>;
  /** Electron only: subscribe to window close requests. Returns unsubscribe. */
  onCloseRequested: (cb: () => void) => () => void;
  /** Electron only: allow the window to close after unsaved-changes handling. */
  confirmClose: () => void;
  /** Electron only: tell main process whether unsaved changes exist. */
  setDirty: (dirty: boolean) => void;
  getAppInfo: () => Promise<AppInfo>;
  checkForUpdates: () => Promise<AppUpdateCheckResult>;
  installUpdate: () => Promise<{ ok: boolean }>;
  onUpdateStatus: (cb: (result: AppUpdateCheckResult) => void) => () => void;
};

const api: PrayerToolkitApi = {
  getStartupLibrary: () => ipcRenderer.invoke("app:getStartupLibrary"),
  openLibraryFolder: () => ipcRenderer.invoke("dialog:openLibrary"),
  createLibraryFolder: (opts) =>
    ipcRenderer.invoke("dialog:createLibrary", opts),
  openLibraryPath: (libraryRoot) =>
    ipcRenderer.invoke("library:openPath", libraryRoot),
  listJsonFiles: (libraryRoot) =>
    ipcRenderer.invoke("library:listJson", libraryRoot),
  readText: (libraryRoot, relativePath) =>
    ipcRenderer.invoke("fs:readText", libraryRoot, relativePath),
  writeText: (libraryRoot, relativePath, content) =>
    ipcRenderer.invoke("fs:writeText", libraryRoot, relativePath, content),
  deleteFile: (libraryRoot, relativePath) =>
    ipcRenderer.invoke("fs:delete", libraryRoot, relativePath),
  renameFile: (libraryRoot, fromRelative, toRelative) =>
    ipcRenderer.invoke("fs:rename", libraryRoot, fromRelative, toRelative),
  exists: (libraryRoot, relativePath) =>
    ipcRenderer.invoke("fs:exists", libraryRoot, relativePath),
  readAppStyles: () => ipcRenderer.invoke("styles:readApp"),
  writeAppStyles: (content) => ipcRenderer.invoke("styles:writeApp", content),
  readLibraryStyles: (libraryRoot) =>
    ipcRenderer.invoke("styles:readLibrary", libraryRoot),
  writeLibraryStyles: (libraryRoot, content) =>
    ipcRenderer.invoke("styles:writeLibrary", libraryRoot, content),
  saveExport: (defaultName, content) =>
    ipcRenderer.invoke("dialog:saveExport", defaultName, content),
  showItem: (fullPath) => ipcRenderer.invoke("shell:showItem", fullPath),
  basename: (path) => ipcRenderer.invoke("path:basename", path),
  onCloseRequested: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:close-requested", handler);
    return () => {
      ipcRenderer.removeListener("app:close-requested", handler);
    };
  },
  confirmClose: () => {
    ipcRenderer.send("app:confirm-close");
  },
  setDirty: (dirty) => {
    ipcRenderer.send("app:set-dirty", dirty);
  },
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  onUpdateStatus: (cb) => {
    const handler = (
      _event: unknown,
      result: AppUpdateCheckResult,
    ) => {
      cb(result);
    };
    ipcRenderer.on("app:update-status", handler);
    return () => {
      ipcRenderer.removeListener("app:update-status", handler);
    };
  },
};

contextBridge.exposeInMainWorld("prayerToolkit", api);
