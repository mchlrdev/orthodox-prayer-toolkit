// Golden files for kinds.rs, resolve_styles.rs and library.rs: indexKinds,
// indexVariants, renameKind, deleteKind, resolveStyles + defaults, library
// filename helpers, id collisions and manifest normalization.
//
// Each file is an array of cases `{ name, ...inputs, expected }`; the Rust
// test recomputes `expected` and compares the whole file byte for byte.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_KIND_STYLES,
  FALLBACK_KIND_STYLE,
  deleteKind,
  filenameMatchesId,
  findIdCollisions,
  indexKinds,
  indexVariants,
  isLibraryManifest,
  isPrayerFilename,
  normalizeLibraryManifest,
  prayerFilename,
  renameKind,
  resolveStyles,
} from "../../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "crates/prayer-core/tests/golden/kinds");
mkdirSync(out, { recursive: true });

const writeJson = (name, value) =>
  writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);

// --- prayers -----------------------------------------------------------------

const tropar = JSON.parse(
  readFileSync(
    join(root, "packages/core/tests/fixtures/valid-tropar-prokopios.json"),
    "utf8",
  ),
);

const v = (lang, variant, title = "T") => ({
  lang, variant, title, license: "unknown", source: "draft",
});
const block = (id, kind, text) => ({
  id,
  kind,
  translations: text === undefined ? [] : [{ lang: "de", variant: "standard", text }],
});
const prayer = (id, kinds, variants = [v("de", "standard")]) => ({
  id,
  type: "prayer",
  variants,
  structure: kinds.map((k, i) => block(`b${i + 1}`, k, `Text ${i + 1}`)),
});

const custom = {
  id: "custom",
  type: "prayer",
  variants: [v("de", "standard", "C")],
  structure: [block("x", "epistle-intro"), block("y", "annotation")],
};
const empty = { ...prayer("empty", []), structure: [] };
const mixedCase = prayer("mixed", [
  "b", "B", "a", "A", "a-b", "ab", "a_b", "a1", "1a", "Zeta", "alpha", "verse",
]);
const nonLatin = prayer("non-latin", ["стих", "Заголовок", "verse", "祈り", "heading"]);

// --- index_kinds ---------------------------------------------------------------

const kindCases = [
  ["unions kinds across prayers (core test)", [tropar, custom]],
  ["no prayers", []],
  ["prayer without blocks", [empty]],
  ["single prayer with repeats", [prayer("r", ["verse", "verse", "heading", "verse"])]],
  ["case, digits, hyphen and underscore ordering", [mixedCase]],
  ["non-latin kinds", [nonLatin]],
  ["order independent of input order", [custom, tropar, mixedCase]],
].map(([name, prayers]) => ({ name, prayers, expected: indexKinds(prayers) }));
writeJson("index_kinds.json", kindCases);

// --- index_variants --------------------------------------------------------------

const variantCases = [
  ["unions lang/variant pairs (core test)", [
    { variants: [v("de", "standard", "A"), v("en", "standard", "B")] },
    { variants: [v("de", "standard", "A again"), v("cu", "synodal-cyrl", "C")] },
  ]],
  ["no prayers", []],
  ["same lang, several variants", [
    { variants: [v("de", "standard"), v("de", "alt"), v("de", "Alt"), v("de", "alt-2")] },
  ]],
  ["fixtures", [tropar, custom]],
  ["case and non-ascii langs", [
    { variants: [v("Zh", "std"), v("zh", "std"), v("ja", "standard"), v("ру", "x")] },
  ]],
  ["prayer without variants", [{ variants: [] }, { variants: [v("en", "standard")] }]],
].map(([name, prayers]) => ({
  name,
  // Rust tests need full prayers: wrap the variants-only shapes.
  prayers: prayers.map((p) => (p.id ? p : { id: "p", type: "prayer", variants: p.variants, structure: [] })),
  expected: indexVariants(prayers),
}));
writeJson("index_variants.json", variantCases);

// --- rename_kind / delete_kind ---------------------------------------------------

