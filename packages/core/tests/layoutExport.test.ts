import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_KIND_STYLE,
  buildLayoutPairStory,
  exportLayoutDocx,
  exportLayoutDocxParallel,
  exportLayoutRtf,
  validate,
} from "../src/index.js";
import type { Prayer } from "../src/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

/** Minimal ZIP local-file scan for DOCX inspection in tests. */
function unzipTexts(buf: Uint8Array): Record<string, string> {
  const files: Record<string, string> = {};
  const view = Buffer.from(buf);
  let offset = 0;
  while (offset + 30 <= view.length) {
    if (view.readUInt32LE(offset) !== 0x04034b50) break;
    const method = view.readUInt16LE(offset + 8);
    const compSize = view.readUInt32LE(offset + 18);
    const nameLen = view.readUInt16LE(offset + 26);
    const extraLen = view.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = view.subarray(nameStart, nameStart + nameLen).toString("utf8");
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = view.subarray(dataStart, dataStart + compSize);
    const data =
      method === 0
        ? compressed
        : inflateRawSync(compressed);
    files[name] = data.toString("utf8");
    offset = dataStart + compSize;
  }
  return files;
}

describe("exportLayoutRtf", () => {
  it("exports blank styles, soft breaks, and note character style", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const rtf = exportLayoutRtf(validated.prayer, {
      lang: "de",
      variant: "standard",
      prefixStem: "opt",
    });

    expect(rtf).toContain("{\\s1 opt_heading;}");
    expect(rtf).toContain("{\\s2 opt_annotation;}");
    expect(rtf).toContain("{\\s3 opt_verse;}");
    expect(rtf).toContain("{\\*\\cs10 opt_note;}");
    expect(rtf).toContain("Trisagion");
    expect(rtf).toContain("\\line ");
    expect(rtf).toMatch(/\{\\cs10 [^}]*Starker/);
    expect(rtf).not.toMatch(/\{\\cs10 [^}]*Trisagion/);
    expect(rtf).not.toMatch(/\{\\s\d+\\f\d+\\fs\d+/);
    expect(rtf).not.toMatch(/\{\\*\\cs\d+\\i /);
    expect(rtf).not.toContain("Probegebet");
    expect(rtf).not.toContain("CC0");
  });

  it("omits blocks without translation by default", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const rtf = exportLayoutRtf(validated.prayer, {
      lang: "en",
      variant: "standard",
      prefixStem: "",
    });
    expect(rtf).toContain("{\\s1 verse;}");
    expect(rtf).not.toContain("heading");
    expect(rtf).not.toContain("annotation");
    expect(rtf).toContain("Holy God");
  });

  it("keeps empty styled paragraphs when includeBlocksWithoutTranslation", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const rtf = exportLayoutRtf(validated.prayer, {
      lang: "en",
      variant: "standard",
      prefixStem: "opt",
      includeBlocksWithoutTranslation: true,
    });
    expect(rtf).toContain("{\\s1 opt_heading;}");
    expect(rtf).toContain("{\\s2 opt_annotation;}");
    expect(rtf).toContain("{\\pard\\s1 \\par}");
    expect(rtf).toContain("{\\pard\\s2 \\par}");
    expect(rtf).toContain("Holy God");
  });

  it("uses bare style names when prefix stem is empty", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const rtf = exportLayoutRtf(validated.prayer, {
      lang: "de",
      variant: "standard",
      prefixStem: "",
    });
    expect(rtf).toContain("{\\s1 heading;}");
    expect(rtf).toContain("{\\*\\cs10 note;}");
    expect(rtf).not.toContain("opt_");
  });
});

