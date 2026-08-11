import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isUnderRoot,
  resolveUnderRoot,
  walkJsonFiles,
} from "../nodeFs";

const __dirname = dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = join(process.env.APP_ROOT, "dist");
const IS_DEV = Boolean(VITE_DEV_SERVER_URL);

const APP_NAME = "Orthodox Prayer Toolkit";
// Menu bar / About / app.getName(); Dock name needs Info.plist (see scripts/fix-electron-name.mjs).
app.setName(APP_NAME);

/** App icon for window (Win/Linux) and dock (macOS via setIcon). */
function resolveAppIconPath(): string | undefined {
  const resources = join(process.env.APP_ROOT!, "resources");
  const candidates =
    process.platform === "darwin"
      ? // Prefer PNG for dock.setIcon in dev; .icns is for packaged apps.
        [join(resources, "icon.png"), join(resources, "icon.icns")]
      : process.platform === "win32"
        ? [join(resources, "icon.ico"), join(resources, "icon.png")]
        : [join(resources, "icon.png")];
  return candidates.find((p) => existsSync(p));
}

/** Library folders opened this session (dialog or startup). */
const allowedLibraryRoots = new Set<string>();
/** Absolute paths written via the export save dialog (reveal-in-folder). */
const allowedRevealPaths = new Set<string>();

function rememberLibraryRoot(root: string): string {
  const normalized = resolve(root);
  allowedLibraryRoots.add(normalized);
  return normalized;
}

function assertAllowedLibraryRoot(libraryRoot: string): string {
  const normalized = resolve(libraryRoot);
  if (!allowedLibraryRoots.has(normalized)) {
    throw new Error("Library root is not open in this session");
  }
  return normalized;
}

function assertAllowedReveal(fullPath: string): string {
  const normalized = resolve(fullPath);
  if (allowedRevealPaths.has(normalized)) {
    return normalized;
  }
  for (const root of allowedLibraryRoots) {
    if (isUnderRoot(root, normalized)) {
      return normalized;
    }
  }
  throw new Error("Path is not allowed to reveal");
}

/** Dev-only: toolkit examples/ next to packages/ */
function examplesLibraryPath(): string | null {
  if (!IS_DEV) return null;
  const candidate = join(process.env.APP_ROOT!, "..", "..", "examples");
  return existsSync(candidate) ? candidate : null;
}

const allowCloseWindows = new WeakSet<BrowserWindow>();
const dirtyWindows = new WeakSet<BrowserWindow>();

function createWindow(): BrowserWindow {
  const icon = resolveAppIconPath();
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    show: false,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => {
    // Ensure OS hit-testing is enabled (some Electron/macOS paths leave the
    // window visually fine but not receiving mouse input after DevTools races).
    win.setIgnoreMouseEvents(false);
    win.show();
    win.focus();
  });

  win.on("close", (event) => {
    if (allowCloseWindows.has(win) || !dirtyWindows.has(win)) return;
    event.preventDefault();
    win.webContents.send("app:close-requested");
  });

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(join(RENDERER_DIST, "index.html"));
  }

  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("Preload failed:", preloadPath, error);
  });

  return win;
}

function appStylesPath(): string {
  return join(app.getPath("userData"), "kind-styles.json");
}

function libraryStylesPath(libraryRoot: string): string {
  return resolveUnderRoot(libraryRoot, ".orthodox-prayer-toolkit/styles.json");
}