const renameCases = [
  ["annotation to instruction (core test)", tropar, "annotation", "instruction"],
  ["same name is a no-op", tropar, "verse", "verse"],
  ["kind not present", tropar, "heading", "title"],
  ["rename onto an existing kind", tropar, "annotation", "verse"],
  ["rename to custom with hyphen", prayer("p", ["verse", "heading", "verse"]), "verse", "strophe-2"],
  ["empty prayer", empty, "verse", "x"],
  ["non-latin", nonLatin, "стих", "строфа"],
].map(([name, p, from, to]) => ({ name, prayer: p, from, to, expected: renameKind(p, from, to) }));
writeJson("rename_kind.json", renameCases);

const deleteCases = [
  ["annotation falls back to verse (core test)", tropar, "annotation", undefined],
  ["deleting verse falls back to annotation", tropar, "verse", undefined],
  ["explicit fallback", prayer("p", ["heading", "verse", "heading"]), "heading", "subheading"],
  ["kind equals explicit fallback", prayer("p", ["heading", "verse"]), "heading", "heading"],
  ["explicit fallback annotation, kind annotation", prayer("p", ["annotation", "verse"]), "annotation", "annotation"],
  ["kind not present", tropar, "heading", undefined],
  ["empty prayer", empty, "verse", undefined],
  ["custom kind", custom, "epistle-intro", undefined],
].map(([name, p, kind, fallback]) => ({
  name,
  prayer: p,
  kind,
  ...(fallback === undefined ? {} : { fallback }),
  expected: fallback === undefined ? deleteKind(p, kind) : deleteKind(p, kind, fallback),
}));
writeJson("delete_kind.json", deleteCases);

// --- styles -----------------------------------------------------------------------

// JS objects keep spread order; the Rust struct writes tokens in a fixed order.
// Style objects are normalized to that order here (token order carries no
// meaning). Kind order in a StyleMap is preserved as the TS core produced it.
const TOKEN_ORDER = [
  "fontSize", "color", "fontWeight", "fontStyle",
  "initialCap", "indicate", "htmlTag", "textAlign",
];
const canonStyle = (s) => {
  const o = {};
  for (const k of TOKEN_ORDER) if (s[k] !== undefined) o[k] = s[k];
  for (const k of Object.keys(s)) if (!(k in o)) o[k] = s[k];
  return o;
};
const canonMap = (m) =>
  Object.fromEntries(Object.entries(m).map(([k, s]) => [k, canonStyle(s)]));

writeJson("default_styles.json", {
  defaults: canonMap(DEFAULT_KIND_STYLES),
  fallback: canonStyle(FALLBACK_KIND_STYLE),
});

const s = (fontSize, color, fontWeight, fontStyle, more = {}) => ({
  fontSize, color, fontWeight, fontStyle, ...more,
});
const resolveCases = [
  ["defaults for presets, fallback for unknown (core test)", { discoveredKinds: ["annotation", "custom-kind"] }],
  ["no kinds at all", { discoveredKinds: [] }],
  ["duplicate discovered kinds", { discoveredKinds: ["verse", "verse", "x", "x"] }],
  ["app defaults without textAlign (core test)", {
    discoveredKinds: ["verse", "annotation"],
    appDefaults: {
      verse: s("1rem", "base", "400", "normal"),
      annotation: s("1rem", "accent", "400", "normal"),
    },
  }],
  ["library overrides win over app defaults (core test)", {
    discoveredKinds: ["verse"],
    appDefaults: { verse: s("2rem", "base", "700", "normal", { htmlTag: "div" }) },
    libraryOverrides: {
      verse: s("1.5rem", "accent", "400", "italic", { htmlTag: "blockquote" }),
    },
  }],
  ["partial library override (core test)", {
    discoveredKinds: ["verse"],
    libraryOverrides: { verse: { color: "#8b2942" } },
  }],
  ["partial app and library layers combine", {
    discoveredKinds: ["verse", "heading"],
    appDefaults: { verse: { fontSize: "2rem", textAlign: "left" }, heading: { indicate: "false" } },
    libraryOverrides: { verse: { fontWeight: "700" }, heading: { htmlTag: "h1" } },
  }],
  ["kinds only named in styles get entries, order of first mention", {
    discoveredKinds: ["zeta"],
    appDefaults: { alpha: { fontStyle: "italic" } },
    libraryOverrides: { beta: s("3rem", "accent", "700", "normal"), zeta: { color: "accent" } },
  }],
  ["custom default preset", {
    discoveredKinds: ["unknown", "verse"],
    libraryOverrides: { other: { fontWeight: "300" } },
    defaultPreset: s("2rem", "accent", "300", "italic", { textAlign: "center" }),
  }],
  ["unknown extra tokens are merged", {
    discoveredKinds: ["verse", "note"],
    appDefaults: { verse: { letterSpacing: "1px", wordSpacing: "2px" } },
    libraryOverrides: { verse: { letterSpacing: "2px", lineHeight: "1.5" }, note: { lineHeight: "2" } },
  }],
  ["non-ASCII kind ids", {
    discoveredKinds: ["стих", "祈り"],
    libraryOverrides: { "стих": { fontStyle: "italic" } },
  }],
  ["empty override objects change nothing", {
    discoveredKinds: ["verse"],
    appDefaults: { verse: {} },
    libraryOverrides: { verse: {}, heading: {} },
  }],
].map(([name, input]) => ({
  name,
  ...input,
  expected: canonMap(resolveStyles(input)),
}));
writeJson("resolve_styles.json", resolveCases);