describe("exportLayoutDocx", () => {
  it("exports blank styles, soft breaks, and note character style", async () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const bytes = await exportLayoutDocx(validated.prayer, {
      lang: "de",
      variant: "standard",
      prefixStem: "opt",
    });
    const files = unzipTexts(bytes);
    const styles = files["word/styles.xml"] ?? "";
    const document = files["word/document.xml"] ?? "";

    expect(styles).toContain('w:styleId="opt_heading"');
    expect(styles).toContain('w:styleId="opt_annotation"');
    expect(styles).toContain('w:styleId="opt_verse"');
    expect(styles).toContain('w:styleId="opt_note"');
    expect(styles).not.toMatch(
      /w:styleId="opt_note"[\s\S]*?<w:i\b/,
    );
    expect(document).toContain("Trisagion");
    expect(document).toContain("<w:br/>");
    expect(document).toContain('w:rStyle w:val="opt_note"');
    expect(document).toContain('w:pStyle w:val="opt_heading"');
    expect(document).toContain("Starker");
    expect(document).not.toContain("Probegebet");
  });

  it("keeps empty paragraphs when includeBlocksWithoutTranslation", async () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const bytes = await exportLayoutDocx(validated.prayer, {
      lang: "en",
      variant: "standard",
      prefixStem: "opt",
      includeBlocksWithoutTranslation: true,
    });
    const files = unzipTexts(bytes);
    const document = files["word/document.xml"] ?? "";
    expect(document).toContain('w:pStyle w:val="opt_heading"');
    expect(document).toContain('w:pStyle w:val="opt_annotation"');
    expect(document).toContain("Holy God");
  });

  it("uses bare style names when prefix stem is empty", async () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const bytes = await exportLayoutDocx(validated.prayer, {
      lang: "de",
      variant: "standard",
      prefixStem: "",
    });
    const files = unzipTexts(bytes);
    const styles = files["word/styles.xml"] ?? "";
    expect(styles).toContain('w:styleId="heading"');
    expect(styles).toContain('w:styleId="note"');
    expect(styles).not.toContain("opt_");
  });
});

const rtlPrayer = (): Prayer => ({
  id: "rtl-layout",
  type: "prayer",
  variants: [
    {
      lang: "ar",
      variant: "standard",
      title: "ت",
      license: "u",
      source: "s",
      rtl: true,
    },
  ],
  structure: [
    {
      id: "v1",
      kind: "verse",
      translations: [{ lang: "ar", variant: "standard", lines: ["نص"] }],
    },
  ],
});

describe("layout RTL style names", () => {
  it("suffixes paragraph styles with _rtl and leaves note unsuffixed", () => {
    const rtf = exportLayoutRtf(rtlPrayer(), {
      lang: "ar",
      variant: "standard",
      prefixStem: "opt",
    });
    expect(rtf).toContain("{\\s1 opt_verse_rtl;}");
    expect(rtf).toContain("{\\*\\cs10 opt_note;}");
    expect(rtf).not.toContain("opt_verse;}");
    expect(rtf).not.toContain("\\rtlpar");
  });

  it("suffixes only kinds whose effective dir is rtl", () => {
    const prayer: Prayer = {
      id: "mixed-dir",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "T",
          license: "u",
          source: "s",
        },
      ],
      structure: [
        {
          id: "h1",
          kind: "heading",
          translations: [{ lang: "de", variant: "standard", text: "Titel" }],
        },
        {
          id: "v1",
          kind: "verse",
          translations: [{ lang: "de", variant: "standard", lines: ["نص"] }],
        },
      ],
    };
    const rtf = exportLayoutRtf(prayer, {
      lang: "de",
      variant: "standard",
      prefixStem: "opt",
      styles: {
        heading: { ...FALLBACK_KIND_STYLE },
        verse: { ...FALLBACK_KIND_STYLE, dir: "rtl" },
      },
    });
    expect(rtf).toContain("opt_heading");
    expect(rtf).toContain("opt_verse_rtl");
  });
});

