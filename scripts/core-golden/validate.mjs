// Golden cases for validate / validateStyles / sanitizeStyles / kind ids.
// Writes crates/prayer-core/tests/golden/validate/*.json from the TS core.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_KIND_STYLES,
  KIND_ID_MAX_LENGTH,
  isValidKindId,
  sanitizeKindIdInput,
  sanitizeStyles,
  validate,
  validateStyles,
} from "../../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtures = join(root, "packages/core/tests/fixtures");
const outDir = join(root, "crates/prayer-core/tests/golden/validate");
mkdirSync(outDir, { recursive: true });

const load = (name) => JSON.parse(readFileSync(join(fixtures, name), "utf8"));
const clone = (v) => JSON.parse(JSON.stringify(v));
const write = (name, data) =>
  writeFileSync(join(outDir, name), JSON.stringify(data, null, 2) + "\n");

// ---------------------------------------------------------------- prayers

const variant = (lang, v, title = "T") => ({
  lang,
  variant: v,
  title,
  license: "unknown",
  source: "draft",
});
const minimal = (over = {}) => ({
  id: "x",
  type: "prayer",
  variants: [variant("de", "standard")],
  structure: [{ id: "b1", kind: "verse", translations: [] }],
  ...over,
});
const withTr = (tr) =>
  minimal({
    structure: [
      {
        id: "b1",
        kind: "verse",
        translations: [{ lang: "de", variant: "standard", ...tr }],
      },
    ],
  });

/** Rich valid prayer: notes, lines, tone, meta, optional strings. */
const rich = {
  id: "rich-sample",
  type: "troparion",
  book: "menaion",
  occasion: "feast",
  description: "Beschreibung",
  tone: 4,
  variants: [
    variant("de", "standard", "Titel"),
    variant("cu", "synodal-cyrl", "Тропарь"),
  ],
  structure: [
    {
      id: "h1",
      kind: "heading",
      translations: [{ lang: "de", variant: "standard", text: "Überschrift" }],
    },
    {
      id: "v1",
      kind: "verse",
      translations: [
        {
          lang: "de",
          variant: "standard",
          lines: [
            "Erste Zeile",
            [
              { t: "text", v: "Zweite " },
              { t: "note", v: "(dreimal)" },
            ],
          ],
        },
        {
          lang: "cu",
          variant: "synodal-cyrl",
          text: [
            { t: "note", v: "Глас 4" },
            { t: "text", v: " Слава" },
          ],
        },
      ],
    },
  ],
  meta: { custom: { saint_id: "x", rank: 3, published: true, note: null } },
};

/** @type {{name: string, input: unknown}[]} */
const cases = [];
const add = (name, input) => cases.push({ name, input: clone(input) });

// Cases from packages/core/tests/core.test.ts
const tropar = load("valid-tropar-prokopios.json");
add("test-valid-fixture", tropar);
add("test-html-export-sample", load("html-export-sample.json"));
add("test-missing-id", {
  type: "prayer",
  variants: [variant("de", "standard", "X")],
  structure: [{ id: "b1", kind: "verse", translations: [] }],
});
add("test-empty-text", withTr({ text: "" }));
add("test-partial-translations", {
  id: "partial",
  type: "prayer",
  variants: [variant("de", "standard", "Teilweise"), variant("en", "standard")],
  structure: [
    {
      id: "b1",
      kind: "verse",
      translations: [{ lang: "de", variant: "standard", text: "Nur Deutsch" }],
    },
  ],
});
add("test-duplicate-block-ids", minimal({
  structure: [
    { id: "same", kind: "verse", translations: [] },
    { id: "same", kind: "heading", translations: [] },
  ],
}));
add("test-empty-kind", minimal({ structure: [{ id: "b1", kind: "", translations: [] }] }));
add("test-description", minimal({ description: "Morning prayers before the hours" }));
add("test-meta-custom", minimal({
  meta: { custom: { saint_id: "prokopios", feast_rank: 3, published: true, note: null } },
}));
add("test-legacy-revised-at", minimal({ meta: { revised_at: "2026-08-09" } }));
add("test-extra-links", minimal({ links: { saint_id: "x" } }));
add("test-legacy-title", minimal({ title: "Should not be here" }));

