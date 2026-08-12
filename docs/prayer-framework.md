# Product decisions — Orthodox Prayer Toolkit

Canonical **product** decisions for this repository. On-disk format details: [prayer-format.md](prayer-format.md). Architecture: [overview.md](overview.md).

> Historically this file lived under Ortho Wiki planning docs; the toolkit is now a standalone GitHub project.

## Goal

A **standalone open-source toolkit** for liturgical prayer texts:

1. Prayers as **self-contained JSON** (one file = one prayer)
2. **Multiple translations** per prayer (language **and** edition/script variant)
3. **Local-first editor** (Electron; browser-first for development): open a library folder, edit, switch variants, save
4. **Exports** for downstream use: flat single-variant JSON, HTML, layout RTF/DOCX
5. Optional further bridges (e.g. Affinity-oriented workflows) without baking layout into the source

**Content ≠ design:** JSON holds semantics (`kind`, structure, texts). Presentation (preview, web, print) lives in styles and exporters.

Ortho Wiki remains a **future consumer** of a separate prayer library. This toolkit stays standalone (own packages; no WordPress/wiki runtime dependency).

Related: [affinity-bridge.md](affinity-bridge.md).

---

## Locked decisions

| Topic | Decision |
|-------|----------|
| Name | `orthodox-prayer-toolkit` |
| Source format | JSON, schema-validated |
| Markdown as source | no |
| Runtime | Core library + Electron app (browser UI for dev) |
| CLI | no (not in current product scope) |
| Prod library in this repo | no — `examples/` only; production corpus lives elsewhere |
| Storage | local-first folder; create/read/write/delete files |
| Database | no |
| File layout | flat `{id}.json`; identity = `id` |
| Taxonomy | fields on the prayer (`type`, `book`, `occasion`, …), not paths |
| Manifest | optional; collection meta only (`description`, `defaultVariant`, `stylePrefixStem`, …) |
| Languages | per prayer in `variants[]` |
| Sync across variants | no enforcement; missing translation = omit entry |
| Display title | per variant; no separate canonical English `title` field |
| Styles | not in prayer JSON; app defaults + library override |
| Kind vocabulary | open string; UI presets are suggestions, not schema enums |

### Tech stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Monorepo | pnpm workspaces |
| Core build / app | Vite (app) · tsup (core) |
| UI | React + Mantine |
| Desktop | Electron + electron-builder + electron-updater |
| Tests | Vitest |

Not: hand-maintained shadcn farm in-repo; not WordPress/Convex as toolkit stack.

---

## Architecture (summary)

```
packages/core/     Schema, validate, exports, kinds, styles, library helpers
packages/app/      Electron + React + Mantine — thin over Core
examples/          Dev mini-library only
```

- **Core** is the only business-logic seam (testable without UI).
- **App** is thin: folder I/O, editor, preview, style panel, export UI.
- A future website loads a **foreign** library and renders with its own pipeline — outside this MVP.

---

## Data model (summary)

Full field list and examples: [prayer-format.md](prayer-format.md).

- **Model A:** shared `structure[]`; texts on block `translations[]` keyed by `(lang, variant)`.
- **Variants:** objects `{ lang, variant, title, license, source }` — not slash-keys.
- **Kinds:** open strings; recommended presets today: `heading`, `subheading`, `annotation`, `verse`.
- **Inline notes:** optional run arrays (`text` / `note`) inside `text` / `lines`.

---

## Electron / app scope

Shipped and intended behaviour includes:

- Open library folder; list / create / open / save / delete prayers
- Edit identity, variants, structure, translations; switch variants
- Schema validation in the UI
- Preview with kind styles (app + library override)
- Export: flat JSON, HTML, layout RTF/DOCX
- Optional manifest; id collision detection; kind rename across library with confirm
- Auto-update against GitHub Releases ([RELEASE.md](RELEASE.md))

---

## What must not enter prayer JSON

- Fonts, colours, weights (except via separate library/app style maps)
- HTML page chrome, CMS fields, site navigation
- Affinity frame positions

Semantic flags may be added later; pixels stay out.

---

## Quality rules

1. One file = one logical unit; self-contained  
2. `id` / filename globally unique in the library  
3. Stable block `id`s; open-string `kind`  
4. `verse.lines` = content lines, not layout lines  
5. Separate rubrics/annotations from prayer text via `kind`  
6. No empty translation keys — omit missing ones  
7. License + source per variant; unclear → `draft` / `unknown`

---

## Ortho Wiki / calendar (future)

- Day views should link via stable IDs / metadata — not copy-paste prayer bodies into the calendar.
- Wiki does not own the toolkit; it consumes a library + its own renderer later.
- Older DE-only sketches (`title_de`, fixed `language: "de"`) are superseded by this format.

---

## Out of scope (product)

- CLI
- IDML direct write / automatic book TOC
- Wiki build pipeline / submodule wiring inside this repo
- Cloud sync, multi-user server, database
- Enforcing structural parity across variants
- Shipping a production prayer corpus here

HTML and layout exporters **are in scope** now (Core + app). Affinity-oriented style naming remains documented in [affinity-bridge.md](affinity-bridge.md).

---

## Docs index

→ [Documentation hub](README.md)
