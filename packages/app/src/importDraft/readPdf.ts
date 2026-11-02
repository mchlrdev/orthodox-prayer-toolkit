import type { PDFDocumentProxy } from "pdfjs-dist";
// The legacy build carries polyfills: Electron's Chromium lacks
// Uint8Array.prototype.toHex, which pdf.js 5 calls for every document.
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { Source } from "@orthodox-prayer-toolkit/core";
import { segmentPdfPages } from "./pdfLayout";
import { pdfDocumentText } from "./pdfText";

GlobalWorkerOptions.workerSrc = workerUrl;

/** Open a PDF with pdf.js (in its worker; no scripts of the PDF run). */
export function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js takes ownership of the buffer; keep the caller's copy usable.
  return getDocument({
    data: data.slice(),
    enableXfa: false,
  }).promise;
}

/** PDF Reader: text items → lines, columns, paragraphs → Source segments. */
export async function readPdf(
  data: Uint8Array,
  options: { id?: string; name?: string } = {},
): Promise<Source> {
  const doc = await openPdf(data);
  try {
    return segmentPdfPages(await pdfDocumentText(doc), options);
  } finally {
    await doc.destroy();
  }
}