// Valid extras
add("valid-rich", rich);
add("valid-tone-null", minimal({ tone: null }));
add("valid-tone-1", minimal({ tone: 1 }));
add("valid-tone-8", minimal({ tone: 8 }));
add("valid-non-latin", minimal({
  id: "gebet-1",
  variants: [variant("ru", "synodal-cyrl", "Молитва"), variant("el", "std", "Προσευχή")],
  structure: [
    {
      id: "b-1",
      kind: "my_kind",
      translations: [
        { lang: "ru", variant: "synodal-cyrl", text: "Господи, помилуй" },
        { lang: "el", variant: "std", lines: ["Κύριε ἐλέησον", "Δόξα Πατρί"] },
      ],
    },
  ],
}));
add("valid-revised-at-with-custom", minimal({
  meta: { revised_at: "2026-08-09", custom: { a: "b" } },
}));
add("valid-meta-empty", minimal({ meta: {} }));
add("valid-run-note-whitespace", withTr({
  text: [
    { t: "text", v: "A" },
    { t: "note", v: " (x) " },
  ],
}));

// Semantic failures
add("sem-duplicate-translation", minimal({
  structure: [
    {
      id: "b1",
      kind: "verse",
      translations: [
        { lang: "de", variant: "standard", text: "a" },
        { lang: "de", variant: "standard", text: "b" },
      ],
    },
  ],
}));
add("sem-duplicate-variant", minimal({
  variants: [variant("de", "standard", "A"), variant("de", "standard", "B")],
}));
add("sem-text-and-lines", withTr({ text: "a", lines: ["b"] }));
add("sem-text-and-lines-invalid-run", withTr({
  text: "a",
  lines: [[{ t: "text", v: "only text" }]],
}));
add("sem-runs-all-text", withTr({ text: [{ t: "text", v: "a" }, { t: "text", v: "b" }] }));
add("sem-runs-zero-width", withTr({
  text: [{ t: "note", v: "​" }, { t: "text", v: "‍" }],
}));
add("sem-runs-whitespace-note-only-text", withTr({
  text: [{ t: "note", v: "  " }],
}));
add("sem-lines-runs-all-text", withTr({
  lines: ["ok", [{ t: "text", v: "a" }], [{ t: "note", v: "n" }]],
}));
add("sem-many", {
  id: "many",
  type: "prayer",
  variants: [variant("de", "s"), variant("de", "s")],
  structure: [
    {
      id: "a",
      kind: "verse",
      translations: [
        { lang: "de", variant: "s", text: "x", lines: ["y"] },
        { lang: "de", variant: "s", text: [{ t: "text", v: "z" }] },
      ],
    },
    { id: "a", kind: "verse", translations: [] },
  ],
});

// JSON pointer escaping and JS key enumeration order
add("keys-pointer-escape", minimal({
  meta: { custom: { "a/b": {}, "a~b": [], "a b%": {}, "é": [], ok: 1 } },
}));
add("keys-integer-like-custom", minimal({
  meta: { custom: { b: {}, "2": {}, a: {}, "1": {}, "01": {}, "": {} } },
}));
add("keys-integer-like-extra", minimal({ b: 1, "2": 1, a: 1, "1": 1, "01": 1 }));
add("keys-extra-in-translation-and-variant", {
  ...minimal(),
  variants: [{ ...variant("de", "s"), z: 1, "10": 1, "9": 1 }],
});

// Non-object roots
for (const [n, v] of Object.entries({
  null: null,
  array: [],
  string: "x",
  number: 7,
  boolean: true,
  "empty-object": {},
})) {
  add(`root-${n}`, v);
}
add("root-meta-not-object-with-revised", { ...minimal(), meta: [] });
add("root-meta-null", minimal({ meta: null }));

