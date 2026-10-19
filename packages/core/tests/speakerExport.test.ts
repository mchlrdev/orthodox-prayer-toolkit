import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  buildLayoutStory,
  exportHtml,
  exportLayoutDocx,
  exportLayoutDocxParallel,
  exportLayoutRtf,
  exportVariant,
  validate,
} from "../src/index.js";
import type { Prayer } from "../src/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

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
    files[name] = (
      method === 0 ? compressed : inflateRawSync(compressed)
    ).toString("utf8");
    offset = dataStart + compSize;
  }
  return files;
}

const DE = { lang: "de", variant: "standard" };
const AR = { lang: "ar", variant: "standard" };

function tr(v: { lang: string; variant: string }, text: string) {
  return { ...v, text };
}

function prayer(): Prayer {
  return {
    formatVersion: 2,
    id: "dialog",
    type: "prayer",
    variants: [
      {
        ...DE,
        title: "Dialog",
        license: "CC0",
        source: "test",
        speakers: {
          priest: { name: "Priester", short: "Pr" },
          people: { short: "V" },
        },
      },
      {
        ...AR,
        title: "Dialog",
        license: "CC0",
        source: "test",
        rtl: true,
        speakers: { priest: { name: "الكاهن" } },
      },
    ],
    structure: [
      {
        id: "h",
        kind: "heading",
        translations: [tr(DE, "Gruss"), tr(AR, "تحية")],
      },
      {
        id: "b1",
        kind: "verse",
        speaker: "priest",
        translations: [tr(DE, "Friede <allen>"), tr(AR, "سلام")],
      },
      {
        id: "b2",
        kind: "verse",
        speaker: "people",
        translations: [tr(DE, "Und mit deinem Geist"), tr(AR, "ومع روحك")],
      },
      {
        id: "b3",
        kind: "verse",
        speaker: "priest",
        translations: [
          {
            ...DE,
            lines: ["Lasset uns beten", "zum Herrn"],
          },
        ],
      },
    ],
  };
}

function plain(): Prayer {
  const r = validate(
    JSON.parse(readFileSync(join(fixturesDir, "html-export-sample.json"), "utf8")),
  );
  if (!r.ok) throw new Error("fixture");
  return r.prayer;
}

describe("exportHtml speakers", () => {
  it("renders inline label by default with data-speaker", () => {
    const html = exportHtml(prayer(), { ...DE });
    expect(html).toContain(
      '<div data-kind="verse" data-speaker="priest" dir="ltr"><span data-role="speaker">Priester:</span> Friede &lt;allen&gt;</div>',
    );
    // fallback to title-cased id when no name; heading has no speaker
    expect(html).toContain('<span data-role="speaker">People:</span> Und');
    expect(html).toContain('<div data-kind="heading" dir="ltr">Gruss</div>');
  });

  it("supports short form, custom separator and column as inline", () => {
    const html = exportHtml(prayer(), {
      ...DE,
      speakers: { form: "short", separator: " - ", placement: "column" },
    });
    expect(html).toContain('<span data-role="speaker">Pr -</span> Friede');
    expect(html).toContain('<span data-role="speaker">V -</span> Und');
  });

  it("short falls back to first letter of the name", () => {
    const html = exportHtml(prayer(), {
      ...AR,
      speakers: { form: "short" },
    });
    expect(html).toContain('<span data-role="speaker">ا:</span>');
    expect(html).toContain('dir="rtl"');
  });

  it("off emits no speaker markup", () => {
    const html = exportHtml(prayer(), { ...DE, speakers: { placement: "off" } });
    expect(html).not.toContain("speaker");
  });

  it("empty separator still adds a single space", () => {
    const html = exportHtml(prayer(), { ...DE, speakers: { separator: "" } });
    expect(html).toContain('<span data-role="speaker">Priester</span> Friede');
  });

  it("is unchanged for prayers without speakers", () => {
    const p = plain();
    const base = { lang: "de", variant: "standard" };
    expect(exportHtml(p, base)).toBe(
      exportHtml(p, { ...base, speakers: { placement: "off" } }),
    );
    expect(exportHtml(p, base)).not.toContain("speaker");
  });
});

