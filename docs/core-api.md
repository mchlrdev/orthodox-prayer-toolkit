# Core API

Package: `@orthodox-prayer-toolkit/core`

Pure TypeScript — no Electron dependency. This is the **test seam** and the integration surface for other tools.

```bash
pnpm --filter @orthodox-prayer-toolkit/core build
```

Entry: `packages/core/src/index.ts` → `dist/`. Schema file ships under `packages/core/schema/`.

## Validate

```ts
import { validate } from "@orthodox-prayer-toolkit/core";

const result = validate(unknownJson);
if (result.ok) {
  // result.prayer: Prayer
} else {
  // result.errors: { path: string; message: string }[]
}
```

`locateValidationErrors(prayer, errors)` maps each error path onto the block id (and translation `lang`/`variant`, when the path names one). The editor uses it to mark the affected block while you type.

`validate` drops `rtl: false` from variants so LTR editions omit the field. `resolveDir(variantRtl, kindDir)` is the Core seam for editor and export direction (`kindDir` of `rtl` / `ltr` wins; otherwise the variant flag).

## Export

### Flat variant (JSON-shaped object)

```ts
import { exportVariant } from "@orthodox-prayer-toolkit/core";

const flat = exportVariant(prayer, {
  lang: "de",
  variant: "standard",
  // includeBlocksWithoutTranslation?: boolean
});
```

Produces `FlatPrayer`: single title/license/source and a structure for that variant only.

### HTML

```ts
import { exportHtml, tagMapFromStyles } from "@orthodox-prayer-toolkit/core";

const html = exportHtml(prayer, {
  lang: "de",
  variant: "standard",
  tagMap: tagMapFromStyles(styles),
  wrapper: { enabled: true, tag: "article" },
});
```

Tags are allowlisted (`HTML_TAG_ALLOWLIST`). Disallowed or missing tags fall back to `div`.

### Layout (RTF / DOCX)

For Affinity Publisher and similar tools that map **named paragraph styles** (one per kind) and a **character** style for inline notes:

```ts
import {
  exportLayoutRtf,
  exportLayoutDocx,
  resolveLibraryStylePrefixStem,
} from "@orthodox-prayer-toolkit/core";

const stem = resolveLibraryStylePrefixStem(manifest);
const rtf = exportLayoutRtf(prayer, {
  lang: "de",
  variant: "standard",
  stylePrefixStem: stem,
});
const docx = await exportLayoutDocx(prayer, {
  lang: "de",
  variant: "standard",
  stylePrefixStem: stem,
});
```

Shared intermediate: `buildLayoutStory(...)`. Style name prefix defaults to `opt` (`DEFAULT_STYLE_PREFIX_STEM`).

Word-only two-column DOCX (`exportLayoutDocxParallel`) uses a **table** — one structure block per row, column order as given — so corresponding verses stay aligned. By default an empty language gutter (`gutterColumn`) is included so the gap can be set in Word by dragging; pass `gutterColumn: false` to omit it. When Speaker Placement is Own column, `speakerGutterColumn` (default on; pass `false` to omit) inserts an empty column after Speaker. It is ignored when placement is not `column`. Column order: `Speaker | [speaker gutter] | Left | [language gutter] | Right`. Every cell gets an explicit DXA width (`w:tcW`) and the table uses fixed layout so Word does not collapse empty gutters. The table uses Word’s default grid (no custom borders, margins, or page setup). Cells still get blank named kind styles. This path is **not** for Affinity Place: tables do not flow as story text across pages.

```ts
import { exportLayoutDocxParallel } from "@orthodox-prayer-toolkit/core";

const docx = await exportLayoutDocxParallel(prayer, {
  columns: [
    { lang: "de", variant: "standard" },
    { lang: "en", variant: "standard" },
  ],
  prefixStem: stem,
});
```

See also [Affinity bridge](affinity-bridge.md).

## Kinds

Every prayer has the four preset kinds (`KIND_PRESETS`) implicitly; custom kinds are declared in the prayer's `kinds` (`KindDef[]`: `{ id, speaker?: true }`). `validate` errors with `code` `kind-undeclared` (block kind neither preset nor declared), `kind-duplicate`, `kind-preset-declared` and `speaker-kind-not-allowed` (a block `speaker` on a kind that takes none, see `kindAllowsSpeaker`). `setKindSpeaker(…, false)`, `renameKind` and `deleteKind` drop speakers that the new kind does not take; `dropDisallowedSpeakers(prayer)` does the same for a whole prayer.

