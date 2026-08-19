# Development

How to work on this repository as a contributor or agent.

## Prerequisites

- **Node.js** ≥ 20 (CI uses 22)
- **pnpm** 11.15.x (`packageManager` field in root `package.json`)

```bash
git clone https://github.com/mchlrdev/orthodox-prayer-toolkit.git
cd orthodox-prayer-toolkit
pnpm install
```

If pnpm asks to approve native builds (Electron / esbuild), allow them for local Electron work.

## Monorepo scripts

| Command | What it does |
|---------|----------------|
| `pnpm dev` | Vite app (browser) — http://localhost:5173 |
| `pnpm dev:electron` | Same UI in Electron |
| `pnpm test` | Vitest in all packages |
| `pnpm typecheck` | `tsc --noEmit` across packages |
| `pnpm build` | Build all packages |
| `pnpm --filter @orthodox-prayer-toolkit/core build` | Core dist (needed before app typecheck in clean clones) |
| `pnpm dist:dir` | Unpacked macOS app under `packages/app/release/` |
| `pnpm release` | Interactive version bump + tag + push (see [RELEASE.md](RELEASE.md)) |

## Package responsibilities

| Package | Owns |
|---------|------|
| `packages/core` | Schema, validation, exports, kind/style/library helpers — **all business rules** |
| `packages/app` | Electron main/preload, React UI, filesystem / browser FS bridge, prefs |

Rule of thumb: if a behaviour should be true without a UI, implement and test it in Core.

## Workflow tips

1. Build Core after pulling if `packages/core/dist` is missing — the app resolves the workspace package via dist.
2. Dev loads `examples/` automatically.
3. Prefer Core unit tests with JSON fixtures for format/export changes.
4. Keep the app thin: session/draft UI over Core APIs.

### Electron `ENOENT` / incomplete `.app` (macOS)

On some Node versions (notably **26**), electron’s `extract-zip` can leave a truncated `Electron.app` (stub binary only, no `Frameworks` / `Info.plist`). `pnpm dev:electron` then fails with `spawn …/Electron ENOENT` or a broken Dock app.

`packages/app` postinstall / `dev:electron` run `ensure-electron.mjs`, which re-extracts the cached zip with `ditto` when the bundle looks incomplete. Manual recovery:

```bash
rm -rf ~/Library/Caches/electron
pnpm install
# or, with a cached zip already present:
# ditto -x -k ~/Library/Caches/electron/*/electron-v*-darwin-*.zip \
#   node_modules/.pnpm/electron@*/node_modules/electron/dist
```

Prefer Node **20** or **22** (see Prerequisites) for day-to-day Electron work.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) on `main` / PRs:

1. `pnpm install --frozen-lockfile`
2. Build Core
3. Typecheck
4. Test
5. Build packages + Electron bundles (no publish)

Release builds: [RELEASE.md](RELEASE.md) and `.github/workflows/release.yml`.

## Project conventions

- **Domain vocabulary:** [glossary.md](glossary.md) — use those terms in UI copy and code comments.
- **Product decisions:** [prayer-framework.md](prayer-framework.md)
- **Format truth:** schema + [prayer-format.md](prayer-format.md)
- **Agents:** [../AGENTS.md](../AGENTS.md)

## What not to commit

- Secrets / `.env*`
- `node_modules`, build outputs (`dist`, `release`, installers)
- Local `.scratch/` (gitignored) — personal specs/tickets stay local unless explicitly published into `docs/`

## License

Contributions are under the same [MIT](../LICENSE) license as the project.