// Specific schema failures
add("bad-id-uppercase", minimal({ id: "Bad_Id" }));
add("bad-id-empty", minimal({ id: "" }));
add("bad-id-trailing-dash", minimal({ id: "a-" }));
add("bad-id-number", minimal({ id: 5 }));
add("bad-type-empty", minimal({ type: "" }));
add("bad-book-empty", minimal({ book: "" }));
add("bad-occasion-number", minimal({ occasion: 3 }));
add("bad-description-empty", minimal({ description: "" }));
for (const t of [0, 9, 3.5, "3", true, [], {}, -1, 1.0000001, 100]) {
  add(`bad-tone-${JSON.stringify(t)}`, minimal({ tone: t }));
}
add("bad-variants-empty", minimal({ variants: [] }));
add("bad-variants-object", minimal({ variants: {} }));
add("bad-structure-empty", minimal({ structure: [] }));
add("bad-variant-item-string", minimal({ variants: ["de"] }));
add("bad-variant-missing-all", minimal({ variants: [{}] }));
add("bad-variant-extra", minimal({ variants: [{ ...variant("de", "s"), extra: 1, more: 2 }] }));
add("bad-translation-missing-text-lines", withTr({}));
add("bad-translation-lines-empty", withTr({ lines: [] }));
add("bad-translation-lines-empty-and-text", withTr({ text: "a", lines: [] }));
add("bad-translation-text-null", withTr({ text: null }));
add("bad-translation-text-number", withTr({ text: 5 }));
add("bad-translation-text-object", withTr({ text: {} }));
add("bad-translation-text-empty-array", withTr({ text: [] }));
add("bad-translation-extra", withTr({ text: "a", foo: "bar" }));
add("bad-translation-empty-lang", { ...withTr({ text: "a" }), structure: [{ id: "b", kind: "k", translations: [{ lang: "", variant: "", text: "a" }] }] });
add("bad-lines-item-empty", withTr({ lines: ["a", ""] }));
add("bad-lines-item-number", withTr({ lines: ["a", 3, null] }));
add("bad-run-wrong-role", withTr({ text: [{ t: "bold", v: "a" }] }));
add("bad-run-missing-v", withTr({ text: [{ t: "text" }] }));
add("bad-run-missing-t", withTr({ text: [{ v: "a" }] }));
add("bad-run-empty-v", withTr({ text: [{ t: "note", v: "" }] }));
add("bad-run-extra", withTr({ text: [{ t: "note", v: "a", x: 1 }] }));
add("bad-run-not-object", withTr({ text: ["a", 1, null] }));
add("bad-run-v-number", withTr({ text: [{ t: "text", v: 1 }] }));
add("bad-run-t-number", withTr({ text: [{ t: 1, v: "a" }] }));
add("bad-run-empty-object", withTr({ text: [{}] }));
add("bad-meta-extra", minimal({ meta: { other: 1 } }));
add("bad-meta-string", minimal({ meta: "x" }));
add("bad-meta-custom-array", minimal({ meta: { custom: [] } }));
add("bad-meta-custom-value-object", minimal({ meta: { custom: { a: {}, b: [], c: "ok" } } }));
add("bad-meta-custom-empty-key", minimal({ meta: { custom: { "": "x" } } }));
add("bad-meta-custom-empty-key-and-object", minimal({ meta: { custom: { "": {} } } }));
add("bad-meta-revised-and-extra", minimal({ meta: { revised_at: "x", other: 1 } }));
add("bad-meta-custom-and-revised-bad", minimal({ meta: { revised_at: "x", custom: 5 } }));
add("bad-block-kind-number", minimal({ structure: [{ id: "b", kind: 1, translations: [] }] }));
add("bad-block-missing-translations", minimal({ structure: [{ id: "b", kind: "k" }] }));
add("bad-block-translations-object", minimal({ structure: [{ id: "b", kind: "k", translations: {} }] }));
add("bad-block-id-empty", minimal({ structure: [{ id: "", kind: "k", translations: [] }] }));
add("bad-block-string", minimal({ structure: ["b"] }));
add("bad-everything", {
  id: "Bad_Id",
  type: "",
  tone: 9,
  extra: true,
  variants: [],
  structure: [
    {
      id: "",
      kind: 3,
      translations: [
        { lang: "de" },
        { lang: "de", variant: "x", text: [{ t: "z", v: "" }], extra: 1 },
      ],
    },
    "nope",
  ],
  meta: { custom: { "": {} }, other: 1 },
});
add("bad-key-order-independent", {
  structure: [{ translations: [{ text: "a", variant: "s", lang: "" }], kind: "", id: "" }],
  variants: [{ source: "", license: "", title: "", variant: "", lang: "" }],
  type: 1,
  id: 2,
});