```ts
import {
  declareKinds,
  declareBlockKinds,
  deleteKind,
  indexKinds,
  indexVariants,
  kindAllowsSpeaker,
  pickerKinds,
  renameKind,
  setKindSpeaker,
} from "@orthodox-prayer-toolkit/core";

pickerKinds(prayer); // presets, then prayer.kinds ids in order
let next = declareKinds(prayer, [{ id: "refrain", speaker: true }]);
next = declareBlockKinds(next, pastedBlocks, sourcePrayer); // speaker flag from source or block speakers (Core-only for now: the editor has no block paste between prayers)
next = setKindSpeaker(next, "refrain", false);
next = renameKind(next, "refrain", "kehrvers");
next = deleteKind(next, "kehrvers"); // drops the entry, blocks → fallback (default verse)
kindAllowsSpeaker("refrain", prayer); // verse always, other presets never, custom: kinds entry speaker
```

All helpers are pure, return the same prayer when nothing changes, omit an empty `kinds` and normalize `formatVersion`. `renameKind` / `deleteKind` operate on one prayer (the app applies renames across the open library with confirmation and refuses a `to` that already exists anywhere in the library, so it never merges). `renameKind` refuses presets as `from`, declares `to` when blocks were renamed, and merges into an already declared `to` (speaker if either had it). `deleteKind` only reassigns to a `fallback` that is a preset or declared kind; otherwise to `verse` (`annotation` when deleting verse). Kind ids that are not valid (`isValidKindId`) are never declared by `declareBlockKinds` or migration. `indexKinds(prayers)` is the sorted union of kinds used on blocks and declared in `kinds`; `indexVariants(prayers)` the sorted lang/variant pairs.

Library kind index (pure, from `LibraryKindSources` = `{ prayerKinds?, templates?, styles? }`; `prayerKinds` is one kind list per prayer, `styles` a style map or raw `styles.json` object):

```ts
import {
  discoverKinds,
  libraryKindsInUse,
  rawPrayerKinds,
  unusedStyleKeys,
} from "@orthodox-prayer-toolkit/core";

const sources = { prayerKinds: prayers.map((p) => indexKinds([p])), templates, styles };
libraryKindsInUse(sources); // prayers + templates, sorted
discoverKinds(sources); // + style keys: the Kind styles list and the "already exists" check of a rename
unusedStyleKeys(sources); // custom style keys in no prayer and no template (pass every prayer)
rawPrayerKinds(unvalidatedJson); // best effort for files that parse but do not validate
```

### Kind templates

Library `templates.json` (`KindTemplatesFile`: `{ templates: KindTemplate[] }`, template `{ id, label, kinds }`, id matching `TEMPLATE_ID_PATTERN`).

```ts
import {
  sanitizeTemplates,
  validateTemplates,
  stampTemplate,
  applyTemplate,
  renameTemplateKind,
  removeTemplateKind,
  addTemplateKind,
  setTemplateKindSpeaker,
  moveTemplateKind,
} from "@orthodox-prayer-toolkit/core";

const { templates, errors } = sanitizeTemplates(rawJson); // drops invalid templates/entries; validateTemplates is strict
const created = stampTemplate(newPrayer, template); // kinds = copy of the template's (null = none)
const merged = applyTemplate(prayer, template); // additive: appends missing kinds only
const all = renameTemplateKind(templates, "refrain", "kehrvers");
// Template editor (one template; same template returned when nothing changes):
addTemplateKind(template, { id: "stich", speaker: true }); // appends; presets / invalid / listed ids ignored
setTemplateKindSpeaker(template, "refrain", false); // never writes speaker: false
moveTemplateKind(template, "refrain", 1); // one step down (-1 = up)
templateIdFromLabel("Hymnen für Sonntag", existingIds); // "hymnen-fur-sonntag" (then -2, -3, …)
```

### Migration

```ts
import { migratePrayer, planLibraryMigration } from "@orthodox-prayer-toolkit/core";

const { prayer, changed } = migratePrayer(rawPrayer, { styles: rawStylesJson });
const plan = planLibraryMigration({ prayers: rawPrayers, styles: rawStylesJson, templates: rawTemplatesJson });
```

