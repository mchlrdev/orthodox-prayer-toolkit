import type { Source } from "@orthodox-prayer-toolkit/core";
import type { RecognizedLine } from "../../electron/preload";
import { getToolkitApi } from "../api";
import { segmentOcrPages, type OcrLine, type OcrPage } from "./ocrLayout";
import { openPdf } from "./readPdf";

/**
 * Scan Reader: images and PDFs without a text layer. Pages are drawn at a
 * size Tesseract reads well (and that keeps memory low), recognised in the
 * desktop app one page at a time, the ink colour of each line is measured,
 * and `ocrLayout.ts` makes the segments.
 */

/** Longest side of a page sent to recognition, in pixels. */
const MAX_SIDE = 3000;
/** Smaller images are enlarged (at most twice) up to this; tiny letters read badly. */
const MIN_SIDE = 1600;

export type ScanOptions = {
  id?: string;
  name?: string;
  /** Tesseract language codes ("deu", "rus"). */
  languages: string[];
  /** 0–1 over all pages. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
};

export class ScanCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "ScanCancelled";
  }
}

function sideScale(width: number, height: number): number {
  const long = Math.max(width, height);
  if (long > MAX_SIDE) return MAX_SIDE / long;
  if (long < MIN_SIDE) return Math.min(2, MIN_SIDE / long);
  return 1;
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function jpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Cannot encode the image"));
        else void blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      },
      "image/jpeg",
      0.92,
    );
  });
}

/**
 * Ink of a line: the darkest fifth of the pixels inside its words (the
 * letters, not the paper), averaged.
 */
export function measureInk(image: ImageData, line: RecognizedLine): [number, number, number] | undefined {
  const samples: Array<[number, number, number, number]> = [];
  for (const w of line.words) {
    const x0 = Math.max(0, Math.floor(w.bbox.x0));
    const x1 = Math.min(image.width, Math.ceil(w.bbox.x1));
    const y0 = Math.max(0, Math.floor(w.bbox.y0));
    const y1 = Math.min(image.height, Math.ceil(w.bbox.y1));
    // Every second pixel is plenty for a colour.
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const i = (y * image.width + x) * 4;
        const r = image.data[i]!;
        const g = image.data[i + 1]!;
        const b = image.data[i + 2]!;
        samples.push([0.299 * r + 0.587 * g + 0.114 * b, r, g, b]);
      }
    }
  }
  if (samples.length < 10) return undefined;
  samples.sort((a, b) => a[0] - b[0]);
  const dark = samples.slice(0, Math.max(5, Math.floor(samples.length / 5)));
  const avg = (k: 1 | 2 | 3) => Math.round(dark.reduce((n, s) => n + s[k], 0) / dark.length);
  return [avg(1), avg(2), avg(3)];
}

let nextJob = 1;

/** Recognise one drawn page; lines in its pixels, with ink. */
async function recognizeCanvas(
  canvas: HTMLCanvasElement,
  bytes: Uint8Array,
  options: ScanOptions,
  onProgress: (progress: number) => void,
): Promise<OcrLine[]> {
  const api = getToolkitApi();
  const job = nextJob++;
  const stop = api.onOcrProgress((j, progress) => {
    if (j === job) onProgress(progress);
  });
  const abort = () => void api.cancelRecognize(job);
  options.signal?.addEventListener("abort", abort);
  try {
    if (options.signal?.aborted) throw new ScanCancelled();
    const lines = await api.recognizeImage(job, bytes, options.languages);
    if (!lines || options.signal?.aborted) throw new ScanCancelled();
    const image = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    return lines.map((line) => {
      const ink = measureInk(image, line);
      return ink ? { ...line, ink } : line;
    });
  } finally {
    stop();
    options.signal?.removeEventListener("abort", abort);
  }
}

/** An image file → Source (`format: "image"`, areas in pixels of `data`) and the image the scan view shows. */
export async function readImageScan(file: Blob, options: ScanOptions): Promise<{ source: Source; data: Uint8Array }> {
  const bitmap = await createImageBitmap(file);
  const scale = sideScale(bitmap.width, bitmap.height);
  const canvas = canvasOf(bitmap.width * scale, bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  try {
    const data = await jpegBytes(canvas);
    const lines = await recognizeCanvas(canvas, data, options, (p) => options.onProgress?.(p));
    const page: OcrPage = { page: 1, width: canvas.width, height: canvas.height, lines };
    return { source: segmentOcrPages([page], { id: options.id, name: options.name ?? "Scan" }), data };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function scaleBox<T extends { x0: number; y0: number; x1: number; y1: number }>(b: T, k: number): T {
  return { ...b, x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k };
}

/** A PDF without a text layer → Source (`format: "pdf"`, areas in points like any PDF). */
export async function readScannedPdf(data: Uint8Array, options: ScanOptions): Promise<Source> {
  const doc = await openPdf(data);
  try {
    const pages: OcrPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(4, MAX_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = canvasOf(viewport.width, viewport.height);
      try {
        await page.render({ canvas, viewport, background: "#ffffff" }).promise;
        const bytes = await jpegBytes(canvas);
        const lines = await recognizeCanvas(canvas, bytes, options, (p) =>
          options.onProgress?.((n - 1 + p) / doc.numPages),
        );
        const k = 1 / scale;
        pages.push({
          page: n,
          width: base.width,
          height: base.height,
          lines: lines.map((l) => ({
            ...l,
            bbox: scaleBox(l.bbox, k),
            baseline: scaleBox(l.baseline, k),
            rowHeight: (l.rowHeight ?? 0) * k,
            words: l.words.map((w) => ({ ...w, bbox: scaleBox(w.bbox, k) })),
          })),
        });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    }
    const source = segmentOcrPages(pages, { id: options.id, name: options.name ?? "PDF" });
    return { ...source, format: "pdf" };
  } finally {
    await doc.destroy();
  }
}

/** Page count and a small picture of the first page, for the import dialog. */
export async function pdfScanPreview(data: Uint8Array): Promise<{ pages: number; thumb: string | null }> {
  const doc = await openPdf(data);
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 264 / base.width });
    const canvas = canvasOf(viewport.width, viewport.height);
    try {
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      return { pages: doc.numPages, thumb: canvas.toDataURL("image/jpeg", 0.8) };
    } catch {
      return { pages: doc.numPages, thumb: null };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await doc.destroy();
  }
}