// Systematic mutations of the rich fixture: every path gets deleted,
// retyped and given an extra property where it is an object.
function walk(value, path, visit) {
  visit(path, value);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i], visit));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) walk(v, [...path, k], visit);
}
function setAt(doc, path, fn) {
  const copy = clone(doc);
  if (path.length === 0) return fn(copy, null, null);
  let parent = copy;
  for (const seg of path.slice(0, -1)) parent = parent[seg];
  const last = path[path.length - 1];
  if (fn === "delete") {
    if (Array.isArray(parent)) parent.splice(last, 1);
    else delete parent[last];
  } else parent[last] = fn;
  return copy;
}
const ptr = (p) => "/" + p.join("/");
const replacements = [
  ["null", null],
  ["number", 42],
  ["empty-string", ""],
  ["empty-array", []],
  ["empty-object", {}],
];
const paths = [];
walk(rich, [], (p, v) => paths.push([p, v]));
for (const [p, v] of paths) {
  const label = p.length ? ptr(p) : "root";
  if (p.length > 0) {
    add(`mut-delete${label}`, setAt(rich, p, "delete"));
    for (const [rn, rv] of replacements) add(`mut-set-${rn}${label}`, setAt(rich, p, rv));
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const copy = clone(rich);
    let target = copy;
    for (const seg of p) target = target[seg];
    target.zzExtra = 1;
    cases.push({ name: `mut-extra-prop${label}`, input: copy });
  }
  if (Array.isArray(v)) {
    // duplicate the first element (duplicate ids / keys) and append garbage
    if (v.length > 0) {
      const copy = clone(rich);
      let target = copy;
      for (const seg of p) target = target[seg];
      target.push(clone(target[0]));
      cases.push({ name: `mut-dup-first${label}`, input: copy });
    }
  }
}

cases.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
const seen = new Set();
const unique = cases.filter((c) => !seen.has(c.name) && seen.add(c.name));

write(
  "prayer-cases.json",
  unique.map(({ name, input }) => {
    const result = validate(clone(input));
    return {
      name,
      input,
      expected: result.ok
        ? { ok: true, prayer: result.prayer }
        : { ok: false, errors: result.errors },
    };
  }),
);

// ----------------------------------------------------------------- styles

const goodStyle = {
  fontSize: "1rem",
  color: "base",
  fontWeight: "400",
  fontStyle: "normal",
};
/** @type {{name: string, input: unknown}[]} */
const styleCases = [];
const sadd = (name, input) => styleCases.push({ name, input: clone(input) });

sadd("default-kind-styles", DEFAULT_KIND_STYLES);
sadd("empty-object", {});
for (const [n, v] of Object.entries({ null: null, array: [], string: "s", number: 1, true: true })) {
  sadd(`root-${n}`, v);
}
sadd("test-text-align", {
  verse: { ...goodStyle, textAlign: "justify" },
  heading: { ...goodStyle, color: "accent", textAlign: "Center" },
});
sadd("test-text-align-bad", { verse: { ...goodStyle, textAlign: "right" } });
sadd("test-html-tag", { verse: { ...goodStyle, htmlTag: "blockquote" } });
sadd("test-html-tag-bad", { verse: { ...goodStyle, htmlTag: "script" } });
sadd("test-url-and-unknown", {
  verse: { ...goodStyle, color: "url(javascript:alert(1))", evil: "x" },
});
sadd("test-legacy-hex", {
  verse: { color: "#1a1a1a" },
  heading: { color: "#8b2942" },
  other: { color: "#112233" },
  bad: { color: "url(http://x)" },
});
sadd("test-partial-override", { verse: { color: "#8b2942" } });
sadd("test-bad-kind-names", {
  "Test kind": { color: "base" },
  Test: { color: "accent" },
});
sadd("kind-names", {
  "1abc": { color: "base" },
  "": { color: "base" },
  ["a".repeat(64)]: { color: "base" },
  ["a".repeat(65)]: { color: "base" },
  "foo-bar_2": { color: "base" },
  "_x": { color: "base" },
  "-x": { color: "base" },
  "é": { color: "base" },
  "Ab": { color: "ACCENT" },
});
sadd("integer-like-keys", { b: { color: "base" }, "2": { color: "base" }, a: 5, "1": null, "01": [] });
sadd("kind-not-object", { a: null, b: [], c: "s", d: 1, e: { color: "base" } });
sadd("kind-empty-object", { a: {} });
sadd("kind-all-invalid", { a: { color: 1, fontSize: "big", zzz: "q" } });