describe("exportLayoutRtf speakers", () => {
  it("allocates sequential character styles and renders inline", () => {
    const rtf = exportLayoutRtf(prayer(), { ...DE, prefixStem: "opt" });
    expect(rtf).toContain("{\\*\\cs10 opt_note;}");
    expect(rtf).toContain("{\\*\\cs11 opt_speaker_priest;}");
    expect(rtf).toContain("{\\*\\cs12 opt_speaker_people;}");
    expect(rtf).toContain("{\\cs11 Priester:} Friede");
    expect(rtf).toContain("{\\cs12 People:} Und mit");
    // label only on the first line
    expect(rtf).toContain("{\\cs11 Priester:} Lasset uns beten\\line zum Herrn");
  });

  it("applies form, separator and off; column is inline", () => {
    const short = exportLayoutRtf(prayer(), {
      ...DE,
      speakers: { form: "short", separator: ". ", placement: "column" },
    });
    expect(short).toContain("{\\cs11 Pr.} Friede");
    const off = exportLayoutRtf(prayer(), {
      ...DE,
      speakers: { placement: "off" },
    });
    expect(off).not.toContain("speaker");
    expect(off).not.toContain("cs11");
  });

  it("keeps cs10 and output stable without speakers", () => {
    const p = plain();
    const a = exportLayoutRtf(p, { lang: "de", variant: "standard" });
    const b = exportLayoutRtf(p, {
      lang: "de",
      variant: "standard",
      speakers: { placement: "off" },
    });
    expect(a).toBe(b);
    expect(a).toContain("\\cs10");
    expect(a).not.toContain("cs11");
  });

  it("uses the exported variant's label (RTL)", () => {
    const rtf = exportLayoutRtf(prayer(), { ...AR, prefixStem: "opt" });
    expect(rtf).toContain("{\\*\\cs11 opt_speaker_priest;}");
    expect(rtf).toContain("\\u1575?\\u1604?\\u1603?\\u1575?\\u1607?\\u1606?:}");
    expect(rtf).toContain("People:}"); // no Arabic label: title-cased id
  });
});

describe("layout model", () => {
  it("lists note then speakers in first-use order", () => {
    const story = buildLayoutStory(prayer(), { ...DE, prefixStem: "x" });
    expect(story.noteStyleName).toBe("x_note");
    expect(story.characterStyles).toEqual([
      "x_note",
      "x_speaker_priest",
      "x_speaker_people",
    ]);
    expect(story.paragraphs[1]!.speaker).toEqual({
      id: "priest",
      label: "Priester",
      styleName: "x_speaker_priest",
    });
    expect(story.paragraphs[0]!.speaker).toBeUndefined();
  });
});

describe("exportLayoutDocx speakers", () => {
  it("renders inline runs and defines a character style per speaker", async () => {
    const files = unzipTexts(
      await exportLayoutDocx(prayer(), { ...DE, prefixStem: "opt" }),
    );
    const doc = files["word/document.xml"]!;
    const styles = files["word/styles.xml"]!;
    expect(doc).toContain('<w:rStyle w:val="opt_speaker_priest"/>');
    expect(doc).toContain("Priester:");
    expect(doc).not.toContain("<w:tbl>");
    for (const id of ["opt_note", "opt_speaker_priest", "opt_speaker_people"]) {
      expect(styles).toContain(`w:styleId="${id}"`);
    }
    expect(styles).not.toContain("speaker_priest_rtl");
    // styled run + plain single-space run
    expect(doc).toMatch(/Priester:<\/w:t><\/w:r><w:r><w:t xml:space="preserve"> <\/w:t>/);
  });

  it("form short, off and RTL variant", async () => {
    const short = unzipTexts(
      await exportLayoutDocx(prayer(), { ...DE, speakers: { form: "short" } }),
    )["word/document.xml"]!;
    expect(short).toContain("Pr:");
    const off = unzipTexts(
      await exportLayoutDocx(prayer(), { ...DE, speakers: { placement: "off" } }),
    );
    expect(off["word/document.xml"]).not.toContain("Priester");
    expect(off["word/styles.xml"]).not.toContain("speaker_");
    const rtl = unzipTexts(await exportLayoutDocx(prayer(), { ...AR, prefixStem: "opt" }));
    expect(rtl["word/document.xml"]).toContain("الكاهن:");
    expect(rtl["word/styles.xml"]).toContain("opt_heading_rtl");
  });

  it("column placement builds a Speaker | Text table", async () => {
    const files = unzipTexts(
      await exportLayoutDocx(prayer(), {
        ...DE,
        prefixStem: "opt",
        speakers: { placement: "column" },
      }),
    );
    const doc = files["word/document.xml"]!;
    expect(doc.match(/<w:tr>|<w:tr /g)).toHaveLength(4);
    expect(doc).toContain('<w:gridCol w:w="1440"/>');
    expect(doc).toContain('<w:gridCol w:w="7920"/>');
    // label without separator, in its character style; no inline lead
    expect(doc).toContain("Priester");
    expect(doc).not.toContain("Priester:");
    expect(doc).toContain('<w:rStyle w:val="opt_speaker_priest"/>');
    expect(files["word/styles.xml"]).toContain('w:styleId="opt_speaker_people"');
  });

  it("column placement without any speaker yields the plain story", async () => {
    const p = plain();
    const a = unzipTexts(
      await exportLayoutDocx(p, { lang: "de", variant: "standard" }),
    )["word/document.xml"];
    const b = unzipTexts(
      await exportLayoutDocx(p, {
        lang: "de",
        variant: "standard",
        speakers: { placement: "column" },
      }),
    )["word/document.xml"];
    expect(b).toBe(a);
    expect(a).not.toContain("<w:tbl>");
  });

  it("output without speakers is independent of speaker options", async () => {
    const p = plain();
    const o = { lang: "de", variant: "standard" };
    const a = unzipTexts(await exportLayoutDocx(p, o));
    const b = unzipTexts(
      await exportLayoutDocx(p, { ...o, speakers: { placement: "off" } }),
    );
    expect(b["word/document.xml"]).toBe(a["word/document.xml"]);
    expect(b["word/styles.xml"]).toBe(a["word/styles.xml"]);
  });
});