`migratePrayer` is pure, idempotent and additive: it declares every undeclared non-preset kind used in `structure` (first appearance; `speaker: true` when the raw `styles.json` entry has the legacy token `speaker: "true"` (or boolean `true`) or a block of that kind has a speaker), drops an empty `kinds` and sets `formatVersion`. Existing entries are kept as they are (duplicates or presets are left for `validate` to report); invalid kind ids are not declared, so `validate` reports `kind-undeclared` at the block. Blocks, texts, speakers and variants are untouched. Malformed or newer-format input is returned unchanged, so it is safe before `validate`.

`planLibraryMigration` takes the raw `templates.json` content (omit when the file does not exist) and returns `{ prayers, templates, styles, templateErrors, needed }`: migrated prayers (input order, with `changed`), the full template list with a new `legacy-kinds` template (`LEGACY_KINDS_TEMPLATE_ID`, all custom kinds the library knew, sorted) or `null`, and the raw styles without legacy `speaker` tokens or `null`. The template is only planned while something else migrates and no template with that id exists, so a migrated library plans nothing. If `templates.json` is invalid, `templateErrors` lists the problems and `templates` / `styles` are `null`: nothing lossy is written, legacy tokens stay until the file is fixed, and only prayers migrate. Pass prayers as read from disk. The app writes prayers, then templates, then styles (only if every prayer write succeeded).

## Styles

```ts
import {
  resolveStyles,
  DEFAULT_KIND_STYLES,
  FALLBACK_KIND_STYLE,
  validateStyles,
  sanitizeStyles,
} from "@orthodox-prayer-toolkit/core";

const styles = resolveStyles({
  discoveredKinds: kinds,
  libraryOverrides: libraryStyles,
});
```

`resolveStyles` layers the library styles over `DEFAULT_KIND_STYLES` (presets) or `FALLBACK_KIND_STYLE` (custom kinds). Always validate untrusted `styles.json` before applying. The retired `speaker` token (`LEGACY_STYLE_FIELDS`) is dropped silently (no error); migration reads it from the raw file.

Raw `styles.json` helpers (pure; the app does the I/O):

```ts
import {
  legacyStyleFields,
  hasLegacyStyleFields,
  stylesFileObject,
  stripLegacyStyleFields,
  renameStyleKey,
  removeStyleKey,
} from "@orthodox-prayer-toolkit/core";

legacyStyleFields(raw); // { refrain: { speaker: "true" } }
const fileObject = stylesFileObject(editedStyles, raw, { remove: ["orphan"] }); // write this
stripLegacyStyleFields(raw); // raw without legacy tokens, or null when there are none
renameStyleKey(styles, "refrain", "kehrvers"); // works on sanitized or raw maps; throws if "kehrvers" exists
removeStyleKey(styles, "refrain");
```

`stylesFileObject` merges an edited (validated) style map back over the raw file so a save never drops data: per kind, fields that are valid in the raw file follow the edit (an omitted one is cleared), while legacy tokens and unknown or invalid fields stay untouched; raw entries the edit does not mention (incl. invalid kinds) stay; new kinds are appended. Kinds in `remove` keep only their legacy tokens. `raw` undefined means no file yet; any other non-object `raw` (invalid JSON passed as `null`, an array, …) throws instead of being replaced. For a kind rename, run `renameStyleKey` on both the sanitized map and the raw file first.

## Library helpers

```ts
import {
  prayerFilename,
  isPrayerFilename,
  findIdCollisions,
  filenameMatchesId,
  isLibraryManifest,
  normalizeLibraryManifest,
} from "@orthodox-prayer-toolkit/core";

prayerFilename("tropar-prokopios"); // "tropar-prokopios.json"
```

## Display title

```ts
import { resolveDisplayTitle } from "@orthodox-prayer-toolkit/core";

resolveDisplayTitle(prayer, { lang: "de", variant: "standard" });
```

## Inline text helpers

For editors that toggle note spans:

`toRuns`, `plainText`, `packInline`, `splitInline`, `markRangeAsNote`, `toggleNoteRange`, `unmarkRange`, `replaceRangeInInline`, …

`normalizeRuns` / `packInline` drop the editor artefacts ZWSP (U+200B) and BOM (U+FEFF) but keep ZWNJ (U+200C) and ZWJ (U+200D), which are spelling in Persian, Arabic, Syriac and Indic scripts. Range offsets address the normalized text (what is stored).

