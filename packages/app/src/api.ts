import type { PrayerToolkitApi } from "../electron/preload";
import { createBrowserToolkitApi } from "./browserToolkit";

let browserApi: PrayerToolkitApi | null = null;

function isElectronBridge(): boolean {
  return typeof window.prayerToolkit !== "undefined";
}

/**
 * Electron preload when present; otherwise Vite browser-dev filesystem API.
 */
export function getToolkitApi(): PrayerToolkitApi {
  if (isElectronBridge()) {
    return window.prayerToolkit!;
  }
  browserApi ??= createBrowserToolkitApi();
  return browserApi;
}

export function hasToolkitApi(): boolean {
  // Always available: Electron bridge or browser-dev adapter
  return true;
}

export function isBrowserDev(): boolean {
  return !isElectronBridge();
}
