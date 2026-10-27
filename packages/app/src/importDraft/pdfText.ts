import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { PdfPageText, PdfTextItem } from "./pdfLayout";

/**
 * pdf.js text items of every page, in points from the top-left corner,
 * with the font's real name (subset prefix removed) and bold / italic.
 * Takes the loaded document so tests can use pdf.js' Node build.
 */

type RawItem = {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
};

type FontInfo = { name: string; bold: boolean; italic: boolean };

function cleanFontName(raw: string): string {
  return raw.replace(/^[A-Z]{6}\+/, "");
}

async function fontInfo(page: PDFPageProxy, fontName: string, family: string): Promise<FontInfo> {
  let name = family;
  let bold = false;
  let italic = false;
  try {
    const font = page.commonObjs.has(fontName)
      ? (page.commonObjs.get(fontName) as { name?: string; bold?: boolean; italic?: boolean; black?: boolean })
      : null;
    if (font?.name) name = cleanFontName(font.name);
    bold = Boolean(font?.bold || font?.black);
    italic = Boolean(font?.italic);
  } catch {
    // Font not loaded: fall back to the name.
  }
  bold ||= /bold|black|heavy|semibold|demi/i.test(name);
  italic ||= /italic|oblique|kursiv/i.test(name);
  return { name, bold, italic };
}

export async function pdfPageText(page: PDFPageProxy): Promise<PdfPageText> {
  const viewport = page.getViewport({ scale: 1 });
  // Loads the page's fonts into commonObjs, so their real names are known.
  await page.getOperatorList();
  const content = await page.getTextContent();
  const fonts = new Map<string, FontInfo>();
  const items: PdfTextItem[] = [];
  for (const raw of content.items as RawItem[]) {
    if (typeof raw.str !== "string" || raw.str === "") continue;
    const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = raw.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    if (!size) continue;
    let font = fonts.get(raw.fontName);
    if (!font) {
      const family = content.styles[raw.fontName]?.fontFamily ?? raw.fontName;
      font = await fontInfo(page, raw.fontName, family);
      fonts.set(raw.fontName, font);
    }
    const [x, y] = viewport.convertToViewportPoint(e, f) as [number, number];
    items.push({
      str: raw.str,
      x,
      y,
      width: raw.width,
      size,
      font: font.name,
      bold: font.bold,
      italic: font.italic,
    });
  }
  return { page: page.pageNumber, width: viewport.width, height: viewport.height, items };
}

export async function pdfDocumentText(doc: PDFDocumentProxy): Promise<PdfPageText[]> {
  const pages: PdfPageText[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    pages.push(await pdfPageText(page));
    page.cleanup();
  }
  return pages;
}