## Types to know

| Type | Meaning |
|------|---------|
| `Prayer` | Canonical multilingual document |
| `FlatPrayer` | Single-variant export |
| `VariantMeta` | Registry entry |
| `Block` / `Translation` | Structure units |
| `KindDef` | Custom kind entry in `Prayer.kinds` / a template |
| `KindTemplate` | Library kind template |
| `KindStyle` / `StyleMap` | Typography tokens |
| `LibraryManifest` | Optional collection meta |
| `ValidationResult` | `ok` discriminant |

## Testing convention

Prefer golden fixtures against Core behaviour (valid/invalid docs, export output, kind unions, resolved styles). Do not re-test schema rules only in the React layer.

```bash
pnpm --filter @orthodox-prayer-toolkit/core test
```

## Speakers

A Block may carry `speaker` (id, same rules as kind ids); a Variant may carry `speakers` (`{ [id]: { name?, short? } }`). `CURRENT_FORMAT_VERSION` is `3`; `validate` returns one error with `code: "format-version-newer"` for anything newer. `ValidationResult` always has `warnings` (e.g. `code: "speaker-name-missing"`); `ok` is unaffected by them.

### Speaker export options

`exportHtml`, `exportLayoutRtf` and `exportLayoutDocx` take `speakers?: { placement, form, separator }`. Defaults: `DEFAULT_SPEAKER_EXPORT` = `{ placement: "inline", form: "name", separator: ": " }`.