function registerIpc(): void {
  ipcMain.handle("app:getStartupLibrary", () => {
    const path = examplesLibraryPath();
    if (path) rememberLibraryRoot(path);
    return path;
  });

  ipcMain.handle("dialog:openLibrary", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Open prayer library folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const chosen = result.filePaths[0];
    if (!chosen) return null;
    return rememberLibraryRoot(chosen);
  });

  ipcMain.handle(
    "dialog:createLibrary",
    async (
      _evt,
      opts: { name: string; manifestJson: string },
    ): Promise<string | null> => {
      const rawName = typeof opts?.name === "string" ? opts.name.trim() : "";
      if (!rawName) throw new Error("Library name is required");
      if (/[/\\]/.test(rawName) || rawName === "." || rawName === "..") {
        throw new Error("Library name cannot contain path separators");
      }
      if (typeof opts?.manifestJson !== "string" || !opts.manifestJson.trim()) {
        throw new Error("manifestJson is required");
      }

      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: "Choose location for the new library",
        buttonLabel: "Create here",
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const parent = result.filePaths[0];
      if (!parent) return null;

      const root = join(parent, rawName);
      if (existsSync(root)) {
        throw new Error(`Folder already exists: ${rawName}`);
      }
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "manifest.json"), opts.manifestJson, "utf8");
      return rememberLibraryRoot(root);
    },
  );

  ipcMain.handle("library:openPath", (_evt, libraryRoot: string) => {
    if (typeof libraryRoot !== "string" || !libraryRoot.trim()) {
      throw new Error("Invalid library path");
    }
    const normalized = resolve(libraryRoot);
    if (!existsSync(normalized) || !statSync(normalized).isDirectory()) {
      throw new Error("Folder not found");
    }
    return rememberLibraryRoot(normalized);
  });

  ipcMain.handle("library:listJson", (_evt, libraryRoot: string) => {
    const root = assertAllowedLibraryRoot(libraryRoot);
    const files: string[] = [];
    walkJsonFiles(root, root, files);
    return files.sort();
  });

  ipcMain.handle(
    "fs:readText",
    (_evt, libraryRoot: string, relativePath: string) => {
      const root = assertAllowedLibraryRoot(libraryRoot);
      const full = resolveUnderRoot(root, relativePath);
      return readFileSync(full, "utf8");
    },
  );

  ipcMain.handle(
    "fs:writeText",
    (_evt, libraryRoot: string, relativePath: string, content: string) => {
      const root = assertAllowedLibraryRoot(libraryRoot);
      const full = resolveUnderRoot(root, relativePath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    },
  );

  ipcMain.handle(
    "fs:delete",
    (_evt, libraryRoot: string, relativePath: string) => {
      const root = assertAllowedLibraryRoot(libraryRoot);
      const full = resolveUnderRoot(root, relativePath);
      rmSync(full, { force: true });
    },
  );

  ipcMain.handle(
    "fs:rename",
    (
      _evt,
      libraryRoot: string,
      fromRelative: string,
      toRelative: string,
    ) => {
      const root = assertAllowedLibraryRoot(libraryRoot);
      const from = resolveUnderRoot(root, fromRelative);
      const to = resolveUnderRoot(root, toRelative);
      if (existsSync(to)) {
        throw new Error(`Target already exists: ${toRelative}`);
      }
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    },
  );

  ipcMain.handle("fs:exists", (_evt, libraryRoot: string, relativePath: string) => {
    const root = assertAllowedLibraryRoot(libraryRoot);
    return existsSync(resolveUnderRoot(root, relativePath));
  });

  ipcMain.handle("styles:readApp", () => {
    const path = appStylesPath();
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  });

  ipcMain.handle("styles:writeApp", (_evt, content: string) => {
    writeFileSync(appStylesPath(), content, "utf8");
  });

  ipcMain.handle("styles:readLibrary", (_evt, libraryRoot: string) => {
    const root = assertAllowedLibraryRoot(libraryRoot);
    const path = libraryStylesPath(root);
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  });

  ipcMain.handle(
    "styles:writeLibrary",
    (_evt, libraryRoot: string, content: string) => {
      const root = assertAllowedLibraryRoot(libraryRoot);
      const path = libraryStylesPath(root);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    },
  );

  ipcMain.handle(
    "dialog:saveExport",
    async (_evt, defaultName: string, content: string | Uint8Array) => {
      const lower = defaultName.toLowerCase();
      const isHtml = lower.endsWith(".html");
      const isRtf = lower.endsWith(".rtf");
      const isDocx = lower.endsWith(".docx");
      const title = isHtml
        ? "Export HTML"
        : isRtf
          ? "Export Layout RTF"
          : isDocx
            ? "Export Layout DOCX"
            : "Export flat variant JSON";
      const filters = isHtml
        ? [
            { name: "HTML", extensions: ["html"] },
            { name: "All Files", extensions: ["*"] },
          ]
        : isRtf
          ? [
              { name: "RTF", extensions: ["rtf"] },
              { name: "All Files", extensions: ["*"] },
            ]
          : isDocx
            ? [
                { name: "Word Document", extensions: ["docx"] },
                { name: "All Files", extensions: ["*"] },
              ]
            : [
                { name: "JSON", extensions: ["json"] },
                { name: "All Files", extensions: ["*"] },
              ];
      const result = await dialog.showSaveDialog({
        title,
        defaultPath: defaultName,
        filters,
      });
      if (result.canceled || !result.filePath) return null;
      const saved = resolve(result.filePath);
      if (typeof content === "string") {
        writeFileSync(saved, content, "utf8");
      } else {
        writeFileSync(saved, Buffer.from(content));
      }
      allowedRevealPaths.add(saved);
      return saved;
    },
  );

  ipcMain.handle("shell:showItem", (_evt, fullPath: string) => {
    const allowed = assertAllowedReveal(fullPath);
    if (existsSync(allowed) && statSync(allowed).isDirectory()) {
      void shell.openPath(allowed);
    } else {
      shell.showItemInFolder(allowed);
    }
  });

  ipcMain.handle("path:basename", (_evt, p: string) => basename(p));

  ipcMain.on("app:set-dirty", (event, dirty: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (dirty) dirtyWindows.add(win);
    else dirtyWindows.delete(win);
  });

  ipcMain.on("app:confirm-close", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    dirtyWindows.delete(win);
    allowCloseWindows.add(win);
    win.close();
  });

  ipcMain.handle("app:check-for-updates", async () => {
    if (!app.isPackaged) {
      return { ok: false as const, reason: "dev" as const };
    }
    try {
      const result = await autoUpdater.checkForUpdates();
      return {
        ok: true as const,
        version: result?.updateInfo?.version ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[autoUpdater] Manual check failed:", message);
      return { ok: false as const, reason: "error" as const, message };
    }
  });
}

function setupAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[autoUpdater] Checking for update…");
  });
  autoUpdater.on("update-available", (info) => {
    console.log(`[autoUpdater] Update available: ${info.version}`);
  });
  autoUpdater.on("update-not-available", () => {
    console.log("[autoUpdater] Already up to date.");
  });
  autoUpdater.on("error", (error) => {
    console.error("[autoUpdater]", error);
  });
  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[autoUpdater] Downloaded ${info.version}; will install on quit.`);
    const win =
      BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const boxOptions = {
      type: "info" as const,
      title: "Update ready",
      message: `Version ${info.version} has been downloaded.`,
      detail:
        "Restart now to apply the update, or continue working and restart later.",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    };
    const prompt = win
      ? dialog.showMessageBox(win, boxOptions)
      : dialog.showMessageBox(boxOptions);
    void prompt.then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // Delay so the window can appear before network I/O.
  setTimeout(() => {
    void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
      console.error("[autoUpdater] Startup check failed:", error);
    });
  }, 5_000);
}

function buildAppMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Check for Updates…",
                click: () => {
                  if (!app.isPackaged) {
                    void dialog.showMessageBox({
                      type: "info",
                      title: "Updates",
                      message: "Update checks run only in packaged builds.",
                    });
                    return;
                  }
                  void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
                    console.error("[autoUpdater] Menu check failed:", error);
                  });
                },
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        ...(!isMac
          ? [
              {
                label: "Check for Updates…",
                click: () => {
                  if (!app.isPackaged) {
                    void dialog.showMessageBox({
                      type: "info",
                      title: "Updates",
                      message: "Update checks run only in packaged builds.",
                    });
                    return;
                  }
                  void autoUpdater.checkForUpdatesAndNotify().catch((error: unknown) => {
                    console.error("[autoUpdater] Menu check failed:", error);
                  });
                },
              },
              { type: "separator" as const },
            ]
          : []),
        {
          label: "GitHub Releases",
          click: () => {
            void shell.openExternal(
              "https://github.com/mchlrdev/orthodox-prayer-toolkit/releases",
            );
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  const icon = resolveAppIconPath();
  if (icon && process.platform === "darwin" && app.dock) {
    app.dock.setIcon(icon);
  }

  registerIpc();
  buildAppMenu();
  createWindow();
  setupAutoUpdater();

  // Don't auto-open DevTools on launch — on macOS that can race with window
  // hit-testing and leave the UI unable to receive clicks. Toggle manually.
  if (IS_DEV) {
    globalShortcut.register("CommandOrControl+Shift+I", () => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return;
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: "detach" });
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
