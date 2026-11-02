import type { ModelEntry } from "./modelCatalog.ts";

/**
 * Tesseract language packs for scans: the LSTM models of tessdata_best
 * (Apache-2.0), integer-quantised, as packaged by tesseract.js-data (MIT).
 * Pinned to a package version; `sha256` and `size` come from it. Each pack
 * downloads on demand like the Built-in model and is kept for offline use.
 */

const DATA_VERSION = "1.0.0";
const packUrl = (code: string) =>
  `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${code}@${DATA_VERSION}/4.0.0_best_int/${code}.traineddata.gz`;

type Pack = { code: string; name: string; sha256: string; size: number };

const PACKS: Pack[] = [
  { code: "deu", name: "German", size: 1333102, sha256: "306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b" },
  { code: "eng", name: "English", size: 2952873, sha256: "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91" },
  { code: "rus", name: "Russian (also for Church Slavonic in civil script)", size: 2679598, sha256: "f51f5edc992249ff9b70a227b22f242dfa47b2b1bbc7ae0ea74908640c101f6a" },
  { code: "ukr", name: "Ukrainian", size: 2114206, sha256: "ea2789a0ad99ff84bfd252a7410a1e8661a7bc5acaa41573d23b54b71446aa4c" },
  { code: "srp", name: "Serbian (Cyrillic)", size: 1537929, sha256: "4a864eba46de4a7c264fc3c34b63db6889218eb51eefc5d38c5eaac548d58c96" },
  { code: "bul", name: "Bulgarian", size: 1411343, sha256: "a38fdba9367316dad1d595427a975756e8c31367fc94a6530d012827833db8d7" },
  { code: "ron", name: "Romanian", size: 1692160, sha256: "3c2f550b6369f43254adf637cfe1088c7b6faff3d0382555219315112a24582a" },
  { code: "ell", name: "Greek", size: 1324749, sha256: "e8a293abb398ec479176c1575aef24e2bacb0611c713f3fa996f97f0cd996fb3" },
  { code: "grc", name: "Ancient Greek", size: 1091626, sha256: "5900b2bf126da1d98f3d5aabeea871f3e7386323ee6292be069bc7ed2b6a15cf" },
];

export type OcrLanguage = { code: string; name: string };

export const OCR_LANGUAGES: OcrLanguage[] = PACKS.map(({ code, name }) => ({ code, name }));

/** The pack as a store entry (`<root>/tesseract-<code>/<version>/<code>.traineddata.gz`). */
export function ocrPackEntry(code: string): ModelEntry | null {
  const pack = PACKS.find((p) => p.code === code);
  if (!pack) return null;
  return {
    id: `tesseract-${pack.code}`,
    name: pack.name,
    version: DATA_VERSION,
    files: [{ name: `${pack.code}.traineddata.gz`, url: packUrl(pack.code), sha256: pack.sha256, size: pack.size }],
  };
}