// --- library filenames ---------------------------------------------------------------

const prayerPaths = [
  "trisagion.json",
  "manifest.json",
  "styles.json",
  ".orthodox-prayer-toolkit/styles.json",
  ".orthodox-prayer-toolkit/other.json",
  "sub/.orthodox-prayer-toolkit/styles.json",
  "sub\\.orthodox-prayer-toolkit\\styles.json",
  ".orthodox-prayer-toolkit\\styles.json",
  "sub/manifest.json",
  "sub\\manifest.json",
  "sub/styles.json",
  "a/b/c/prayer.json",
  "a\\b\\prayer.json",
  "notes.txt",
  "prayer.JSON",
  "prayer.json.bak",
  "prayer.jsonl",
  ".json",
  "dir.json/",
  "dir.json\\",
  "",
  "/",
  "/abs/path/x.json",
  "C:\\lib\\x.json",
  "./x.json",
  "../x.json",
  "x.json ",
  "Manifest.json",
  "my-manifest.json",
  "styles.json.json",
  ".orthodox-prayer-toolkit",
  "x/.orthodox-prayer-toolkit",
  ".orthodox-prayer-toolkit.json",
  "a/.orthodox-prayer-toolkitx/y.json",
  "тропарь.json",
  "祈り/祈り.json",
];
const ids = ["trisagion", "tropar-prokopios", "", "Ünï", "тропарь", "a.b", "a/b"];
const matchCases = [
  ["tropar-prokopios.json", "tropar-prokopios"],
  ["wrong.json", "tropar-prokopios"],
  ["sub/trisagion.json", "trisagion"],
  ["sub\\trisagion.json", "trisagion"],
  ["trisagion.json", "Trisagion"],
  ["trisagion.json.json", "trisagion"],
  ["тропарь.json", "тропарь"],
  [".json", ""],
  ["", ""],
  ["dir/", ""],
  ["a/b.json", "a/b"],
  ["a.b.json", "a.b"],
  ["x/Ünï.json", "Ünï"],
];
const collisionCases = [
  ["duplicate ids (core test)", [
    { path: "a/foo.json", id: "foo" },
    { path: "b/foo.json", id: "foo" },
    { path: "bar.json", id: "bar" },
  ]],
  ["no entries", []],
  ["unparseable files never collide", [
    { path: "a.json", id: null },
    { path: "b.json", id: null },
  ]],
  ["paths and ids sorted", [
    { path: "z/b.json", id: "b" },
    { path: "b.json", id: "b" },
    { path: "y.json", id: "A" },
    { path: "x.json", id: "A" },
    { path: "Z.json", id: "a" },
    { path: "z.json", id: "a" },
    { path: "k.json", id: "k" },
  ]],
  ["three-way collision with null mixed in", [
    { path: "c.json", id: "dup" },
    { path: "a.json", id: "dup" },
    { path: "x.json", id: null },
    { path: "b.json", id: "dup" },
  ]],
  ["id ordering like localeCompare", [
    { path: "1.json", id: "b" }, { path: "2.json", id: "b" },
    { path: "3.json", id: "a-b" }, { path: "4.json", id: "a-b" },
    { path: "5.json", id: "ab" }, { path: "6.json", id: "ab" },
    { path: "7.json", id: "a_b" }, { path: "8.json", id: "a_b" },
    { path: "9.json", id: "B" }, { path: "10.json", id: "B" },
  ]],
  ["same path twice with the same id", [
    { path: "a.json", id: "x" }, { path: "a.json", id: "x" },
  ]],
  ["non-latin ids and paths, astral vs BMP path order", [
    { path: "\u{1F64F}.json", id: "тропарь" },
    { path: "\uFF21.json", id: "тропарь" },
    { path: "я.json", id: "я" }, { path: "а.json", id: "я" },
  ]],
  ["empty id string is a real id", [
    { path: "a.json", id: "" }, { path: "b.json", id: "" },
  ]],
].map(([name, entries]) => ({ name, entries, expected: findIdCollisions(entries) }));

