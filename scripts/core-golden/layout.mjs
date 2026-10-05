// Golden cases for crates/prayer-core/src/{layout,export_rtf,export_docx}.rs.
//
// Inputs: prayers copied to tests/golden/layout/inputs/. Outputs: one
// cases/<prayer>.json per prayer holding, for every Variant x style prefix
// stem x includeBlocksWithoutTranslation combination, the layout story, the
// RTF text and a normalized DOCX content summary (word/document.xml and
// word/styles.xml of the TS-generated file, reduced to a format-independent
// shape; the Rust test builds the same summary from its own DOCX).
//
// Known TS bug skipped: astral characters in RTF come out as one wrong signed
// value (`rtf: null` for the "layout-astral" prayer). The Rust port writes a
// surrogate pair per UTF-16 unit and tests that itself.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

import {
  buildLayoutStory,
  exportLayoutDocx,
  exportLayoutRtf,
} from "../../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "crates", "prayer-core", "tests", "golden", "layout");
mkdirSync(join(outDir, "inputs"), { recursive: true });
mkdirSync(join(outDir, "cases"), { recursive: true });

const writeJson = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");

const fixture = (name) =>
  JSON.parse(
    readFileSync(join(root, "packages/core/tests/fixtures", name), "utf8"),
  );

const T = (v) => ({ t: "text", v });
const N = (v) => ({ t: "note", v });
const tr = (lang, variant, body) => ({ lang, variant, ...body });
const variant = (lang, v, title) => ({
  lang,
  variant: v,
  title,
  license: "CC0",
  source: "golden",
});

/** Edge cases: escapes, non-Latin, notes, empty values, name collisions. */
const edge = {
  id: "layout-edge",
  type: "prayer",
  variants: [
    variant("de", "standard", "Rand"),
    variant("ru", "cu", "Край"),
    variant("el", "poly", "Άκρο"),
  ],
  structure: [
    {
      id: "b1",
      kind: "heading",
      translations: [
        tr("ru", "cu", { text: "Господи, помилуй {трижды} \\ & <b>" }),
        tr("de", "standard", { text: "Größe & \"Maß\" <ok>" }),
      ],
    },
    {
      id: "b2",
      kind: "verse",
      translations: [
        tr("ru", "cu", {
          lines: [
            "Слава Отцу и Сыну,",
            "",
            [T("и Святому "), N("(поклон)"), T(" Духу")],
            [N("только заметка")],
          ],
        }),
        tr("el", "poly", {
          lines: ["Κύριε ἐλέησον", [T("Δόξα "), N("ἀμήν"), T(" Πατρί")]],
        }),
      ],
    },
    {
      id: "b3",
      kind: "note",
      translations: [tr("de", "standard", { text: [N("Kind namens note")] })],
    },
    {
      id: "b4",
      kind: "annotation",
      translations: [tr("de", "standard", { text: "" })],
    },
    {
      id: "b5",
      kind: "annotation",
      translations: [tr("de", "standard", {})],
    },
    {
      id: "b6",
      kind: "verse",
      translations: [
        tr("de", "standard", { lines: [] }),
        tr("ru", "cu", { text: [] }),
        tr("el", "poly", { lines: [[T("")], [N("")]] }),
      ],
    },
    {
      id: "b7",
      kind: "verse",
      translations: [tr("el", "poly", { text: "ὁ Θεός  mit  Spaces " })],
    },
    {
      id: "b8",
      kind: "heading",
      translations: [tr("de", "standard", { text: "Ж ǆ ﬁ" })],
    },
  ],
};

const astral = {
  id: "layout-astral",
  type: "prayer",
  variants: [variant("en", "standard", "Dove")],
  structure: [
    {
      id: "a1",
      kind: "verse",
      translations: [
        tr("en", "standard", {
          lines: ["Dove \u{1F54A} and 𝔄", [T("x"), N("\u{1F600}")]],
        }),
      ],
    },
  ],
};

const prayers = [
  ["html-export-sample", fixture("html-export-sample.json")],
  ["valid-tropar-prokopios", fixture("valid-tropar-prokopios.json")],
  ["layout-edge", edge],
  ["layout-astral", astral],
];

// ---- DOCX normalization (mirrored by tests/layout.rs) ----

/** Minimal ZIP local-file scan (the TS core's DOCX has no data descriptors). */
function unzipTexts(buf) {
  const files = {};
  const view = Buffer.from(buf);
  let offset = 0;
  while (offset + 30 <= view.length) {
    if (view.readUInt32LE(offset) !== 0x04034b50) break;
    const method = view.readUInt16LE(offset + 8);
    const compSize = view.readUInt32LE(offset + 18);
    const nameLen = view.readUInt16LE(offset + 26);
    const extraLen = view.readUInt16LE(offset + 28);
    const name = view.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const compressed = view.subarray(dataStart, dataStart + compSize);
    files[name] = (method === 0 ? compressed : inflateRawSync(compressed)).toString("utf8");
    offset = dataStart + compSize;
  }
  return files;
}

