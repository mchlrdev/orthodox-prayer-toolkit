# Spec: Layout export (DOCX / RTF)

**Status:** ready-for-agent

Parent: `.scratch/orthodox-prayer-toolkit/spec.md` (MVP done)  
Tickets: `issues/27`–`issues/30`  
Related: `html-export-spec.md` (done); Affinity research: `research-affinity-export.md`  
Research/samples: `samples/affinity-place-test/`

### Tickets (frontier)

| # | Title | Blocked by |
|---|--------|------------|
| 27 | Include blocks without translation | — |
| 28 | Library style-prefix stem | — |
| 29 | Layout RTF end-to-end | 27, 28 |
| 30 | Layout DOCX + DOCX\|RTF switch | 29 |

Work any of 27 / 28 next; then 29; then 30.

## Problem Statement

Editors lay out liturgical prayers in Affinity Publisher / Affinity by Canva (and optionally InDesign) via **File → Place**. They need an export that carries **structure and named styles** (per block `kind`, plus inline notes) without baking typography — a blank canvas they style in the layout app. Data Merge is the wrong tool for flowing multi-style liturgy. Flat JSON and HTML already exist; neither is the Place-friendly story-document path.

## Solution

Add a third Export-modal format **Layout** with a switch **DOCX | RTF** (default DOCX). Core emits a blank-styled story document: one paragraph per structure block, paragraph style = optional prefix + `kind`, soft line breaks for `lines`, character style for inline notes, no fonts/sizes/colors. Library Settings hold a default style-name prefix stem; the modal can override per prayer. A single Export-modal checkbox **Include blocks without translation** applies to Flat JSON, HTML, and Layout alike (default off = omit, matching today’s exporters).

## User Stories

1. As a layout editor, I want to export a prayer variant as DOCX, so that I can Place it into Affinity or InDesign with named paragraph styles.
2. As a layout editor, I want to export the same content as RTF, so that I can use whichever Place format works better in my toolchain.
3. As a layout editor, I want a Format option labelled **Layout**, so that I am not forced to pick “DOCX” vs “RTF” as the primary format concept.
4. As a layout editor, I want a switch under Layout for DOCX vs RTF, so that one export path covers both serializations.
5. As a layout editor, I want DOCX selected by default when I have no saved preference, so that Affinity/InDesign’s best-documented Word path is the default.
6. As a layout editor, I want exported paragraph styles named from each block’s `kind`, so that I can map or redefine styles in Affinity/InDesign without a remapping UI in the toolkit.
7. As a layout editor, I want an optional style-name prefix (e.g. `opt_heading`), so that toolkit styles do not collide with Affinity/Word built-ins like Heading 1.
8. As a library maintainer, I want to set the default prefix stem in Library Settings, so that a whole collection shares one namespace.
9. As a library maintainer, I want an empty Library prefix to fall back to the app constant stem `opt`, so that exports still get a safe namespace without configuration.
10. As a layout editor, I want the Export modal to show the effective prefix stem for this prayer, so that I see what will be written into the file.
11. As a layout editor, I want to override the prefix stem in the Export modal for one prayer, so that a special case does not change the library default.
12. As a layout editor, I want a Reset control that restores only the prefix stem to the library/default chain, so that I undo a per-prayer override without resetting DOCX/RTF.
13. As a layout editor, I want an empty stem in the modal to mean **no prefix** (styles are bare `kind` / `note`), so that I can opt into 1:1 kind names when desired.
14. As a layout editor, I want the UI to treat `_` as hardcoded between stem and name (I type `opt`, styles become `opt_heading`), so that I cannot accidentally omit the separator.
15. As a layout editor, I want live validation of the stem (`[A-Za-z][A-Za-z0-9]*` or empty), so that invalid Word/Affinity style names never get exported.
16. As a layout editor, I want Export disabled while the stem is invalid, so that I cannot save a broken file.
17. As a layout editor, I want inline note runs exported with character style `{prefix}note` and **no** forced italic/bold/font, so that I style notes in Affinity.
18. As a layout editor, I want multi-line `lines` blocks as one paragraph with soft breaks, so that one block stays one styled unit (like HTML `<br>`).
19. As a layout editor, I want **no** title, license, or other meta paragraphs in the Place file, so that my Affinity master pages and separate title frames own that chrome.
20. As a layout editor, I want **no** baked font family, size, weight, or color on paragraph or character styles, so that Affinity is a blank canvas.
21. As a layout editor, I want the filename `{id}.{lang}.{variant}.docx` or `.rtf`, so that naming matches HTML/flat export conventions.
22. As a translator, I want blocks without a translation for the chosen variant omitted by default, so that incomplete work does not create empty layout slots.
23. As a layout editor, I want a checkbox **Include blocks without translation** always visible in the Export modal, so that one control covers Flat JSON, HTML, and Layout.
24. As a layout editor, I want that checkbox off by default, so that behavior matches existing Flat/HTML exports until I opt in.
25. As a layout editor, when include-empty is on, I want Layout to emit an empty paragraph still bearing `{prefix}{kind}`, so that structure and style hooks remain for incomplete translations.
26. As a web integrator, when include-empty is on, I want HTML to emit an empty element with `data-kind` (same tag rules as today), so that DOM structure stays aligned with the prayer skeleton.
27. As a data consumer, when include-empty is on, I want Flat JSON to keep the block with an empty payload (`text: ""` or `lines: []` as appropriate to the block’s usual shape), so that downstream tools see the slot.
28. As an editor, I want my per-prayer choice of include-empty remembered after a successful export, so that I do not re-tick it every time.
29. As an editor, I want DOCX vs RTF and the prefix stem remembered per prayer after a successful Layout export, so that Layout settings stick.
30. As an editor, I want HTML tag-map/wrapper prefs saved only when I export HTML, so that exporting Flat JSON or Layout does not clobber HTML settings.
31. As an editor, I want Layout DOCX/RTF and prefix saved only when I export Layout, so that exporting HTML does not clobber Layout settings.
32. As an editor, I want include-empty always written into prefs on any successful export, so that the cross-format flag stays in sync.
33. As a desktop user, I want the save dialog to accept binary DOCX as well as text RTF/HTML/JSON, so that Word files are not corrupted by UTF-8 string writes.
34. As a Core consumer, I want Layout export available from the Core package without Electron, so that tests and future tools can generate DOCX/RTF from prayer JSON alone.
35. As a Core consumer, I want `includeBlocksWithoutTranslation` on Flat, HTML, and Layout export options, so that omission vs empty slots is one rule across formats.
36. As an Affinity by Canva user, I want linked Place of the exported file to remain possible (external file on disk), so that I can Update from Resource Manager after re-export (no toolkit-side live link required).
37. As an InDesign user, I want the same DOCX/RTF Place files, so that one exporter serves both layout apps.
38. As a library maintainer, I want the Library Settings prefix field to use the same stem + hardcoded `_` UX as the modal, so that mental models match.
39. As a toolkit maintainer, I want golden tests for Layout export (style names, soft breaks, notes, include-empty), so that Affinity-facing contracts do not regress.
40. As a toolkit maintainer, I want existing Flat/HTML golden behavior unchanged when include-empty is omitted/false, so that this feature is additive.