writeJson("library_filenames.json", {
  isPrayerFilename: prayerPaths.map((path) => ({ path, expected: isPrayerFilename(path) })),
  prayerFilename: ids.map((id) => ({ id, expected: prayerFilename(id) })),
  filenameMatchesId: matchCases.map(([path, id]) => ({
    path, id, expected: filenameMatchesId(path, id),
  })),
  findIdCollisions: collisionCases,
});

// --- manifest ---------------------------------------------------------------------------

const manifestInputs = [
  ["full manifest (core test)", { description: "Examples", defaultVariant: { lang: "de", variant: "standard" } }],
  ["empty object", {}],
  ["description only", { description: "notes only" }],
  ["empty description is kept", { description: "" }],
  ["description is a number", { description: 1 }],
  ["description is null", { description: null }],
  ["null manifest", null],
  ["array manifest", []],
  ["string manifest", "manifest"],
  ["number manifest", 3],
  ["stem lit", { stylePrefixStem: "lit" }],
  ["stem empty is dropped", { stylePrefixStem: "" }],
  ["stem starts with digit", { stylePrefixStem: "1bad" }],
  ["stem has underscore", { stylePrefixStem: "bad_stem" }],
  ["stem non-ascii letter", { stylePrefixStem: "büd" }],
  ["stem with trailing newline", { stylePrefixStem: "opt\n" }],
  ["stem is a number", { stylePrefixStem: 4 }],
  ["stem is null", { stylePrefixStem: null }],
  ["stem alphanumeric", { stylePrefixStem: "Lit2x" }],
  ["legacy keys stripped (core test)", {
    description: "Examples",
    defaultVariant: { lang: "de", variant: "standard" },
    name: "Old Title",
    version: "0.1.0",
  }],
  ["stem and description", { description: "x", stylePrefixStem: "opt" }],
  ["key order is normalized", {
    stylePrefixStem: "liturgy",
    defaultVariant: { variant: "standard", lang: "de" },
    description: "d",
  }],
  ["defaultVariant extra keys dropped", { defaultVariant: { lang: "de", variant: "standard", note: "x" } }],
  ["defaultVariant missing variant", { defaultVariant: { lang: "de" } }],
  ["defaultVariant missing lang", { defaultVariant: { variant: "standard" } }],
  ["defaultVariant lang not a string", { defaultVariant: { lang: 1, variant: "standard" } }],
  ["defaultVariant null", { defaultVariant: null }],
  ["defaultVariant is an array", { defaultVariant: [] }],
  ["defaultVariant is a string", { defaultVariant: "de" }],
  ["defaultVariant empty strings", { defaultVariant: { lang: "", variant: "" } }],
  ["non-ASCII description", { description: "Тропарь \u{1F64F} 祈り" }],
].map(([name, input]) => {
  const valid = isLibraryManifest(input);
  return {
    name,
    input,
    valid,
    ...(valid ? { expected: normalizeLibraryManifest(input) } : {}),
  };
});
writeJson("manifest.json", manifestInputs);
