// Golden files for export_html: exportHtml, exportVariant (flat JSON text),
// parseHtmlAttributes, tagMapFromStyles, resolveDisplayTitle.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exportHtml,
  exportVariant,
  parseHtmlAttributes,
  resolveDisplayTitle,
  tagMapFromStyles,
} from "../../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtures = join(root, "packages/core/tests/fixtures");
const out = join(root, "crates/prayer-core/tests/golden/export_html");
mkdirSync(join(out, "prayers"), { recursive: true });

const writeJson = (name, value) =>
  writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);

// --- input prayers ---------------------------------------------------------

const prayerFiles = ["valid-tropar-prokopios.json", "html-export-sample.json"];
for (const f of prayerFiles) copyFileSync(join(fixtures, f), join(out, "prayers", f));

const v = (lang, variant, title, license = "CC0", source = "test") => ({
  lang, variant, title, license, source,
});
const edge = {
  id: "edge-cases",
  type: "prayer",
  book: "a&b <book>",
  occasion: "it's \"quoted\"",
  tone: null,
  description: "Edge cases",
  variants: [
    v("de", "standard", "Ü <Titel> & \"Quote\" 'apos'", "L&L", "src \"x\""),
    v("cu", "synodal-cyrl", "Тропарь"),
    v("en", "standard", "", "", ""),
    v("ja", "standard", "祈り 🙏"),
  ],
  structure: [
    {
      id: "h1", kind: "heading",
      translations: [
        { lang: "de", variant: "standard", text: "A <B> & \"C\" 'D'" },
        { lang: "cu", variant: "synodal-cyrl", text: "Слава Отцу и Сыну" },
        { lang: "ja", variant: "standard", text: "栄光 🙏" },
      ],
    },
    {
      id: "n1", kind: "annotation",
      translations: [
        {
          lang: "de", variant: "standard",
          text: [
            { t: "text", v: "Vor " },
            { t: "note", v: "<Rubrik> & \"x\"" },
            { t: "text", v: " nach" },
          ],
        },
        { lang: "cu", variant: "synodal-cyrl", text: "" },
      ],
    },
    {
      id: "v1", kind: "verse",
      translations: [
        { lang: "de", variant: "standard", lines: ["a & b", "", [{ t: "note", v: "n" }], []] },
        { lang: "cu", variant: "synodal-cyrl", lines: [] },
        { lang: "ja", variant: "standard", lines: ["一", "二"] },
      ],
    },
    {
      id: "c1", kind: "my-custom-kind",
      translations: [
        { lang: "de", variant: "standard", text: "custom" },
        { lang: "en", variant: "standard", text: [{ t: "note", v: "only note" }] },
      ],
    },
    {
      id: "both", kind: "verse",
      translations: [
        { lang: "de", variant: "standard", text: "text and", lines: ["lines"] },
      ],
    },
    { id: "none", kind: "verse", translations: [] },
    {
      id: "nokeys", kind: "annotation",
      translations: [{ lang: "ja", variant: "standard" }],
    },
  ],
  meta: { custom: { saint: "x", n: 3, flag: true, nothing: null } },
};
writeJson("prayers/edge-cases.json", edge);
const noMetaPrayer = {
  id: "plain",
  type: "troparion",
  variants: [v("de", "standard", "Plain")],
  structure: [],
};
writeJson("prayers/empty-structure.json", noMetaPrayer);
const allPrayers = [...prayerFiles, "edge-cases.json", "empty-structure.json"];

// --- export cases ------------------------------------------------------------

const defaultTags = { heading: "h2", annotation: "p", verse: "p" };
const tagMaps = {
  none: {},
  default: defaultTags,
  odd: { heading: "script", verse: "blockquote", annotation: "article", "my-custom-kind": "span" },
};
const wrappers = {
  none: undefined,
  disabled: { enabled: false, tag: "section", attributes: { class: "x" } },
  enabled: { enabled: true },
  section: { enabled: true, tag: "section" },
  body: { enabled: true, tag: "body" },
  article: { enabled: true, tag: "article" },
  override: {
    enabled: true,
    attributes: {
      "data-title": "Override", class: "prayer", "data-x": "a'b\"c<d>&",
      id: "nope", "data-id": "nope", zeta: "z", alpha: "a", "data-book": "B", "data-tone": "9",
      lang: "xx", "data-occasion": "",
    },
  },
};

