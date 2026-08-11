# Spec: orthodox-prayer-toolkit (MVP)

Status: done

## Problem Statement

Liturgical prayers need to exist as structured, shareable data with multiple translations (language and variant within a language), editable locally without a database, and reusable by Ortho Wiki and other consumers later — without baking layout, CMS HTML, or a single locale into the source. The previous DE-only prayer JSON sketch cannot express parallel translations or a standalone editing workflow.

## Solution

Build a standalone toolkit `orthodox-prayer-toolkit` (housed under the Ortho Wiki project tree but independently packaged) with:

1. Self-contained multilingual prayer JSON (shared structure, per-block translations).
2. A Core library for validate / export / kind-index / style-resolve.
3. An Electron app that opens a local library folder and edits prayers with variant switching and persistent kind styles.

Ortho Wiki remains a future consumer of a separate prayer library, not the owner of toolkit internals.

## User Stories

1. As a translator, I want one prayer file to hold several language/variant texts on the same structure, so that I work like on a shared skeleton rather than duplicated files.
2. As a translator, I want variants identified by language code plus variant slug with metadata, so that multiple German (or Church Slavonic) editions can coexist.
3. As a translator, I want missing translations to simply omit entries, so that incomplete work does not pollute files with empty keys.
4. As an editor, I want each prayer file to load alone without folder or manifest context, so that I can share a single JSON file.
5. As an editor, I want a stable prayer `id` and English canonical title, so that identity stays language-neutral.
6. As an editor, I want display title, license, and source per variant, so that translation rights stay accurate.
7. As an editor, I want every structure block to have a stable `id` and an open-string `kind`, so that custom text roles are possible without schema churn.
8. As an editor, I want to add or rename kinds only in block configuration for the current prayer, so that kind vocabulary does not become a global taxonomy chore.
9. As an editor, I want recommended kind presets (rubric, verse, prose, response, title, note), so that common cases are fast.
10. As a desktop user, I want an Electron app that opens a folder of JSON prayers, so that I work local-first with real filesystem access.
11. As a desktop user, I want to create, open, save, and delete prayer files in that folder, so that the library is just files on disk.
12. As a desktop user, I want to switch and create variants in the UI, so that I can edit without hand-editing JSON.
13. As a desktop user, I want schema validation feedback in the app, so that invalid files are caught before sharing.
14. As a desktop user, I want to export a single variant as flat JSON, so that downstream tools get a simple one-language document.
15. As a desktop user, I want preview typography (size, color, weight, font style) per kind, so that reading in the app is clear.
16. As a desktop user, I want app default styles plus per-library style overrides, so that a shared library can carry its look.
17. As a desktop user, I want newly discovered kinds from the opened library to get a default style and appear in the style panel, so that custom kinds are immediately styleable.
18. As a library maintainer, I want an optional manifest with only collection metadata, so that languages remain inside each prayer file.
19. As a library maintainer, I want flat `{id}.json` storage with category fields inside JSON, so that identity stays unique and taxonomy does not depend on paths.
20. As a toolkit maintainer, I want the Core package usable without the Electron app, so that tests and future consumers do not require the UI.
21. As a toolkit maintainer, I want no production corpus inside the toolkit (examples only), so that Ortho Wiki’s library stays a separate artifact.
22. As an Ortho Wiki developer, I want the toolkit to stay free of WordPress/CMS coupling, so that the site can later load a library with its own renderer.
23. As a future integrator, I want the export/plugin surface left open, so that Affinity/HTML/Markdown exporters can be added later without reshaping Core prayer data.
24. As a Church Slavonic editor, I want script/edition differences as variants under `cu` (e.g. synodal-cyrl vs synodal-latn), so that language codes stay stable without a separate script field.
25. As a reviewer, I want licenses and sources required per variant, so that unclear rights stay marked draft/unknown.
26. As a calendar integrator, I want `saint_id` / `feast_id` links on prayers, so that day views can attach texts without copying content into the calendar.

## Implementation Decisions

- Product name: `orthodox-prayer-toolkit`; develop as a standalone tree inside the Ortho Wiki repo, extractable later; no hard dependency on Wiki/CMS packages.
- Packages: Core (schema + pure functions) and Electron app; no CLI in MVP.
- Tech stack: TypeScript, pnpm workspaces, Vite, React, Electron, Vitest; UI components via Mantine (no hand-rolled component kit, no shadcn-in-repo maintenance model).
- Single test seam: Core public API — parse/validate prayer JSON; export one variant to flat JSON; index kinds across a set of prayers; resolve styles from app defaults + library overrides + discovered kinds (unknown kinds get default preset).
- Electron app is a thin client over Core plus filesystem I/O (React + Mantine); business rules must not be reimplemented only in the UI.
- Prayer JSON shape: shared `structure[]` (model A); top-level `variants[]` registry; per-block `translations[]` as `{ lang, variant, …payload }` objects; omit missing translations.
- Field names in English; canonical `title` in English; per-variant display `title`.
- `kind` is an open string in the schema (not a closed enum); presets live in the app.
- Kinds are introduced only by assigning them on a block; dropdown suggestions = presets ∪ kinds present in the current prayer’s structure; renaming a kind rewrites blocks in that prayer only.
- Library layout: flat prayer files; optional `manifest.json` (name, description, version, optional defaultVariant only); library style overrides beside the collection (e.g. under a toolkit-owned folder), not inside prayer files.
- Style MVP fields per kind: fontSize, color, fontWeight, fontStyle; store as an extensible map.
- Style persistence model C: app defaults overridden by library styles.
- Example prayers only under the toolkit for development; production Ortho Wiki library is a separate repo/artifact later.
- Supersedes the earlier DE-locked sketch (`title_de`, `language: "de"` const) for toolkit work; Wiki-specific Affinity bridge remains a later consumer concern.
- Domain vocabulary: Prayer, Variant (`lang` + `variant`), Block (`id`, `kind`), Structure, Library, Flat export, Kind style — align with `docs/04-prayer-framework.md`.

## Testing Decisions

- Good tests assert observable Core behavior only (valid/invalid documents, flat export contents, kind unions, resolved style maps) — not Electron internals or React component trees.
- Primary module under test: Core library.
- Prefer golden JSON fixtures (input prayer + expected flat export / expected kind set / expected resolved styles), similar in spirit to calendar-engine pascha fixtures.
- App-level checks (manual or thin smoke) only for “folder open / save round-trip” after Core is green; do not duplicate validation logic tests in the UI layer.

## Out of Scope

- CLI
- Affinity / InDesign / Markdown / HTML export plugins (architecture may leave hooks; implementations later)
- Ortho Wiki website loader, submodule wiring, or WP prayer CPT sync
- Cloud sync, multi-user server, database
- Enforcing structural parity across variants
- Browser-only filesystem app (File System Access API) as MVP runtime
- Shipping a production prayer corpus inside the toolkit

## Further Notes

- Design authority for this feature: grilling outcome captured in `docs/04-prayer-framework.md` (rewritten with this spec).
- Related later doc: Affinity bridge (`04b`) — maps kinds to named paragraph styles after flat or multilingual source exists; not MVP.
- D20 in project decisions (prayers editorial in WordPress meta) describes an Ortho Wiki CMS path; the toolkit’s canonical authoring path for this effort is local JSON libraries. Reconcile Wiki ingestion when the site consumes a library.
