# 06 - Core port: which Rust crates carry it

Ticket: `issues/06-core-port-crates.md`. Researched 2026-10-05 against crate sources, crates.io metadata and a throwaway build in `/tmp/claude-0/exp` (not in the repo). Toolchain: cargo 1.97.0.

## Summary

- **Validation: `jsonschema` 0.58.5 (MIT).** Supports draft 2020-12, `$ref`/`$defs`/`oneOf`/`anyOf`/`propertyNames`/`pattern` as used by `prayer.schema.json`. The schema uses no `format`, so format support is a non-issue today. Error paths are RFC 6901 pointers like Ajv's `instancePath`. Map `kind()` to the TS messages (as `formatAjvError` already does) rather than reusing library text. Fallback: `boon` 0.6.1, but its last release was Jan 2025.
- **DOCX: `docx-rs` 0.4.22 (MIT) covers everything used.** The TS only needs blank named paragraph/character styles, `basedOn`/`next`/`quickStyle`, text runs, soft line breaks and one section with empty properties. Verified in a spike. There is no font/colour/size/spacing/page setup in the TS, so none is required.
- **RTF: hand-write it.** The TS is about 40 lines of string building (escape, `\fonttbl`, `\stylesheet`, `\pard\sN`, `\line`, `\par`). No writer crate is worth adding (only a tokenizer, `rtf-grimoire`, exists in the search results). Port it 1:1 and snapshot-test.
- **HTML: hand-write `escape_text`/`escape_attr` (about 10 lines).** An exact byte-for-byte match with the TS escaper matters more than a crate (`html-escape` encodes differently by default, e.g. `'`). Attribute parsing needs the `regex` crate (or a small hand-written scanner). The tag allowlist is plain `match`.
- **Dependency set:** `serde_json` (already present), `jsonschema`, `regex`, `docx-rs`, plus `zip` only if direct. No HTML or RTF crates. Gaps to test: Ajv-style flat error list vs `jsonschema` nested `OneOf`/`AnyOf` context, and `docx-rs` emitting `DefaultParagraphFont` basedOn without defining it.

## 1. JSON Schema validation

### What the TS does
`packages/core/src/validate.ts`:
- `new Ajv2020({ allErrors: true, strict: false })` plus `ajv-formats`; compiles `schema/prayer.schema.json`.
- Returns `{ ok: false, errors: ValidationError[] }` where `ValidationError = { path, message }`. `path = error.instancePath || "/"`. `message` is Ajv's text, except two rewritten cases: `additionalProperties` becomes `Unexpected property "x"` and `required` becomes `Missing required property "x"`.
- Before the schema: `stripLegacyFields` (drops `meta.revised_at`). After the schema passes: hand-written semantic checks (duplicate block ids, duplicate lang/variant, text xor lines, inline run rules). Semantic errors are only reported when the schema passes. These checks are plain Rust, no crate involved.

### Schema keywords in use (grep of `prayer.schema.json`)
`$schema` (2020-12), `$id`, `$defs`, `$ref` (local), `type` (including type arrays `["integer","null"]` and `["string","number","boolean","null"]`), `properties`, `required`, `additionalProperties` (both `false` and as a schema), `propertyNames`, `items`, `minItems`, `minLength`, `pattern` (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, no lookaround), `minimum`/`maximum`, `enum`, `oneOf`, `anyOf` (of `required`), `description`/`title`. **No `format`, no `unevaluated*`, no `if/then`, no `uniqueItems`, no `const`.** So `ajv-formats` is loaded but unused by this schema.