describe("buildLayoutPairStory", () => {
  it("keeps one row per shared block and empty cells for missing translations", () => {
    const validated = validate(loadJson("parallel-layout-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const story = buildLayoutPairStory(validated.prayer, {
      columns: [
        { lang: "de", variant: "standard" },
        { lang: "en", variant: "standard" },
      ],
      prefixStem: "opt",
    });

    expect(story.rows).toHaveLength(6);
    expect(story.rows.map((r) => r.kind)).toEqual([
      "heading",
      "annotation",
      "verse",
      "annotation",
      "verse",
      "verse",
    ]);
    expect(story.rows[3]?.left.lines.flat().map((r) => r.v).join("")).toContain(
      "Ehre sei dem Vater",
    );
    expect(story.rows[3]?.right.lines).toEqual([[]]);
    expect(story.rows[5]?.left.lines).toEqual([[]]);
    expect(story.rows[5]?.right.lines.flat().map((r) => r.v).join("")).toContain(
      "Our Father",
    );
  });
});

describe("exportLayoutDocxParallel", () => {
  it("writes a two-column table with kind styles, notes, and soft breaks", async () => {
    const validated = validate(loadJson("parallel-layout-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const bytes = await exportLayoutDocxParallel(validated.prayer, {
      columns: [
        { lang: "de", variant: "standard" },
        { lang: "en", variant: "standard" },
      ],
      prefixStem: "opt",
    });
    const files = unzipTexts(bytes);
    const styles = files["word/styles.xml"] ?? "";
    const document = files["word/document.xml"] ?? "";

    expect(document).toContain("<w:tbl>");
    expect(document).toContain("Heiliger Gott");
    expect(document).toContain("Holy God");
    expect(document).toContain("Our Father");
    expect(document).toContain("<w:br/>");
    expect(document).toContain('w:pStyle w:val="opt_heading"');
    expect(document).toContain('w:pStyle w:val="opt_verse"');
    expect(document).toContain('w:rStyle w:val="opt_note"');
    expect(document).toContain("Dann:");
    expect(document).toContain("Then:");
    expect(styles).toContain('w:styleId="opt_heading"');
    expect(styles).toContain('w:styleId="opt_note"');
    expect(document).not.toContain("Trisagion Prayers");
    expect(document).not.toContain("<w:cantSplit/>");
    expect(document).not.toContain("999999");
    expect(document).not.toContain('w:top="1134"');
    expect(document).toContain('w:tblW w:type="pct" w:w="100%"');
    expect(document).toMatch(/w:val="single"[^>]*w:sz="4"/);
    expect(document.match(/<w:gridCol/g)).toHaveLength(3);
    expect(document).toContain('<w:gridCol w:w="720"/>');
    expect(document).toMatch(/<w:tcW\b[^>]*\bw:w="720"/);
    expect(document).toMatch(/<w:tcW\b[^>]*\bw:w="4320"/);
  });

  it("omits the middle column when gutterColumn is false", async () => {
    const validated = validate(loadJson("parallel-layout-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const bytes = await exportLayoutDocxParallel(validated.prayer, {
      columns: [
        { lang: "de", variant: "standard" },
        { lang: "en", variant: "standard" },
      ],
      prefixStem: "opt",
      gutterColumn: false,
    });
    const files = unzipTexts(bytes);
    const document = files["word/document.xml"] ?? "";

    expect(document.match(/<w:gridCol/g)).toHaveLength(2);
  });

  it("inserts an empty middle column when gutterColumn is set", async () => {
    const validated = validate(loadJson("parallel-layout-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const bytes = await exportLayoutDocxParallel(validated.prayer, {
      columns: [
        { lang: "de", variant: "standard" },
        { lang: "en", variant: "standard" },
      ],
      prefixStem: "opt",
      gutterColumn: true,
    });
    const files = unzipTexts(bytes);
    const document = files["word/document.xml"] ?? "";

    expect(document.match(/<w:gridCol/g)).toHaveLength(3);
    expect(document).toContain('<w:gridCol w:w="720"/>');
    expect(document).toMatch(/<w:tcW\b[^>]*\bw:w="720"/);
    expect(document).toContain("Heiliger Gott");
    expect(document).toContain("Holy God");
  });
});