| Option | Values | Notes |
|--------|--------|-------|
| `placement` | `inline` · `column` · `off` | `column` only has an effect in layout DOCX (Speaker | Text table). HTML and RTF treat it as `inline` |
| `form` | `name` · `short` | Printed form of the Speaker label, with the fallbacks from [Prayer format](prayer-format.md#speakers) |
| `separator` | any string | Trailing whitespace is trimmed; one plain space always follows the label |

Inline output uses one character style per Speaker, `styleNameWithPrefix(stem, "speaker_<id>")` (`<prefix>_speaker_<id>`). HTML puts `data-speaker="<id>"` on the block and `<span data-role="speaker">` for the label. The flat export (`exportVariant`) carries `speaker` on blocks and the Variant's `speakers` map.

`exportLayoutDocxParallel` takes `speakers?: { placement, form, separator }` with `placement` `column` (default) · `inline-left` · `inline-both` · `off`. `column` adds a Speaker column on the left (labels from the left variant, including the separator via `inlineSpeakerText`); rows without a speaker still emit an empty Speaker cell so the grid stays aligned. Default: `DEFAULT_PARALLEL_SPEAKER_EXPORT` = `{ placement: "column", form: "name", separator: ": " }`. Word table treats the Speaker column as a first-class option, so the default is Own column: `Speaker | [speaker gutter] | Left | [language gutter] | Right` when both gutters are on (`gutterColumn` and `speakerGutterColumn` default on; `speakerGutterColumn` is ignored unless placement is `column`).

Pure helpers (return new Prayers, `formatVersion` normalized): `normalizeFormatVersion` (`3` iff `kinds` is non-empty, else `2` iff speakers are used, else omitted), `indexSpeakers`, `setBlockSpeaker(prayer, blockId, id | null)`, `setSpeakerLabel(prayer, {lang, variant}, id, {name?, short?})`, `removeSpeaker`. Labels: `resolveSpeakerLabel(prayer, ref, id, "name" | "short")` (this variant, else the English variant, else title-cased id / first letter), `speakerChipLabel` (same as `short`), `speakerDisplayLabel`. Ids: `SPEAKER_PRESETS`, `isValidSpeakerId`, `sanitizeSpeakerIdInput`. Which kinds may carry a speaker: `kindAllowsSpeaker(kind, prayer)` (see [Kinds](#kinds)).

## Import

Turns a Source into a Prayer without retyping its text. Readers split a Source into Source segments; an Import draft holds blocks whose text is a list of spans into those segments; Import operations change the draft. Everything is pure and lives in Core so the app, the Built-in model and external agents share one path.

- **Readers.** `readText(text, { id?, name? })` makes one segment per paragraph (blank lines separate). Lossless: `text.slice(seg.start, seg.end) === seg.text` and everything between segments is whitespace. Format Readers (HTML, PDF, Word) live outside Core but return the same `Source` type and call `assignStyleGroups(source)`: segments with an equal `look` share a style group (`{sourceId}-g{n}`); an empty `look` gets none.
- **Draft.** `createImportDraft({ sources, variant, meta? })` → one Verse block per segment in Variant key `v1` (the Reader's result, valid once title, license, source and id are set). Blocks hold `content[variantKey]: DraftSpan[]`; a missing key means no translation. Segments marked `furniture` start excluded; `drop` ranges are skipped. `excluded` lists hidden segment ids: excluding hides text, never removes it.
- **Text.** `draftBlockPlainText(draft, block, variantKey)` is the plain text Import operations address: verse lines joined by `\n`, text kinds joined by a space (lines from the source become a space). Offsets are UTF-16 code units, like the editor's. Lines are trimmed and empty lines dropped. Typed characters become `text` spans; `draftBlockHasTypedText` tells the UI to mark them.
- **Operations.** `applyImportOp(draft, op, origin?)` / `applyImportOps(draft, ops, origin?)` → `{ ok: true, draft } | { ok: false, error }`. A batch is atomic. `origin` (`{ by: "reader" | "model" | "human" | "agent" | "memory", confidence? }`, default human) is recorded on kind and speaker decisions.

| `op` | Effect |
|------|--------|
| `setKind` | `target: { block }` or `{ group }` (every block whose first visible segment is in the style group). Kind must be a preset or declared. Drops a speaker the new kind does not take |
| `split` | At a plain-text offset in one Variant; the new block gets only that Variant (like the editor). Both sides need text |
| `merge` | Block with the next block that shows text, all Variants (hidden blocks in between stay right after it). `keep: "upper" \| "lower"` picks kind and id. Split-then-merge restores the text |
| `deleteBlock` | Excludes the segments only this block uses (restorable with `setExcluded`); its share of segments other blocks use, and typed text, is dropped |
| `setNote` | Mark or unmark `[start, end)` as a note run |
| `setSpeaker` | Set or clear (`null`). Strip a printed prefix with `removeText` in the same batch |
| `removeText` | Drop `[start, end)` from the block (the source keeps it) |
| `setText` | Explicit text from the editor; unchanged characters keep their source. Allowed on a Variant the block has no text in yet (typed text) |
| `setExcluded` | Hide or show Source segments |
| `pairVariant` / `unpairVariant` | Move one Variant's text into another block / out into its own block |
| `addVariant` | New Variant (language/edition, title, licence, source) with the next free key `v{n}` (`freeVariantKey`) |
| `addSource` | Second Source (id from `freeSourceId`) in a Variant: one Verse block per segment, appended |
| `assignVariant` | Move the text of the given blocks from one Variant to another (a column of a parallel Source) |
| `pairByOrder` | Pair blocks that have only this Variant, in order, with the blocks lacking it; leftovers stay alone |
| `moveBlock`, `declareKind`, `setPrayerMeta`, `setVariantMeta` | As named; a Variant may not duplicate another's lang/variant |

`importDraftToPrayer(draft)` builds the Prayer (blocks without visible text are left out, speakers only where the kind allows them); `validateImportDraft(draft)` runs it through `validate()`; `draftBlockVisible(draft, block)` tells whether a block is part of that Prayer; `draftBlocksInGroup(draft, group)` lists the visible blocks a group `setKind` changes. `segmentColumn(segment)` gives a segment's 0-based text column (PDF `area.column` or a table's `look.column`), and `draftBlocksInColumn(draft, column, variantKey)` the blocks made only of that column — the input to `assignVariant` when a parallel Source becomes two Variants. Saving and id-collision checks stay with the app's Library writer; `prayerIdFromTitle(title)` suggests an id and `freePrayerId(id, taken)` the first free `id-2`, `id-3`, ….

The HTML Reader lives in the app (`packages/app/src/importDraft/readHtml.ts`): the page is sanitized (no scripts, handlers or remote loads), laid out in a sandboxed frame with a `default-src 'none'` CSP, and every block element's own text becomes a segment whose look is its tag, class and computed weight, style, size, colour and alignment. Pasted HTML, dropped `.html` files and fetched web addresses all go through it; addresses are fetched in the main process (`sourceFetch.ts`), never in the renderer.

The PDF Reader (`pdfLayout.ts` + `pdfText.ts`, pdf.js) turns text items into lines, splits a page at a column gutter (full-width lines such as a centred heading stay whole and order the columns band by band), and joins lines into paragraphs by look, line spacing and first-line indent. A PDF has no line-break characters: a line that runs to the column edge continues with a space, a shorter one keeps its break. Segments carry `area` (page, box in points, column) for the page view. Two Reader hints are honoured by `createImportDraft`: `drop` ranges (a hyphen where a word was broken across lines stays in the segment text but is left out of the block) and `furniture` (running heads and page numbers start out excluded). A PDF without a text layer is refused.

The Word Reader (`readDocx.ts`, JSZip) reads `word/document.xml` with `word/styles.xml`: one segment per body paragraph, table cells row by row (look `column`, 1-based, so each column forms its own style groups). The look is the paragraph style name (`paragraphStyle`), alignment, and the run formatting (weight, style, size in pt, colour, caps, underline) that covers most letters; runs that look different become `marks` (`SegmentMark`: offsets in the segment text plus their look), a hint for Note runs. Styles resolve along `basedOn`; character styles apply to their runs. Links, tracked insertions and content controls are read; deletions, field codes, headers, footers and footnotes are not. The language comes from the runs or the paragraph style, never from the document defaults.

### Decisions (first draft)

The Built-in model never writes text or JSON: it answers **Decisions**, questions with a fixed set of options, and the answer is the probability of each option. `importDecisions.ts` owns the questions as data (rules from the `encode-prayer` skill):

| Function | Does |
|----------|------|
| `firstDraftBatches(draft)` | The first-draft questions as `DecisionBatch`es: `role` of every visible block (heading, subheading, annotation, verse, not part of the prayer), `prefix` for blocks starting with "Label:" (genre label → split off as heading, instruction → Note run, speaker, spoken text), `pair` for blocks paired by order (same passage or not) |
| `speakerBatch(prefix, items)` | Follow-up for "who speaks" labels that `speakerForLabel` does not know ("Priester" → `priest` is known) |
| `decisionPrompts(batch, maxItems)` | Prompt text (rules, options with letters, worked examples, numbered items); the runtime reads item *i*'s letter right after `decisionItemPrefix(i)` |
| `decisionStep(draft, batch, item, answer)` | The Import operations for one answer against the draft as it is now, with origin `{ by: "model", confidence }`; null when nothing changes or someone other than the reader already decided the block (user edits win) |
| `uncertainDecisions(block)` | Model decisions below `UNCERTAIN_BELOW` (0.7), for "open decisions" |

The app runs them in `packages/app/src/builtInModel/` (`runFirstDraft`, a stand-in model with fixed rules for browser dev and tests); the model itself runs in its own process (`electron/modelWorker.ts`, node-llama-cpp). `pnpm --filter @orthodox-prayer-toolkit/app measure:model [library-dir]` measures hit rates against a folder of prayers.

### Decisions (Chat pane)

`chatDecisions.ts` turns one chat instruction into a few Decisions; the app (`builtInModel/chatInstruction.ts`) runs them and calls Tools.

| Function | Does |
|----------|------|
| `actionBatch(view, instruction)` | What to do: set kind, set or remove speaker, exclude, include, change wording, answer (options depend on the view: import, prayer, library) |
| `choiceBatch(question, options, instruction)` | One pick from a list (which kind, which speaker) |
| `scopeBatch(instruction)` | The open prayer only, or every prayer |
| `targetBatch(instruction, blocks)` | Yes/no per block: does the instruction mean it? |
| `plainAction(instruction)`, `plainScope(instruction)` | The answer without the model when the wording leaves no doubt ("Speaker Priester", "in allen Gebeten") |
| `sectionNumbers(instruction)`, `quotedText(instruction)` | Section numbers ("Abschnitt 3 und 7") and a quoted text ("„Ehre sei …“") named in the instruction |
| `speakerNamedIn(text)` | The speaker preset a sentence names ("Diakon" → `deacon`; "all" is skipped) |
| `draftChanges(before, after)` | What changed per block between two Import drafts (kind, speaker, excluded, included, added, removed, text), for the chat's change card |

In the app the preview is the normal `InlineEditor`: its optional `edits` prop replaces the editor's own Prayer edits, so Enter, Backspace/Delete at a cell edge, typing, Kind, Speaker, move and delete become Import operations (`packages/app/src/importDraft/editorOps.ts`). Adding empty blocks is not offered there.
