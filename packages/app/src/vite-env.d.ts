/// <reference types="vite/client" />

import type { PrayerToolkitApi } from "../electron/preload";

declare global {
  interface Window {
    prayerToolkit?: PrayerToolkitApi;
  }
}

export {};
