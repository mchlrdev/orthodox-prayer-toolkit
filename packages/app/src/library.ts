import { prayerFilename, type Prayer } from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../electron/preload";
import {
  collectCatalog,
  scanLibraryCatalog,
  type CatalogEntry,
  type LibraryCatalog,
} from "./catalog";

export type LibraryEntry = CatalogEntry;
export type OpenedLibrary = LibraryCatalog;

export async function loadLibrary(
  root: string,
  api: PrayerToolkitApi,
): Promise<OpenedLibrary> {
  return collectCatalog(scanLibraryCatalog(root, api));
}

export function emptyPrayer(id: string): Prayer {
  return {
    id,
    type: "prayer",
    tone: null,
    variants: [
      {
        lang: "de",
        variant: "standard",
        title: "Unbenannt",
        license: "unknown",
        source: "draft",
      },
    ],
    structure: [
      {
        id: "b1",
        kind: "verse",
        translations: [],
      },
    ],
  };
}

export { prayerFilename };