describe("exportLayoutDocxParallel speakers", () => {
  const columns: [typeof DE, typeof AR] = [DE, AR];

  it("inline-left (default) labels only the left side", async () => {
    const doc = unzipTexts(
      await exportLayoutDocxParallel(prayer(), { columns }),
    )["word/document.xml"]!;
    expect(doc).toContain("Priester:");
    expect(doc).not.toContain("الكاهن:");
  });

  it("inline-both labels each side with its own variant", async () => {
    const files = unzipTexts(
      await exportLayoutDocxParallel(prayer(), {
        columns,
        prefixStem: "opt",
        speakers: { placement: "inline-both" },
      }),
    );
    const doc = files["word/document.xml"]!;
    expect(doc).toContain("Priester:");
    expect(doc).toContain("الكاهن:");
    expect(files["word/styles.xml"]).toContain('w:styleId="opt_speaker_priest"');
  });

  it("off removes labels and styles", async () => {
    const files = unzipTexts(
      await exportLayoutDocxParallel(prayer(), {
        columns,
        speakers: { placement: "off" },
      }),
    );
    expect(files["word/document.xml"]).not.toContain("Priester");
    expect(files["word/styles.xml"]).not.toContain("speaker_");
  });

  it("column adds a first Speaker column from the left variant only", async () => {
    const files = unzipTexts(
      await exportLayoutDocxParallel(prayer(), {
        columns,
        speakers: { placement: "column" },
      }),
    );
    const doc = files["word/document.xml"]!;
    expect(doc).toContain('<w:gridCol w:w="1440"/>');
    expect(doc.match(/<w:gridCol /g)).toHaveLength(3);
    expect(doc.match(/<w:gridCol w:w="3960"\/>/g)).toHaveLength(2);
    expect(doc).toContain("Priester");
    expect(doc).not.toContain("الكاهن");
    expect(doc).not.toContain("Priester:");
    // 4 rows x 3 cells
    expect(doc.match(/<w:tc>/g)).toHaveLength(12);
  });

  it("column with gutter has four columns", async () => {
    const doc = unzipTexts(
      await exportLayoutDocxParallel(prayer(), {
        columns,
        gutterColumn: true,
        speakers: { placement: "column" },
      }),
    )["word/document.xml"]!;
    expect(doc.match(/<w:gridCol /g)).toHaveLength(4);
    expect(doc).toContain('<w:gridCol w:w="3600"/>');
    expect(doc).toContain('<w:gridCol w:w="720"/>');
  });

  it("column without speakers keeps the two-column table", async () => {
    const r = validate(
      JSON.parse(
        readFileSync(join(fixturesDir, "parallel-layout-sample.json"), "utf8"),
      ),
    );
    if (!r.ok) throw new Error("fixture");
    const c: [typeof DE, { lang: string; variant: string }] = [
      DE,
      { lang: "en", variant: "standard" },
    ];
    const a = unzipTexts(
      await exportLayoutDocxParallel(r.prayer, { columns: c }),
    )["word/document.xml"];
    const b = unzipTexts(
      await exportLayoutDocxParallel(r.prayer, {
        columns: c,
        speakers: { placement: "column" },
      }),
    )["word/document.xml"];
    expect(b).toBe(a);
  });
});

describe("exportVariant speakers", () => {
  it("carries speaker per block and the variant's speakers map", () => {
    const flat = exportVariant(prayer(), { ...DE });
    expect(flat.structure.find((b) => b.id === "b1")?.speaker).toBe("priest");
    expect(flat.structure.find((b) => b.id === "h")).not.toHaveProperty("speaker");
    expect(flat.speakers).toEqual({
      priest: { name: "Priester", short: "Pr" },
      people: { short: "V" },
    });
  });

  it("omits speakers when absent", () => {
    const flat = exportVariant(plain(), { lang: "de", variant: "standard" });
    expect(flat).not.toHaveProperty("speakers");
  });
});
