import { useCallback, useEffect, useState } from "react";
import type { OcrLanguageStatus } from "../../electron/preload";
import { getToolkitApi, isBrowserDev } from "../api";

/** Tesseract pack for a Variant language ("de", "cu-Cyrl" …); Church Slavonic reads with Russian for now. */
const PACK_FOR: Record<string, string> = {
  de: "deu",
  en: "eng",
  ru: "rus",
  cu: "rus",
  uk: "ukr",
  sr: "srp",
  bg: "bul",
  ro: "ron",
  el: "ell",
  grc: "grc",
};

export function ocrPackFor(lang: string): string | null {
  return PACK_FOR[lang.toLowerCase().split(/[-_]/)[0] ?? ""] ?? null;
}

/** Language packs for scans and their download state (desktop app only). */
export function useOcrLanguages(active: boolean) {
  const [languages, setLanguages] = useState<OcrLanguageStatus[]>([]);
  const available = !isBrowserDev();

  useEffect(() => {
    if (!active || !available) return;
    const api = getToolkitApi();
    let live = true;
    void api.getOcrLanguages().then((l) => {
      if (live) setLanguages(l);
    });
    const stop = api.onOcrLanguages(setLanguages);
    return () => {
      live = false;
      stop();
    };
  }, [active, available]);

  const download = useCallback((code: string) => getToolkitApi().downloadOcrLanguage(code), []);
  return { available, languages, download };
}
