/** Window chrome helpers for the Electron shell (menu bar, zoom keys). */

export type MenuBarWindow = {
  setAutoHideMenuBar: (hide: boolean) => void;
  setMenuBarVisibility: (visible: boolean) => void;
};

export type ZoomWebContents = {
  zoomLevel: number;
};

export type ZoomKeyInput = {
  type: string;
  key: string;
  code?: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
};

export type ZoomAction = "in" | "out" | "reset";

/** In-window menu bar is macOS-native; hide it by default elsewhere. */
export function shouldAutoHideMenuBar(platform: NodeJS.Platform): boolean {
  return platform !== "darwin";
}

/** Pin the menu bar visible, or restore auto-hide (hidden until Alt). */
export function applyMenuBarPinned(win: MenuBarWindow, pinned: boolean): void {
  win.setAutoHideMenuBar(!pinned);
  win.setMenuBarVisibility(pinned);
}

/**
 * Map Ctrl/Cmd zoom keys. Menu roles use CommandOrControl+Plus, which on
 * Windows/Linux often misses the unshifted "=" key and numpad +/-.
 */
export function zoomActionFromInput(
  input: ZoomKeyInput,
  mac: boolean,
): ZoomAction | null {
  if (input.type !== "keyDown") return null;
  const mod = mac ? input.meta && !input.control : input.control && !input.meta;
  if (!mod || input.alt) return null;

  const key = input.key;
  const code = input.code ?? "";
  if (key === "0" || code === "Digit0" || code === "Numpad0") return "reset";
  if (
    key === "+" ||
    key === "=" ||
    key === "Add" ||
    code === "NumpadAdd"
  ) {
    return "in";
  }
  if (key === "-" || key === "_" || key === "Subtract" || code === "NumpadSubtract") {
    return "out";
  }
  return null;
}

export function applyZoomAction(
  webContents: ZoomWebContents,
  action: ZoomAction,
): void {
  if (action === "reset") {
    webContents.zoomLevel = 0;
    return;
  }
  webContents.zoomLevel += action === "in" ? 0.5 : -0.5;
}