### Candidates
| Crate | Version | Last release | License | Notes |
|---|---|---|---|---|
| `jsonschema` | 0.58.5 | 2026-10-02 | MIT | Draft 4/6/7/2019-09/2020-12; MSRV 1.85; about 97M downloads; repo Stranger6667/jsonschema. `jsonschema::draft202012::new(&schema)`, `iter_errors()` for all errors, `ValidationError::instance_path()`, `kind()` (typed `Required{property}`, `AdditionalProperties{unexpected}`, `Pattern`, `MinLength`, ...). |
| `boon` | 0.6.1 | 2025-01-07 | MIT OR Apache-2.0 | All drafts incl. 2020-12; about 0.57M downloads; the one-person project is much quieter. Error tree with `instance_location` and typed `kind`; `{:#}` output is human-readable and nested. |

### Spike result
Invalid document (bad id, empty type, extra prop, tone 9, empty variants, bad run, translation missing `variant` and text/lines) gave, with `jsonschema` `iter_errors`:
- `/id` (Pattern), `/tone` (Maximum), `/type` (MinLength), `/variants` (MinItems), `` (AdditionalProperties `["extra"]`), `/structure/0/translations/1` (Required `variant`; plus an AnyOf), and `/structure/0/translations/0/text` (`OneOfNotValid` with the branch errors nested in `context`).
- Paths are the same JSON-pointer shape as Ajv `instancePath`, and a `required` error is reported at the parent object path, the same as Ajv. The empty root path maps to `"/"` as in the TS.
- Difference: with `allErrors`, Ajv emits the `oneOf`/`anyOf` branch errors as additional flat entries (e.g. `/.../text/0/t` "must be equal to one of the allowed values") alongside the parent "must match exactly one schema in oneOf". `jsonschema` gives one parent error with the branch errors in `context`. `boon` nests them the same way (causes tree). To match, either flatten `context` in the port or accept only the parent error. Decide against whatever the tests assert.
- Message text differs (Ajv: `must match pattern "..."`, `must NOT have fewer than 1 characters`, `must be <= 8`; jsonschema: `"Bad_Id" does not match "..."`, `"" is shorter than 1 character`, `9 is greater than the maximum of 8`). Since only `required`/`additionalProperties` are rewritten in the TS and the rest pass Ajv text through, byte-identical messages are not achievable with any Rust crate. Port by matching on `ValidationErrorKind` and writing Ajv-style strings for the keywords the schema uses (pattern, minLength, minItems, minimum/maximum, enum, type, oneOf, anyOf). That is roughly 10 keyword arms. Check what `packages/core/tests` assert on message text first; if tests only check paths or substrings, this is cheap.

### Verdict
Use `jsonschema` (draft202012 builder, `iter_errors`). Embed the schema with `include_str!` of a copy or of the shared file. `format` is not needed now; if added later, `jsonschema` has format validation (check which formats are on by default in 2020-12, since the spec treats format as annotation by default, and Ajv with ajv-formats asserts). Keep `boon` as fallback only.

## 2. DOCX

### What the TS uses (`exportLayoutDocx.ts`, docx npm ^9.7.1)
- `Document({ styles: { paragraphStyles, characterStyles }, sections: [{ properties: {}, children }] })`; `Packer.toArrayBuffer`.
- Paragraph styles: `{ id, name, basedOn: "Normal", next: "Normal", quickStyle: true }`, deliberately blank (no fonts, colours, sizes, spacing; "Place-friendly" blank styles).
- One character style for notes: `{ id, name, basedOn: "DefaultParagraphFont" }`.
- `Paragraph({ style, children })`; `TextRun({ text })`, `TextRun({ text, style })` for notes, `TextRun({ break: 1 })` as soft line break between `lines`.
- Section properties empty (no page size/margins/headers). No doc meta/title. No numbering, tables, images, hyperlinks, footnotes.