const unescapeXml = (s) =>
  s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_, e) => {
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "amp") return "&";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return String.fromCodePoint(cp);
  });

/** Start/end/empty tags and text of an XML string, in order. */
function* xmlTokens(xml) {
  const re = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>|<[?!][^>]*>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    if (m[5] !== undefined) yield { text: unescapeXml(m[5]) };
    else if (m[2] === undefined) continue;
    else if (m[1]) yield { end: m[2] };
    else {
      const attrs = {};
      for (const a of m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1]] = unescapeXml(a[2]);
      yield { start: m[2], attrs, empty: m[4] === "/" };
    }
  }
}

/** Paragraphs: style id plus runs (text with character style, or a break). */
function summarizeDocument(xml) {
  const paragraphs = [];
  let para = null;
  let run = null;
  let inT = false;
  let text = "";
  for (const tok of xmlTokens(xml)) {
    if (tok.start === "w:p") {
      para = { style: null, runs: [] };
      paragraphs.push(para);
    } else if (tok.end === "w:p") para = null;
    else if (!para) continue;
    else if (tok.start === "w:pStyle") para.style = tok.attrs["w:val"];
    else if (tok.start === "w:r" && !tok.empty) run = { style: null, items: [] };
    else if (tok.end === "w:r") {
      for (const item of run.items) para.runs.push(item.break ? item : { text: item.text, style: run.style });
      run = null;
    } else if (!run) continue;
    else if (tok.start === "w:rStyle") run.style = tok.attrs["w:val"];
    else if (tok.start === "w:br") run.items.push({ break: true });
    else if (tok.start === "w:t") {
      if (tok.empty) run.items.push({ text: "" });
      else {
        inT = true;
        text = "";
      }
    } else if (tok.end === "w:t") {
      inT = false;
      run.items.push({ text });
    } else if (inT && tok.text !== undefined) text += tok.text;
  }
  return paragraphs;
}

/** Styles with the given ids: name, type, basedOn, next, run properties. */
function summarizeStyles(xml, ids) {
  const styles = [];
  const stack = [];
  let style = null;
  for (const tok of xmlTokens(xml)) {
    if (tok.start) {
      const parent = stack[stack.length - 1];
      if (tok.start === "w:style") {
        style = {
          id: tok.attrs["w:styleId"],
          name: null,
          type: tok.attrs["w:type"],
          basedOn: null,
          next: null,
          runProps: {},
        };
        styles.push(style);
      } else if (style && parent === "w:style") {
        if (tok.start === "w:name") style.name = tok.attrs["w:val"];
        if (tok.start === "w:basedOn") style.basedOn = tok.attrs["w:val"];
        if (tok.start === "w:next") style.next = tok.attrs["w:val"];
      } else if (style && parent === "w:rPr" && stack[stack.length - 2] === "w:style") {
        style.runProps[tok.start.replace(/^w:/, "")] = tok.attrs["w:val"] ?? true;
      }
      if (!tok.empty) stack.push(tok.start);
    } else if (tok.end) {
      stack.pop();
      if (tok.end === "w:style") style = null;
    }
  }
  return styles.filter((s) => ids.has(s.id));
}

function summarizeDocx(files, story) {
  const ids = new Set([story.noteStyleName, ...story.paragraphs.map((p) => p.styleName)]);
  return {
    paragraphs: summarizeDocument(files["word/document.xml"]),
    styles: summarizeStyles(files["word/styles.xml"], ids),
  };
}

// ---- cases ----

const stems = ["", "opt", "Place2"];
for (const [name, prayer] of prayers) {
  writeJson(join(outDir, "inputs", `${name}.json`), prayer);
  const cases = [];
  for (const v of prayer.variants) {
    for (const prefixStem of stems) {
      for (const includeBlocksWithoutTranslation of [false, true]) {
        const options = { lang: v.lang, variant: v.variant, prefixStem, includeBlocksWithoutTranslation };
        const story = buildLayoutStory(prayer, options);
        const docx = summarizeDocx(unzipTexts(await exportLayoutDocx(prayer, options)), story);
        cases.push({
          options,
          layout: story,
          rtf: name === "layout-astral" ? null : exportLayoutRtf(prayer, options),
          docx,
        });
      }
    }
  }
  // Omitted prefixStem / flag behave as "" / false.
  const bare = { lang: prayer.variants[0].lang, variant: prayer.variants[0].variant };
  cases.push({
    options: bare,
    layout: buildLayoutStory(prayer, bare),
    rtf: name === "layout-astral" ? null : exportLayoutRtf(prayer, bare),
    docx: summarizeDocx(unzipTexts(await exportLayoutDocx(prayer, bare)), buildLayoutStory(prayer, bare)),
  });
  writeJson(join(outDir, "cases", `${name}.json`), { prayer: `inputs/${name}.json`, cases });
}

// Error: unknown Variant.
writeJson(join(outDir, "cases", "errors.json"), {
  prayer: "inputs/html-export-sample.json",
  cases: [{ options: { lang: "fr", variant: "standard" }, error: 'Variant not found: lang="fr" variant="standard"' }],
});
