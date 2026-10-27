import JSZip from "jszip";

/**
 * Minimal .docx writer for Reader tests: the body XML (paragraphs, tables)
 * and the styles XML are given as WordprocessingML snippets.
 */

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

export function stylesXml(styles: string, defaults = ""): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr>${defaults}</w:rPr></w:rPrDefault></w:docDefaults>${styles}</w:styles>`;
}

export async function makeDocx(body: string, styles?: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file("word/document.xml", documentXml(body));
  if (styles) zip.file("word/styles.xml", styles);
  return zip.generateAsync({ type: "uint8array" });
}
