import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createModelStore, type ModelState, type ModelStatus, type ModelStore } from "./modelStore.ts";
import { OCR_LANGUAGES, ocrPackEntry } from "./ocrCatalog.ts";

/**
 * Text recognition for scans: Tesseract (tesseract.js, WebAssembly in a
 * worker thread) with the language packs from `ocrCatalog.ts`. One job at a
 * time; the worker is ended after each job, so its memory (about 150 MB)
 * is given back.
 */

export type OcrLanguageStatus = {
  code: string;
  name: string;
  size: number;
  state: ModelState;
  received: number;
  message?: string;
};

type Box = { x0: number; y0: number; x1: number; y1: number };

/** One recognised line (the shape `ocrLayout.ts` reads, without ink). */
export type RecognizedLine = {
  text: string;
  bbox: Box;
  baseline: Box;
  rowHeight: number;
  confidence: number;
  words: Array<{ text: string; bbox: Box; confidence: number }>;
};

type TesseractBlock = {
  paragraphs: Array<{
    lines: Array<{
      text: string;
      bbox: Box;
      baseline: Box;
      confidence: number;
      rowAttributes?: { row_height?: number; rowHeight?: number };
      words: Array<{ text: string; bbox: Box; confidence: number }>;
    }>;
  }>;
};

export class OcrCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "OcrCancelled";
  }
}

const box = (b: Box): Box => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });

export function linesOf(blocks: readonly TesseractBlock[] | null | undefined): RecognizedLine[] {
  const out: RecognizedLine[] = [];
  for (const block of blocks ?? []) {
    for (const par of block.paragraphs) {
      for (const l of par.lines) {
        out.push({
          text: l.text.replace(/\n$/, ""),
          bbox: box(l.bbox),
          baseline: box(l.baseline),
          rowHeight: l.rowAttributes?.rowHeight ?? l.rowAttributes?.row_height ?? 0,
          confidence: l.confidence,
          words: l.words.map((w) => ({ text: w.text, bbox: box(w.bbox), confidence: w.confidence })),
        });
      }
    }
  }
  return out;
}

export function createOcrService(options: {
  root: string;
  fetch?: typeof fetch;
  onStatus: (languages: OcrLanguageStatus[]) => void;
}) {
  const stores = new Map<string, ModelStore>();
  let queue: Promise<unknown> = Promise.resolve();
  const running = new Map<number, { terminate: () => Promise<unknown> } | "cancelled">();

  function store(code: string): ModelStore {
    let s = stores.get(code);
    if (s) return s;
    const entry = ocrPackEntry(code);
    if (!entry) throw new Error(`No language pack for “${code}”`);
    s = createModelStore({
      root: options.root,
      entry,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      onChange: () => options.onStatus(languages()),
    });
    stores.set(code, s);
    return s;
  }

  function languages(): OcrLanguageStatus[] {
    return OCR_LANGUAGES.map(({ code, name }) => {
      const st: ModelStatus = store(code).status();
      return {
        code,
        name,
        size: st.model.size,
        state: st.state,
        received: st.received,
        ...(st.message ? { message: st.message } : {}),
      };
    });
  }

  async function recognize(
    job: number,
    image: Uint8Array,
    codes: readonly string[],
    onProgress: (progress: number) => void,
  ): Promise<RecognizedLine[]> {
    const cancelled = () => running.get(job) === "cancelled";
    try {
      if (codes.length === 0) throw new Error("Choose at least one language");
      const files = codes.map((code) => {
        const installed = store(code).installedFiles();
        if (!installed) throw new Error(`The language pack “${code}” is not downloaded`);
        return installed[0]!;
      });
      if (cancelled()) throw new OcrCancelled();
      // Tesseract reads every pack from one folder (packs passed as data
      // are named wrongly by tesseract.js 7), so the job gets a copy.
      const langPath = mkdtempSync(join(tmpdir(), "opt-ocr-"));
      for (const file of files) copyFileSync(file, join(langPath, basename(file)));
      const { createWorker, OEM } = await import("tesseract.js");
      const worker = await createWorker([...codes], OEM.LSTM_ONLY, {
        langPath,
        cacheMethod: "none",
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          if (m.status === "recognizing text") onProgress(m.progress);
        },
      }).finally(() => rmSync(langPath, { recursive: true, force: true }));
      try {
        if (cancelled()) throw new OcrCancelled();
        running.set(job, worker);
        const { data } = await worker.recognize(Buffer.from(image), {}, { blocks: true });
        return linesOf((data as unknown as { blocks: TesseractBlock[] | null }).blocks);
      } catch (error) {
        throw cancelled() ? new OcrCancelled() : error;
      } finally {
        await worker.terminate().catch(() => undefined);
      }
    } finally {
      running.delete(job);
    }
  }

  return {
    languages,
    download: (code: string) => store(code).download(),
    cancelDownload: (code: string) => store(code).cancel(),
    remove: (code: string) => store(code).remove(),
    /** Jobs run one after another. */
    recognize(job: number, image: Uint8Array, codes: readonly string[], onProgress: (progress: number) => void) {
      const next = queue.then(() => recognize(job, image, codes, onProgress));
      queue = next.catch(() => undefined);
      return next;
    },
    async cancel(job: number) {
      const worker = running.get(job);
      running.set(job, "cancelled");
      if (worker && worker !== "cancelled") await worker.terminate().catch(() => undefined);
    },
  };
}