const cases = [];
for (const file of allPrayers) {
  const prayer = JSON.parse(readFileSync(join(out, "prayers", file), "utf8"));
  const variants = [
    ...prayer.variants.map((m) => [m.lang, m.variant]),
    ["fr", "missing"],
  ];
  for (const [lang, variant] of variants) {
    for (const [tagName, tagMap] of Object.entries(tagMaps)) {
      for (const [wrapName, wrapper] of Object.entries(wrappers)) {
        for (const includeEmpty of [false, true]) {
          const options = { lang, variant, tagMap };
          if (wrapper) options.wrapper = wrapper;
          if (includeEmpty) options.includeBlocksWithoutTranslation = true;
          let expected;
          try {
            expected = { html: exportHtml(prayer, options) };
          } catch (e) {
            expected = { error: e.message };
          }
          cases.push({ name: `${file} ${lang}/${variant} tags=${tagName} wrapper=${wrapName} empty=${includeEmpty}`, prayer: file, options, expected });
        }
      }
    }
  }
}
writeJson("html_cases.json", cases);

const flatCases = [];
for (const file of allPrayers) {
  const prayer = JSON.parse(readFileSync(join(out, "prayers", file), "utf8"));
  const variants = [...prayer.variants.map((m) => [m.lang, m.variant]), ["fr", "missing"]];
  for (const [lang, variant] of variants) {
    for (const includeEmpty of [false, true]) {
      const options = { lang, variant, includeBlocksWithoutTranslation: includeEmpty };
      let expected;
      try {
        expected = { json: `${JSON.stringify(exportVariant(prayer, options), null, 2)}\n` };
      } catch (e) {
        expected = { error: e.message };
      }
      flatCases.push({ name: `${file} ${lang}/${variant} empty=${includeEmpty}`, prayer: file, options, expected });
    }
  }
}
writeJson("flat_cases.json", flatCases);

// --- parseHtmlAttributes ---------------------------------------------------

const attrInputs = [
  "", "  ", 'class="prayer" data-x="1"', "a='x y' b=z hidden", 'c = "" d= "e"',
  'onclick="x" style="color:red" class="ok"', "ONCLICK=1 Style=2", "one=1 only", "data-on=1",
  "1x a=\"b\"", 'a="b', "a=", "a==b", "a=<b>", "a=b=c", 'a="b"c="d"', 'a="b""c"',
  "a=1 b=2 a=3", "x:y.z-w_v=1", "-bad ok", "a b c=1", "a\u0085b", "﻿a=1﻿",
  "α=1", "a=ü b='日本'", 'a="x\ny"', "a =b", "a= 'b' c",
  "a=`b`", "a='b\"c'", "= a", "a b c", "a=\"1\" , b",
];
writeJson("attribute_cases.json", attrInputs.map((input) => ({ input, expected: parseHtmlAttributes(input) })));

// --- tagMapFromStyles --------------------------------------------------------

const base = { fontSize: "12pt", color: "#000000", fontWeight: "normal", fontStyle: "normal" };
const styleSets = [
  {
    heading: { ...base, htmlTag: "h2" },
    verse: { ...base, htmlTag: "script" },
    custom: { ...base },
    annotation: { ...base, htmlTag: "p" },
    empty: { ...base, htmlTag: "" },
    article: { ...base, htmlTag: "article" },
    zed: { ...base, htmlTag: "span", textAlign: "center" },
  },
  {},
];
writeJson("tag_map_cases.json", styleSets.map((styles) => ({ styles, expected: tagMapFromStyles(styles) })));

// --- resolveDisplayTitle -------------------------------------------------------

const titled = {
  id: "tropar",
  variants: [v("de", "standard", "Tropar"), v("cu", "synodal-cyrl", "Тропарь"), v("en", "standard", "")],
};
const emptyFirst = { id: "emptyfirst", variants: [v("de", "standard", ""), v("cu", "x", "Second")] };
const prefs = [undefined, null, { lang: "cu", variant: "synodal-cyrl" }, { lang: "en", variant: "standard" }, { lang: "fr", variant: "standard" }];
const titleCases = [];
for (const prayer of [titled, emptyFirst, { id: "orphan", variants: [] }]) {
  for (const preferred of prefs) {
    titleCases.push({ prayer, preferred: preferred ?? null, expected: resolveDisplayTitle(prayer, preferred) });
  }
}
writeJson("display_title_cases.json", titleCases);
console.log(`export_html golden: ${cases.length} html, ${flatCases.length} flat`);
