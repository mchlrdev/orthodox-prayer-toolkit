# Orthodox Prayer Toolkit

**Local-first editor and library for multilingual liturgical prayer texts.**

One prayer = one JSON file. Shared structure, per-language (and per-edition) translations, schema validation, and exports — without a database, CMS, or cloud account.

[Download](#download) · [Quick start](#quick-start) · [Documentation](docs/README.md) · [Releases](https://github.com/mchlrdev/orthodox-prayer-toolkit/releases)

---

## Why this exists

Liturgical prayers are usually trapped in Word docs, PDFs, or single-locale CMS fields. Parallel translations get out of sync; layout and content get mixed; sharing a text means copying files by hand.

This toolkit treats prayers as **structured data**:

- **Self-contained** — each prayer file loads without a database or folder hierarchy
- **Multilingual by design** — language + variant (edition/script) on the same structure
- **Content ≠ design** — semantics in JSON; typography in app/library styles
- **Local-first** — open a folder on disk; files are the source of truth
- **Reusable** — Core library for validate / export; desktop app for editing

Downstream sites, print tools, or Affinity workflows can consume flat JSON, HTML, or layout exports without owning the authoring format.

## Features

| Area | What you get |
|------|----------------|
| **Editor** | Open a library folder, create/edit/delete prayers, switch variants, outline navigation, live preview |
| **Validation** | JSON Schema + Core `validate()` with errors in the UI |
| **Styles** | Kind-based typography (app defaults + per-library overrides) |
| **Export** | Flat single-variant JSON, HTML, Layout RTF / DOCX (named paragraph styles) |
| **Core package** | Pure TypeScript API usable without Electron |

## Download

Prebuilt apps for **macOS**, **Windows**, and **Linux** are on
[GitHub Releases](https://github.com/mchlrdev/orthodox-prayer-toolkit/releases):

| Platform | Artifact |
|----------|----------|
| macOS | `.dmg` (install) · `.zip` (auto-update) |
| Windows | NSIS `.exe` |
| Linux | `.AppImage` |

Installed builds check for updates automatically (and via **Check for Updates…**).

**macOS note (unsigned builds):** If macOS says the app is **damaged**, run once:

```bash
xattr -cr "/Applications/OrthodoxPrayerToolkit.app"
```

(Then open the app again.) Details and signing plans: [docs/RELEASE.md](docs/RELEASE.md).

## Quick start

**Requirements:** Node.js 20+, [pnpm](https://pnpm.io) 11.

```bash
git clone https://github.com/mchlrdev/orthodox-prayer-toolkit.git
cd orthodox-prayer-toolkit
pnpm install

pnpm test
pnpm --filter @orthodox-prayer-toolkit/core build

# Browser-first UI (default) — http://localhost:5173
pnpm dev

# Optional native window
pnpm dev:electron
```

In development, the `examples/` sample library loads automatically (not a production corpus).

| Script | Purpose |
|--------|---------|
| `pnpm test` | Run all package tests |
| `pnpm typecheck` | TypeScript across the monorepo |
| `pnpm build` | Build all packages |
| `pnpm dist:dir` | Local unpacked macOS app (smoke test) |
| `pnpm release` | Bump version → tag → push (CI builds installers) |

## Packages

| Path | Role |
|------|------|
| [`packages/core`](packages/core) | Schema, validate, flat/HTML/layout export, kind index, styles |
| [`packages/app`](packages/app) | Electron + React + Mantine editor |
| [`examples/`](examples) | Dev-only sample library |

## Library layout

```
my-prayer-library/
  manifest.json                      # optional collection meta
  .orthodox-prayer-toolkit/
    styles.json                      # kind-style overrides
  tropar-prokopios.json              # one prayer per file → {id}.json
```

- **Identity** = `id` (filename must be `{id}.json`)
- **Display titles** live on each language variant — there is no separate canonical title
- **Taxonomy** (`type`, `book`, `occasion`, …) lives in JSON fields, not folder paths

Details: [Prayer format](docs/prayer-format.md) · [Library](docs/library.md)

## Core API (sketch)

```ts
import {
  validate,
  exportVariant,
  exportHtml,
  exportLayoutRtf,
  exportLayoutDocx,
  indexKinds,
  resolveStyles,
} from "@orthodox-prayer-toolkit/core";

const result = validate(json);
if (result.ok) {
  const flat = exportVariant(result.prayer, { lang: "de", variant: "standard" });
}
```

Full surface: [Core API](docs/core-api.md)

## Documentation

| Doc | Audience |
|-----|----------|
| [Documentation hub](docs/README.md) | Everyone |
| [Overview & architecture](docs/overview.md) | Humans & agents |
| [Prayer format](docs/prayer-format.md) | Authors & integrators |
| [Development](docs/development.md) | Contributors |
| [Glossary](docs/glossary.md) | Shared vocabulary |
| [Releasing](docs/RELEASE.md) | Maintainers |
| [AGENTS.md](AGENTS.md) | Coding agents |

## Status

Early open-source release (`0.1.x`). The MVP editor and Core export surface are usable; signing/notarization and a production prayer corpus are intentionally out of this repository.

## License

[MIT](LICENSE) © Orthodox Prayer Toolkit contributors
