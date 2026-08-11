# orthodox-prayer-toolkit

Standalone toolkit for liturgical prayer texts: self-contained multilingual JSON, Core library (validate / export / styles), and a local-first Electron editor.

**Product decisions:** [docs/prayer-framework.md](docs/prayer-framework.md)  
**Releases / signing / auto-update:** [docs/RELEASE.md](docs/RELEASE.md)  
**MVP / follow-on specs & tickets:** [.scratch/](.scratch/) (incl. dark-mode work under `.scratch/opt-dark-mode-color-system/`)

## Download

Prebuilt desktop apps (macOS, Windows, Linux) are published on
[GitHub Releases](https://github.com/orthodox-prayer-toolkit/orthodox-prayer-toolkit/releases):

| Platform | Artifact |
|----------|----------|
| macOS | `.dmg` (install) / `.zip` (used by auto-update) |
| Windows | NSIS `.exe` installer |
| Linux | `.AppImage` |

Installed builds check for updates automatically and via **Check for Updates…**.
Until code signing is configured, first launch may show OS trust warnings — see
[docs/RELEASE.md](docs/RELEASE.md).

License: [MIT](LICENSE).

## Packages

| Path | Role |
|------|------|
| `packages/core` | Schema, `validate`, flat/HTML/Layout export, `indexKinds`, `resolveStyles` |
| `packages/app` | Electron + React + Mantine editor |
| `examples/` | Dev-only sample library (not a production corpus) |

## Quick start

```bash
cd orthodox-prayer-toolkit
pnpm install
# If pnpm blocks native builds (Electron/esbuild):
pnpm approve-builds --all

pnpm test
pnpm --filter @orthodox-prayer-toolkit/core build

# Browser-first dev (default) — open http://localhost:5173
pnpm dev

# Optional Electron window
pnpm dev:electron

# Local macOS package smoke test
pnpm dist:dir
```

In browser/Electron dev, the `examples/` library loads automatically.

## Core API (test seam)

```ts
import {
  validate,
  exportVariant,
  exportHtml,
  exportLayoutRtf,
  exportLayoutDocx,
  indexKinds,
  resolveStyles,
  renameKind,
  resolveLibraryStylePrefixStem,
  DEFAULT_KIND_STYLES,
  FALLBACK_KIND_STYLE,
  DEFAULT_STYLE_PREFIX_STEM,
} from "@orthodox-prayer-toolkit/core";
```

## Library layout

```
my-prayer-library/
  manifest.json                 # optional collection meta
  .orthodox-prayer-toolkit/
    styles.json                 # library kind-style overrides
  {id}.json                     # one prayer per file
```

Identity = `id` (filename must be `{id}.json`). Display titles live on each language variant — there is no separate canonical title. Taxonomy lives in JSON fields, not folder paths.

### Id / filename rule

- On save, the file is written as `{id}.json`.
- Renaming `id` renames the file; if the target already exists, save is blocked (no silent overwrite).
- Duplicate ids across the library are reported when opening/refreshing.

## MVP coverage (tickets 01–21)

Core: schema, validate, flat export, kind index, style resolve, rename kind, collision helpers.  
App: open library, list/create/open/save/delete, validation UI, identity + variants + structure + translations, variant switch, preview, flat export, kind styles (app + library override), optional manifest.