const fieldValues = {
  fontSize: ["1rem", "16px", "0", " 0 ", "1.5em", "-2px", "10%", "1REM", "PX", "1", "1.rem", ".5rem", "1 rem", "1pt", " 1rem ", "1rem\n", "١rem", "x".repeat(65), "x".repeat(64), "0.0", "calc(1rem)", "url(x)", "URL (x)", "ExPrEsSiOn\t(1)", "a@import", "javascript:x", "1<2", "", " "],
  color: ["base", "accent", " Base ", "ACCENT", "#8b2942", "#8B2942", "#abc", "abc", "#ABCDEF", "#12", "red", "rgb(0,0,0)", "", "#8b2942 ", "#ggg", "url(#a)"],
  fontWeight: ["normal", "BOLD", "bolder", "lighter", "100", "900", "000", "1000", "450", " 400 ", "bold ", "heavy", "", " bold"],
  fontStyle: ["normal", "Italic", "oblique", " italic ", "slanted", "", "italic\n"],
  initialCap: ["true", "false", "TRUE", " true", "yes", "", "true "],
  indicate: ["true", "false", "True", "1", ""],
  htmlTag: ["h1", "h6", "p", "div", "aside", "section", "blockquote", "span", " p ", "P", "article", "script", "h7", "", "p\t"],
  textAlign: ["left", "center", "justify", "RIGHT", " Left ", "CENTER", "start", "", "justify\n"],
};
for (const [field, values] of Object.entries(fieldValues)) {
  values.forEach((v, i) => sadd(`field-${field}-${i}`, { k: { [field]: v } }));
  for (const bad of [1, null, true, [], {}, ["a"]]) {
    sadd(`field-${field}-type-${JSON.stringify(bad)}`, { k: { [field]: bad } });
  }
}
sadd("field-unknown", { k: { fontFamily: "serif", color: "base", "": "x" } });
sadd("field-order", { k: { textAlign: "left", color: "base", fontSize: "1rem", bogus: 1, htmlTag: "p" } });
sadd("non-latin-values", { k: { fontSize: "Ж", color: "base" } });
sadd("long-astral-value", { k: { fontSize: "😀".repeat(33) } }); // 66 UTF-16 units, 33 chars
sadd("astral-at-limit", { k: { fontSize: "😀".repeat(32) } }); // 64 units
sadd("unicode-trim", { k: { fontSize: "﻿1rem﻿" } });
sadd("color-bom-and-nbsp", { a: { color: "\ufeffbase" }, b: { color: "\u00a0accent\u2003" }, c: { color: "\u200bbase" } });
sadd("dangerous-case", { k: { color: "JavaScript:void" }, j: { color: "@IMPORT" }, l: { color: "a<b" } });

write(
  "styles-cases.json",
  styleCases.map(({ name, input }) => ({
    name,
    input,
    sanitize: sanitizeStyles(clone(input)),
    validate: validateStyles(clone(input)),
  })),
);

// --------------------------------------------------------------- kind ids

const kindIdInputs = [
  "Test", "strophe_2", "foo-bar", "", "Test kind", "1abc", "a", "A", "_a", "-a",
  "a".repeat(64), "a".repeat(65), "a".repeat(80), "é", "aé", "a b", "a\n", " a",
  "\n", "9", "Ж", "foo_bar-2", "a-", "a_", "1_-a", "__x", "x😀y", "😀", "12345a67",
  "a".repeat(63) + "-", "-" + "a".repeat(70), " Test", "Test\tkind", "abc.def", "ab/c",
];
write("kind-ids.json", {
  maxLength: KIND_ID_MAX_LENGTH,
  cases: kindIdInputs.map((input) => ({
    input,
    valid: isValidKindId(input),
    sanitized: sanitizeKindIdInput(input),
  })),
});