## Implementation Decisions

### Seams (agreed)

- **Primary:** Core public export API — new Layout exporter (DOCX + RTF sharing one content model; format is serialization only) and an `includeBlocksWithoutTranslation` option on Flat, HTML, and Layout exporters.
- **Secondary:** App session helpers + export prefs (prefix resolution, per-prayer prefs, orchestration into the save dialog). Prefer testing helpers over React trees.
- **Tertiary:** Save-dialog / IPC must support binary payloads for DOCX; no business rules there.

### Format & UI

- Export modal Format list: Flat JSON | HTML | **Layout**.
- Under Layout: segmented control or equivalent for **DOCX** | **RTF**; default **DOCX** when no Layout prefs exist.
- Under Layout: prefix stem field + fixed `_` affordance; Reset restores stem only to library/default chain.
- Always show checkbox label exactly: **Include blocks without translation** (default unchecked).
- No kind→style remap UI; no typography controls; no document meta/title block.

### Style naming

- Paragraph style name = `{stem}_` + `kind` when stem non-empty; else bare `kind`.
- Character style for note runs = `{stem}_` + `note` when stem non-empty; else `note`.
- Stem validation: empty **or** `[A-Za-z][A-Za-z0-9]*`. Invalid → live error, Export disabled.
- Separator `_` is always applied by the app when stem is non-empty; users never type the trailing underscore as part of the stem contract.
- Styles carry **no** visual run/paragraph formatting (blank canvas). Inline notes are distinguished only by character style identity, not by italic/bold.

### Prefix resolution chain

1. Per-prayer export prefs stem, if present for this prayer.
2. Else Library Settings stem (persisted on the library manifest as a new optional field).
3. Else app constant stem **`opt`** (not user-editable; there are no app settings).

- Empty stem **in Library Settings** → treat as missing → fall through to `opt`.
- Empty stem **in the Export modal** (explicit) → **no prefix** for that export/prefs (bare kind names). Reset sets stem back to the resolved library/default stem (never “empty means bare” via Reset unless library is somehow configured that way — Reset targets the library chain, which yields at least `opt`).

