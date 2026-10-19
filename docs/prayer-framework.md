# Product decisions — Orthodox Prayer Toolkit

Canonical **product** decisions for this repository. On-disk format details: [prayer-format.md](prayer-format.md). Architecture: [overview.md](overview.md).

> Historically this file lived under Ortho Wiki planning docs; the toolkit is now a standalone GitHub project.

## Goal

A **standalone open-source toolkit** for liturgical prayer texts:

1. Prayers as **self-contained JSON** (one file = one prayer)
2. **Multiple translations** per prayer (language **and** edition/script variant)
3. **Local-first editor** (Electron; browser-first for development): open a library folder, edit, switch variants, save
4. **Exports** for downstream use: flat single-variant JSON, HTML, layout RTF/DOCX, Word table (two variants, optional empty middle column)
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
| Direction | optional `rtl: true` on the variant (omit when LTR). Kind `dir` in `styles.json` may override (`rtl` / `ltr`; omit = inherit). |
| Sync across variants | no enforcement; missing translation = omit entry |
| Display title | per variant; no separate canonical English `title` field |
| Styles | not in prayer JSON; library `styles.json` over built-in defaults |
| Kind vocabulary | open string; UI presets are suggestions, not schema enums |
| Speakers on blocks | Optional `speaker` id on a Block, shared by all Variants. Not typed into the text. |
| Speaker labels | Per Variant, inside the prayer file (`variants[].speakers`). No Library templates, no app settings needed to read or export. |
| Format version | `formatVersion` is written as `2` only when the file uses Speakers; missing = `1`. Newer than the app → "needs a newer app", not schema errors. |
| Speaker allowance | Per Kind via the styles token `speaker`. Verse always; heading, subheading, annotation never; custom Kinds when enabled in the Library. |

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
- **App** is thin: folder I/O, editor, preview, settings (including kind styles), export UI.
- A future website loads a **foreign** library and renders with its own pipeline — outside this MVP.

---

## Data model (summary)

Full field list and examples: [prayer-format.md](prayer-format.md).

- **Model A:** shared `structure[]`; texts on block `translations[]` keyed by `(lang, variant)`.
- **Variants:** objects `{ lang, variant, title, license, source }` — not slash-keys.
- **Kinds:** open strings; built-in presets `heading`, `subheading`, `annotation`, `verse` are fixed in the editor (display labels capitalized; not renameable/deletable). Custom kinds may be added; styles remain editable for all kinds.
- **Inline notes:** optional run arrays (`text` / `note`) inside `text` / `lines`.

---

## Electron / app scope

Shipped and intended behaviour includes:

- Open library folder; list / create / open / save / delete prayers
- Edit identity, variants, structure, translations; switch variants
- Typing in a Block cell commits into the session draft on idle (~400ms), blur, or flush (Save / leave / export / find) — not per keystroke. Schema validation in the UI runs from the session draft, 500ms after it updates: affected blocks are marked, the prayer header shows the issue count
- Undo / redo per prayer across all edits (text, kinds, moves, deletes); one history per open prayer, so deleting a block needs no confirm
- Enter splits a block at the caret (new empty cells in the other columns). Ctrl+Enter (Cmd+Enter on macOS) keeps the structure and sends the text after the caret into the next block in this column — into an empty cell, or in front of text already there. ArrowDown on a block's last visual line / ArrowUp on its first moves the caret into the next / previous block in the same column. Backspace at a block's start joins it onto the block above, Delete at its end pulls the block below in. The block the caret was in keeps its kind and id; text joins with no separator in every variant, verse keeps its lines, and verse ↔ text reshapes like a kind change (notes kept). A block empty in every variant is removed instead. One undo step.
- Speakers: a red chip before the first column's text opens the Speaker dropdown (chip, Block chrome trigger, right-click "Speaker ▸", `Mod+Shift+P`); "No speaker" removes it. The Speakers pane in Prayer settings lists the Speakers of the prayer with name and short per Variant, block counts and delete. Export places Speakers inline (HTML, RTF, DOCX), in a separate column (layout DOCX, Word table) or off, using one character style per Speaker (`<prefix>_speaker_<id>`), with name or short form and a separator.
- Shortcuts (Cmd on macOS, Ctrl elsewhere): S save, Shift+S save all, O open library, N new prayer, `,` settings, Z / Shift+Z undo / redo, Shift+P Speaker dropdown on the block holding the caret; also listed in the menu bar. Windows/Linux hide the in-window bar by default (Alt to show, or View → Show Menu Bar to pin); every action is also reachable in the app. Zoom: Cmd/Ctrl + `+` / `-` / `0` (and `=` / numpad on Windows/Linux).
- Right-click menus on prayer rows, the prayer list and blocks (Block menu: Kind ▸, and Speaker ▸ when the Kind allows a Speaker; Cut/Copy/Paste when the click is in text)
- The open library folder is watched: unchanged prayers reload from disk, prayers with unsaved edits show "Changed on disk" / "Deleted on disk"
- Refresh rescans the library and reloads the open prayer from disk; unsaved prayers are prompted first
- Preview with kind styles (library `styles.json` over built-in defaults)
- App settings: appearance (light/dark/system) and editor text size (px). Kind-style sizes (S–XL, stored as rem) scale from that base in the editor; export HTML still uses the stored rem against the consuming page.
- Export: flat JSON, HTML, layout RTF/DOCX, Word table (two variants, optional empty middle column; Word only)
- Optional manifest; id collision detection; kind rename across library with confirm
- Auto-update against GitHub Releases ([RELEASE.md](RELEASE.md)); downloads in the background, and "Install and Restart" asks to save or discard unsaved prayers first

---

## What must not enter prayer JSON

- Fonts, colours, weights (except via library `styles.json`)
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