### Candidate: `docx-rs` 0.4.22 (MIT, updated 2026-07-21, about 3.6M downloads, bokuweb/docx-rs)
| Feature | docx-rs |
|---|---|
| Paragraph style (id, name, basedOn, next) | `Style::new(id, StyleType::Paragraph).name().based_on().next()` yes |
| Character style | `StyleType::Character` yes |
| `quickStyle` | Spike output includes `<w:qFormat />` on every style (emitted by default), so equivalent |
| Paragraph with style | `Paragraph::new().style(id)` yes |
| Run text / run with character style | `Run::new().add_text()` / `.style(id)` yes |
| Soft break | `Run::new().add_break(BreakType::TextWrapping)` yields `<w:br w:type="textWrapping"/>`; docx npm `break:1` emits plain `<w:br/>` (same rendering) |
| Empty section properties | default `sectPr` is emitted; fine |
| Bytes out | `docx.build().pack(writer)` to a `Cursor<Vec<u8>>` or a file |
Spike (`docx-rs` build + unzip) produced valid-looking `styles.xml` (Normal, `Pr_body`, `Pr_note`) and `document.xml` with `pStyle`, `rStyle` and `br`.
Beyond what the TS needs, docx-rs also supports fonts, colours, sizes, spacing, page size/margins, tables, images, numbering, headers/footers, so future styled export (kind styles to DOCX) is covered.