### Content rules

- Export only the selected language/variant body (structure blocks), same variant-missing error behavior as existing exporters when the variant is not in the registry.
- `lines`: one paragraph; soft line breaks between lines.
- `text`: one paragraph; note runs use the note character style.
- Omit blocks with no translation unless `includeBlocksWithoutTranslation` is true.
- Include-empty payloads:
  - **Layout:** empty paragraph, still styled with `{prefix}{kind}`.
  - **HTML:** empty element, existing tag map / `data-kind` rules; no inner text.
  - **Flat JSON:** keep `id`/`kind`; empty payload as `text: ""` when the block’s translation shape would have been `text`, else `lines: []` when it would have been `lines`. If there is no translation at all, prefer `text: ""` as the empty slot shape (simplest stable default when shape is unknown).

### Library manifest

- Extend library manifest with an optional prefix-stem field (string; validated with the same stem rules; empty/absent → fallback `opt`).
- Library Settings UI exposes the stem + `_` affordance; save via existing manifest write path.
- Do not put Layout DOCX/RTF choice or include-empty on the manifest (those are per-prayer export prefs).

### Per-prayer export prefs

- Extend the local export-prefs store beyond HTML-only fields to also hold: `includeBlocksWithoutTranslation`, and when set via Layout export: `layoutFormat` (`docx` | `rtf`) and `layoutPrefixStem` (string, may be empty for bare names).
- On successful export:
  - Always persist `includeBlocksWithoutTranslation` from the modal.
  - If format is HTML: persist HTML fields as today.
  - If format is Layout: persist `layoutFormat` + `layoutPrefixStem`.
  - If format is Flat JSON: do not rewrite HTML or Layout-specific fields.
- Loading the modal: restore include-empty and any Layout/HTML fields from prefs; Layout stem defaults through the resolution chain when no per-prayer stem prefs exist.

### Filenames & save dialog

- `{id}.{lang}.{variant}.docx` / `.rtf` / existing `.html` / `.flat.json`.
- Save API must accept text **or** binary (DOCX is binary). RTF may be UTF-8 text. Filters and dialog titles should match the chosen format.

### Dependencies

- Prefer a maintained DOCX builder for blank named styles; RTF can be emitted as text with a stylesheet naming the same styles. Keep Core free of Electron.

### Affinity / InDesign expectations (product, not code)

- Target workflow: Place into a text frame; optionally link text in Affinity by Canva. No Data Merge exporter in this spec. Auto-update depends on the layout app, not the toolkit.

## Testing Decisions

- Good tests assert **external behavior**: given a prayer + options, Flat/HTML/Layout outputs match expected structure, style names, omission vs empty slots, and soft-break/note marking — not React renders or IPC plumbing.
- **Primary module:** Core exporters (extend existing Core vitest + golden fixtures; add Layout goldens for DOCX/RTF observable contracts — at minimum style names and plain-text/paragraph structure extractable in tests).
- **Prior art:** `exportVariant` / `exportHtml` tests and fixtures under Core; app `exportPrefs` / `exportPrayerVariant` unit tests for prefs merge rules and filename/orchestration.
- When include-empty is false/absent, Flat and HTML goldens must remain identical to current behavior.
- App tests cover prefix resolution chain and prefs save partial-update rules; do not duplicate Core Layout serialization tests in the UI layer.
- Manual Affinity Place check remains optional smoke (samples already under research folder); not a CI gate.

## Out of Scope

- Data Merge (CSV/TSV/JSON/XLSX) exporters
- Live linked-text protocol beyond writing a normal file to disk
- Markdown / PDF / IDML exporters
- Kind→style remapping UI
- Baking fonts, sizes, colors, or sample typography into Layout styles
- Document properties / title / license paragraphs in the Place file
- App-wide settings UI for the `opt` fallback stem
- Changing prayer JSON schema for export (prefix and include-empty are export/manifest/prefs concerns)
- Automatic Affinity style mapping or InDesign style-mapping presets
- Multi-variant or multi-prayer batch export in one file

## Further Notes

- Grilling settled this design (Layout switch, blank canvas, `opt_` fallback via stem `opt`, include-empty as cross-format modal checkbox, prefs save policy B).
- Publisher V2 may Place without live link; Affinity by Canva documents linked DOCX/RTF/TXT — product copy can mention Place + optional link, not promise auto-update on all Affinity versions.
- Earlier scratch note that Affinity exporters were out of scope for the HTML spec is superseded **for Layout only** by this spec; HTML scope otherwise unchanged.
- Test samples used during research (`samples/affinity-place-test/`) intentionally had typography; production Layout export must **not** repeat that — blank styles only.
