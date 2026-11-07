import { contextBridge, ipcRenderer } from "electron";
import type {
  AppInfo,
  AppUpdateCheckResult,
} from "./updateCheck";

import type { DecisionPrompt } from "@orthodox-prayer-toolkit/core";
import type { ModelStatus } from "./modelStore";
import type { ModelDeviceInfo } from "./modelDevice";
import type { OcrLanguageStatus, RecognizedLine } from "./ocrService";
import type { GenerateRequest, ModelJobMessage } from "./modelWorker";

export type { AppInfo, AppUpdateCheckResult } from "./updateCheck";
export type { ModelStatus } from "./modelStore";
export type { ModelDeviceInfo } from "./modelDevice";
export type { OcrLanguageStatus, RecognizedLine } from "./ocrService";
export type { GenerateRequest, ModelJobMessage } from "./modelWorker";

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
  readTexts: (
    libraryRoot: string,
    relativePaths: string[],
  ) => Promise<{ path: string; text: string }[]>;
  writeText: (
    libraryRoot: string,
    relativePath: string,
    content: string,
  ) => Promise<void>;
  /** Create a new file; false (nothing written) when the path already exists. */
  createText: (
    libraryRoot: string,
    relativePath: string,
    content: string,
  ) => Promise<boolean>;
  deleteFile: (libraryRoot: string, relativePath: string) => Promise<void>;
  renameFile: (
    libraryRoot: string,
    fromRelative: string,
    toRelative: string,
  ) => Promise<void>;
  exists: (libraryRoot: string, relativePath: string) => Promise<boolean>;
  readLibraryStyles: (libraryRoot: string) => Promise<string | null>;
  writeLibraryStyles: (libraryRoot: string, content: string) => Promise<void>;
  /** `.orthodox-prayer-toolkit/templates.json` text, or null when missing. */
  readLibraryTemplates: (libraryRoot: string) => Promise<string | null>;
  writeLibraryTemplates: (libraryRoot: string, content: string) => Promise<void>;
  /** `.orthodox-prayer-toolkit/memory.json` text (Library memory), or null when missing. */
  readLibraryMemory: (libraryRoot: string) => Promise<string | null>;
  writeLibraryMemory: (libraryRoot: string, content: string) => Promise<void>;
  saveExport: (
    defaultName: string,
    content: string | Uint8Array,
  ) => Promise<string | null>;
  /** Open-file dialog; returns basename + file text, or null if cancelled. */
  pickPrayerJson: () => Promise<{ name: string; content: string } | null>;
  /** Turn Agent access on or off; resolves to its port (null = off). */
  setAgentAccess: (enabled: boolean) => Promise<number | null>;
  /** Port of the running Agent access, or null. */
  getAgentAccess: () => Promise<number | null>;
  /** Requests from Agents for the Tool directory; answer with `respondAgentRequest`. */
  onAgentRequest: (
    cb: (id: number, request: { method: string; path: string; body: string }) => void,
  ) => () => void;
  respondAgentRequest: (id: number, answer: { status: number; body: unknown }) => void;
  /** The Built-in model: status, download (resumes), cancel (keeps the partial file), delete. */
  getModelStatus: () => Promise<ModelStatus>;
  downloadModel: () => Promise<void>;
  cancelModelDownload: () => Promise<void>;
  removeModel: () => Promise<void>;
  onModelStatus: (cb: (status: ModelStatus) => void) => () => void;
  /** Where the Built-in model runs (null: not installed or unknown), and when that changes. */
  getModelDevice: () => Promise<ModelDeviceInfo | null>;
  onModelDevice: (cb: (device: ModelDeviceInfo) => void) => () => void;
  /** Decisions on the Built-in model (in its own process); answers arrive per item. */
  startDecision: (job: number, prompt: DecisionPrompt) => Promise<void>;
  /** Free text from the Built-in model; chunks arrive as "text" messages on `onDecision`. */
  startGenerate: (job: number, request: GenerateRequest) => Promise<void>;
  cancelDecision: (job: number) => Promise<void>;
  onDecision: (cb: (message: ModelJobMessage) => void) => () => void;
  /** Tesseract language packs for scans: download on demand, kept for offline use. */
  getOcrLanguages: () => Promise<OcrLanguageStatus[]>;
  downloadOcrLanguage: (code: string) => Promise<void>;
  cancelOcrDownload: (code: string) => Promise<void>;
  removeOcrLanguage: (code: string) => Promise<void>;
  onOcrLanguages: (cb: (languages: OcrLanguageStatus[]) => void) => () => void;
  /** Recognise the text of an image (PNG/JPEG bytes); null when cancelled. */
  recognizeImage: (job: number, image: Uint8Array, languages: string[]) => Promise<RecognizedLine[] | null>;
  cancelRecognize: (job: number) => Promise<void>;
  onOcrProgress: (cb: (job: number, progress: number) => void) => () => void;
  /** Fetch a web page for the import (http/https, size-capped). */
  fetchSource: (
    url: string,
  ) => Promise<{ url: string; contentType: string; text: string }>;
  showItem: (fullPath: string) => Promise<void>;
  basename: (path: string) => Promise<string>;
  /** Electron only: subscribe to Edit → Find. Returns unsubscribe. */
  onFindRequested: (cb: () => void) => () => void;
  /** Electron only: subscribe to Edit → Find Next. Returns unsubscribe. */
  onFindNextRequested: (cb: () => void) => () => void;
  /** Electron only: subscribe to window close requests. Returns unsubscribe. */
  onCloseRequested: (cb: () => void) => () => void;
  /** Electron only: allow the window to close after unsaved-changes handling. */
  confirmClose: () => void;
  /** Electron only: tell main process whether unsaved changes exist. */
  setDirty: (dirty: boolean) => void;
  /** Electron only: watch the open library folder (null stops watching). */
  watchLibrary: (libraryRoot: string | null) => Promise<void>;
  /** Electron only: `.json` files changed on disk outside the app. */
  onLibraryChanged: (
    cb: (change: { root: string; paths: string[] }) => void,
  ) => () => void;
  /** Electron only: app menu command (shortcuts on macOS go through the menu). */
  onCommand: (cb: (command: string) => void) => () => void;
  /** Electron only: clipboard edit actions for the renderer's context menus. */
  runEdit: (action: "cut" | "copy" | "paste" | "selectAll") => Promise<void>;
  /** Electron only: "Install and Restart" chosen while prayers are unsaved. */
  onInstallRequested: (cb: () => void) => () => void;
  /** Electron only: unsaved changes handled; quit and install the update. */
  confirmInstall: () => void;
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
  readTexts: (libraryRoot, relativePaths) =>
    ipcRenderer.invoke("fs:readTexts", libraryRoot, relativePaths),
  writeText: (libraryRoot, relativePath, content) =>
    ipcRenderer.invoke("fs:writeText", libraryRoot, relativePath, content),
  createText: (libraryRoot, relativePath, content) =>
    ipcRenderer.invoke("fs:createText", libraryRoot, relativePath, content),
  deleteFile: (libraryRoot, relativePath) =>
    ipcRenderer.invoke("fs:delete", libraryRoot, relativePath),
  renameFile: (libraryRoot, fromRelative, toRelative) =>
    ipcRenderer.invoke("fs:rename", libraryRoot, fromRelative, toRelative),
  exists: (libraryRoot, relativePath) =>
    ipcRenderer.invoke("fs:exists", libraryRoot, relativePath),
  readLibraryStyles: (libraryRoot) =>
    ipcRenderer.invoke("styles:readLibrary", libraryRoot),
  writeLibraryStyles: (libraryRoot, content) =>
    ipcRenderer.invoke("styles:writeLibrary", libraryRoot, content),
  readLibraryTemplates: (libraryRoot) =>
    ipcRenderer.invoke("templates:readLibrary", libraryRoot),
  writeLibraryTemplates: (libraryRoot, content) =>
    ipcRenderer.invoke("templates:writeLibrary", libraryRoot, content),
  readLibraryMemory: (libraryRoot) => ipcRenderer.invoke("memory:readLibrary", libraryRoot),
  writeLibraryMemory: (libraryRoot, content) =>
    ipcRenderer.invoke("memory:writeLibrary", libraryRoot, content),
  saveExport: (defaultName, content) =>
    ipcRenderer.invoke("dialog:saveExport", defaultName, content),
  pickPrayerJson: () => ipcRenderer.invoke("dialog:pickPrayerJson"),
  fetchSource: (url: string) => ipcRenderer.invoke("import:fetchSource", url),
  setAgentAccess: (enabled) => ipcRenderer.invoke("agent:setEnabled", enabled),
  getAgentAccess: () => ipcRenderer.invoke("agent:status"),
  onAgentRequest: (cb) => {
    const handler = (
      _event: unknown,
      id: number,
      request: { method: string; path: string; body: string },
    ) => cb(id, request);
    ipcRenderer.on("agent:request", handler);
    return () => {
      ipcRenderer.removeListener("agent:request", handler);
    };
  },
  respondAgentRequest: (id, answer) => {
    ipcRenderer.send("agent:respond", id, answer);
  },
  getModelStatus: () => ipcRenderer.invoke("model:status"),
  downloadModel: () => ipcRenderer.invoke("model:download"),
  cancelModelDownload: () => ipcRenderer.invoke("model:cancel"),
  removeModel: () => ipcRenderer.invoke("model:remove"),
  onModelStatus: (cb) => {
    const handler = (_event: unknown, status: ModelStatus) => cb(status);
    ipcRenderer.on("model:status", handler);
    return () => {
      ipcRenderer.removeListener("model:status", handler);
    };
  },
  getModelDevice: () => ipcRenderer.invoke("model:device"),
  onModelDevice: (cb) => {
    const handler = (_event: unknown, device: ModelDeviceInfo) => cb(device);
    ipcRenderer.on("model:device", handler);
    return () => {
      ipcRenderer.removeListener("model:device", handler);
    };
  },
  startDecision: (job, prompt) => ipcRenderer.invoke("model:decide", job, prompt),
  startGenerate: (job, request) => ipcRenderer.invoke("model:generate", job, request),
  cancelDecision: (job) => ipcRenderer.invoke("model:cancelDecide", job),
  onDecision: (cb) => {
    const handler = (_event: unknown, message: ModelJobMessage) => cb(message);
    ipcRenderer.on("model:decision", handler);
    return () => {
      ipcRenderer.removeListener("model:decision", handler);
    };
  },
  getOcrLanguages: () => ipcRenderer.invoke("ocr:languages"),
  downloadOcrLanguage: (code) => ipcRenderer.invoke("ocr:download", code),
  cancelOcrDownload: (code) => ipcRenderer.invoke("ocr:cancelDownload", code),
  removeOcrLanguage: (code) => ipcRenderer.invoke("ocr:remove", code),
  onOcrLanguages: (cb) => {
    const handler = (_event: unknown, languages: OcrLanguageStatus[]) => cb(languages);
    ipcRenderer.on("ocr:languages", handler);
    return () => {
      ipcRenderer.removeListener("ocr:languages", handler);
    };
  },
  recognizeImage: (job, image, languages) => ipcRenderer.invoke("ocr:recognize", job, image, languages),
  cancelRecognize: (job) => ipcRenderer.invoke("ocr:cancel", job),
  onOcrProgress: (cb) => {
    const handler = (_event: unknown, job: number, progress: number) => cb(job, progress);
    ipcRenderer.on("ocr:progress", handler);
    return () => {
      ipcRenderer.removeListener("ocr:progress", handler);
    };
  },
  showItem: (fullPath) => ipcRenderer.invoke("shell:showItem", fullPath),
  basename: (path) => ipcRenderer.invoke("path:basename", path),
  onCloseRequested: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:close-requested", handler);
    return () => {
      ipcRenderer.removeListener("app:close-requested", handler);
    };
  },
  onFindRequested: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:find", handler);
    return () => {
      ipcRenderer.removeListener("app:find", handler);
    };
  },
  onFindNextRequested: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:find-next", handler);
    return () => {
      ipcRenderer.removeListener("app:find-next", handler);
    };
  },
  confirmClose: () => {
    ipcRenderer.send("app:confirm-close");
  },
  setDirty: (dirty) => {
    ipcRenderer.send("app:set-dirty", dirty);
  },
  watchLibrary: (libraryRoot) =>
    ipcRenderer.invoke("library:watch", libraryRoot),
  onLibraryChanged: (cb) => {
    const handler = (
      _event: unknown,
      change: { root: string; paths: string[] },
    ) => cb(change);
    ipcRenderer.on("library:changed", handler);
    return () => {
      ipcRenderer.removeListener("library:changed", handler);
    };
  },
  onCommand: (cb) => {
    const handler = (_event: unknown, command: string) => cb(command);
    ipcRenderer.on("app:command", handler);
    return () => {
      ipcRenderer.removeListener("app:command", handler);
    };
  },
  runEdit: (action) => ipcRenderer.invoke("edit:run", action),
  onInstallRequested: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("app:install-requested", handler);
    return () => {
      ipcRenderer.removeListener("app:install-requested", handler);
    };
  },
  confirmInstall: () => {
    ipcRenderer.send("app:confirm-install");
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
