/**
 * Minimal PDF writer for Reader tests: text runs in the standard Times
 * fonts (WinAnsi, so German umlauts work), one content stream per page.
 * Coordinates are points from the page's top-left corner, y = baseline.
 */

export type PdfRun = {
  font?: "regular" | "bold" | "italic";
  size?: number;
  x: number;
  y: number;
  text: string;
};

const FONTS = { regular: "F1", bold: "F2", italic: "F3" } as const;

function escape(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

export function makePdf(
  pages: PdfRun[][],
  { width = 420, height = 595 }: { width?: number; height?: number } = {},
): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add("");
  const pagesId = add("");
  const fontIds = {
    F1: add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>"),
    F2: add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>"),
    F3: add("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>"),
  };
  const fontDict = `<< ${Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(" ")} >>`;
  const pageIds: number[] = [];
  for (const runs of pages) {
    const stream = runs
      .map((r) => {
        const font = FONTS[r.font ?? "regular"];
        return `BT /${font} ${r.size ?? 11} Tf 1 0 0 1 ${r.x} ${height - r.y} Tm (${escape(r.text)}) Tj ET`;
      })
      .join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font ${fontDict} >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