### Alternatives
- `docx-rust` and `docx-rs`-forks: smaller communities (not evaluated in depth). `officeopenxml`/hand-written `zip` + XML: feasible (about 5 small files: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/styles.xml`) but unneeded.

### Gaps / differences vs docx npm
- docx-rs does not define `DefaultParagraphFont` in `styles.xml` even though the note style is `basedOn` it (verified in spike output). The npm `docx` default styles include the default character style. Word generally tolerates a missing basedOn target, but verify by opening in Word/LibreOffice; if a problem, add a `Style::new("DefaultParagraphFont", Character)` explicitly or drop `based_on`.
- docx-rs writes `<w:pPr><w:rPr/></w:pPr>` inside the character style (spike output). Schema-wise `pPr` in a character style is unusual; check Word/LibreOffice opens it cleanly, or compare to the npm output.
- Output will not be byte-identical to npm `docx` (different XML, paraId attributes, docDefaults). Tests should assert structurally (unzip + parse `styles.xml`/`document.xml`) not by bytes. Check what `tests/` currently assert.

### Verdict
`docx-rs` is sufficient. Pin `=0.4.x`; it is pre-1.0 and its API has shifted between minors.

## 3. RTF

### What the TS does (`exportLayoutRtf.ts`)
Hand-written string builder over the shared `LayoutStory` model: header `{\rtf1\ansi\uc1\deff0`, `{\fonttbl{\f0\fnil;}}`, `{\stylesheet {\sN name;} ... {\*\csN note;}}`, then per paragraph `{\pard\sN <runs joined with \line >\par}`; note runs wrapped in `{\cs10 ...}`. Escaping: `\\`, `\{`, `\}`, ASCII passes through, others `\uN?` with signed 16-bit (note: code points above U+FFFF are emitted as a single signed value, not a surrogate pair; the TS iterates code points via `[...text]`, so astral characters are likely wrong in the TS today. Decide whether the port reproduces or fixes this, and update the TS tests/doc together).

### Candidates
- `rtf-grimoire` 0.2.1: a tokenizer for parsing RTF, not a writer. No help. Other RTF crates on crates.io are parsers or converters (not examined further).
### Verdict
Hand-write. About 40 lines of Rust: `escape_rtf(&str) -> String` (iterate `chars()`, for `> 127` use `encode_utf16` and emit one `\uN?` per UTF-16 unit, which fixes the astral issue) and a serializer over the same layout model.

## 4. HTML export, attribute parsing, tags

### What the TS does
- `exportHtml.ts`: own `escapeText` (`& < > "`) and `escapeAttr` (adds `'` to `&#39;`), builds tags by string concatenation, `<br>` between `lines`, `<span data-kind="annotation">` for notes, wrapper element with auto meta attributes.
- `htmlTags.ts`: static allowlist (h1-h6, p, div, aside, section, blockquote, span; wrapper also `article`), fallback `div`/`article`.
- `parseHtmlAttributes.ts`: two regexes (`ATTR_NAME`, a global `TOKEN` for `name`, `name=value`, quoted or unquoted), rejects `style` and `on*`, collects errors for gaps and trailing garbage.

### Candidates
- Escaping: `html-escape` 0.2.15 (MIT, 2026-08-01), `askama_escape`, `v_htmlescape`, `htmlescape`. All are fine but none escapes exactly the set above by default (e.g. `html-escape::encode_text` does not escape `"`; `encode_double_quoted_attribute` differs for `'`), and exact output parity with the TS matters for snapshot tests. A hand-written 5-arm `match` over chars is simpler and guarantees parity.
- Attribute parsing: `regex` 1.13.1 (MIT OR Apache-2.0) ports the two regexes directly. Both patterns are plain, with no lookaround or backreferences, so they are RE2-compatible. Note JS `\w` is ASCII; Rust `regex` `\w` is Unicode by default, so use `(?-u:\w)` or `[A-Za-z0-9_]` to keep parity. A hand-written scanner is also easy (about 40 lines) and avoids the dependency; but `regex` is trivial and likely a transitive dependency of `jsonschema` anyway (it uses `regex`/`fancy-regex` for `pattern`).
- HTML parsers (`scraper`, `html5ever`): not needed; the TS never parses HTML.
### Verdict
No HTML crate. Hand-write the escapers and tag allowlist; use `regex` (or a scanner) for attributes with ASCII-only `\w`.

## Risks
- **Error-message parity** with Ajv is impossible byte-for-byte; the port must map `ValidationErrorKind` to messages, and the `oneOf`/`anyOf` flattening difference can change error counts. Check TS test assertions before choosing.
- **`format` semantics**: not used now. If added, Ajv asserts formats; `jsonschema` for draft 2020-12 may treat them as annotations unless `should_validate_formats(true)` is set (verify in docs before relying on it).
- **`jsonschema` churn**: 0.x with frequent minor releases (0.58 on 2026-10-02); API breaks likely. Pin the version and keep the validation call in one module. MSRV 1.85 is fine for the repo's toolchain.
- **`docx-rs` fidelity**: undefined `DefaultParagraphFont`, `pPr` inside a character style, and byte differences from npm docx. Verify in Word and LibreOffice, not just by unzipping.
- **RTF astral characters**: pre-existing TS behaviour looks incorrect; decide fix vs replicate.
- **Regex `\w` Unicode default** vs JS ASCII `\w` in attribute parsing.
- `jsonschema` dependency tree is heavy (HTTP resolver features): disable default features if only local `$ref`s are needed to keep build size and avoid network retrieval.

## Sources
- TS: `packages/core/src/validate.ts`, `schema/prayer.schema.json`, `src/exportLayoutDocx.ts`, `src/exportLayoutRtf.ts`, `src/exportHtml.ts`, `src/parseHtmlAttributes.ts`, `src/htmlTags.ts`, `packages/core/package.json` (ajv ^8.17.1, ajv-formats ^3.0.1, docx ^9.7.1).
- crates.io API (versions, dates, licences, downloads): https://crates.io/api/v1/crates/jsonschema, `/boon`, `/docx-rs`, `/html-escape`, `/regex`; `cargo search` for `rtf-grimoire` 0.2.1 and other listed crates.
- Repos: https://github.com/Stranger6667/jsonschema, https://github.com/santhosh-tekuri/boon, https://github.com/bokuweb/docx-rs, https://github.com/magiclen/html-escape.
- Spike: `/tmp/claude-0/exp` (`jsonschema` 0.58.5, `boon` 0.6.1, `docx-rs` 0.4.22 compiled and run against the real schema; outputs quoted above).
- Not verified (no docs.rs fetch performed): `jsonschema` default format-validation behaviour for 2020-12, exact HTTP-resolver feature names, `html-escape` default escape sets (stated from memory of its API), and whether `jsonschema` depends on `regex`.
