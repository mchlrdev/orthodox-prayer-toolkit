# Overview

Orthodox Prayer Toolkit is a **standalone** open-source toolkit for liturgical prayer texts:

1. **Prayer JSON** — one self-contained file per prayer, multilingual (language + edition variant)
2. **Core library** — validate, index kinds, resolve styles, export flat / HTML / layout
3. **Desktop editor** — local-first Electron (and browser-dev) UI over a folder of JSON files

It is designed so a future website or print pipeline can **consume** a prayer library without owning the editor or embedding CMS fields in the source.

## Design principles

| Principle | Meaning |
|-----------|---------|
| Content ≠ design | Prayer JSON holds semantics (`kind`, structure, texts). Colors/fonts live in app or library styles. |
| Self-contained files | A single `{id}.json` is valid alone — no database, no required manifest. |
| Flat libraries | Taxonomy is fields on the prayer (`type`, `book`, `occasion`), not folder paths. |
| Core as the test seam | Business rules live in `@orthodox-prayer-toolkit/core`. The app stays thin (I/O + UI). |
| Local-first | The library is a directory on disk. No multi-user server in this project. |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  packages/app  (React + Mantine, Electron or browser)   │
│  folder open · editor · preview · export UI · prefs     │
└───────────────────────────┬─────────────────────────────┘
                            │ imports
┌───────────────────────────▼─────────────────────────────┐
│  packages/core                                          │
│  validate · exportVariant · exportHtml · layout RTF/DOCX│
│  indexKinds · resolveStyles · library helpers           │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  Library folder on disk                                 │
│  {id}.json · optional manifest.json · styles.json       │
└─────────────────────────────────────────────────────────┘
```

- **Core** is the only place that defines prayer validity and export shapes.
- **App** opens a **library root**, builds a **Library catalog** (metadata, not full trees), keeps **session drafts** only for the selected Prayer and unsaved paths, and writes files back.
- **Examples** under `examples/` are for development only — not a production corpus.

## Tech stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Monorepo | pnpm workspaces |
| Core build | tsup |
| App | Vite + React 19 + Mantine 7 |
| Desktop | Electron 35 + electron-builder + electron-updater |
| Schema | JSON Schema (Ajv) |
| Tests | Vitest |

Not in this repo’s stack: WordPress, Convex, a custom component kit, or a shipped production prayer corpus.

## Runtime modes

| Mode | Command | Notes |
|------|---------|--------|
| Browser UI | `pnpm dev` | Default; uses a Vite FS bridge for the examples library |
| Electron | `pnpm dev:electron` | Native window; real folder dialogs |
| Packaged app | GitHub Releases / `pnpm dist*` | Auto-update against Releases |

## Related projects

**Ortho Wiki** (separate) is the intended long-term *consumer* of a prayer library — day views linking via metadata, site renderers, etc. This toolkit stays extractable and free of wiki/CMS coupling.

## Next docs

- [Prayer format](prayer-format.md) — JSON shape
- [Library](library.md) — folder conventions
- [Core API](core-api.md) — programmatic use
- [Product decisions](prayer-framework.md) — locked choices and history
