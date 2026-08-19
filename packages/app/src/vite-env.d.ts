/// <reference types="vite/client" />

import type { PrayerToolkitApi } from "../electron/preload";

declare global {
  const __APP_VERSION__: string;
  interface Window {
    prayerToolkit?: PrayerToolkitApi;
  }
}

export {};
