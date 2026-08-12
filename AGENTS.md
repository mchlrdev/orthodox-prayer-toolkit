# AGENTS.md

Guidance for coding agents (and humans pairing with them) working in **orthodox-prayer-toolkit**.

## What this repo is

Standalone toolkit: multilingual liturgical **prayer JSON** + **Core** library + **local-first Electron/React editor**. Not a CMS, not Ortho Wiki itself, not a production corpus.

## Read first

| Priority | Doc |
|----------|-----|
| 1 | [docs/overview.md](docs/overview.md) |
| 2 | [docs/glossary.md](docs/glossary.md) — use these terms |
| 3 | [docs/prayer-format.md](docs/prayer-format.md) + `packages/core/schema/prayer.schema.json` |
| 4 | [docs/core-api.md](docs/core-api.md) |
| 5 | [docs/development.md](docs/development.md) |
| Product decisions | [docs/prayer-framework.md](docs/prayer-framework.md) |

Root [README.md](README.md) is the human landing page. Do not treat `.scratch/` as published truth (it is gitignored / local).

## Non‑negotiables

1. **Business logic in Core** — validate, export, kind index, style resolve, library id helpers. App = I/O + UI over Core.
2. **Schema is law** — if docs and schema disagree, fix docs or update schema + tests together.
3. **Content ≠ design** — no fonts/colors in prayer JSON; use kind styles.
4. **No empty translation keys** — missing variant = omit entry.
5. **Id ↔ filename** — `{id}.json`; never silently overwrite on id collision.
6. **Vocabulary** — Library, Block, Kind, Variant, Session draft (see glossary). Avoid “vault”, “buffer”, “cwd” for those concepts.

## Where to change what

| Change | Primary place |
|--------|----------------|
| Prayer shape / validation | `packages/core/schema`, `validate.ts`, types + Vitest |
| Flat / HTML / layout export | `packages/core/src/export*.ts`, `layoutModel.ts` |
| Kind / style helpers | `indexKinds.ts`, `resolveStyles.ts`, `validateStyles.ts` |
| Editor UX | `packages/app/src/**` |
| Release / signing | `docs/RELEASE.md`, `scripts/release.mjs`, electron-builder config |

## Verify before finishing

```bash
pnpm --filter @orthodox-prayer-toolkit/core build
pnpm test
pnpm typecheck
```

For UI-only work, at least Core tests still green if you touched shared types.

## Out of scope unless asked

- Shipping a production prayer corpus into this repo
- WordPress / wiki coupling
- Cloud sync / multi-user backend
- CLI (not in product MVP)
- Rewriting product decisions without updating `docs/prayer-framework.md`

## Dual audience

Write code and short comments for maintainers; put lasting explanations in `docs/`. Prefer updating docs when behaviour or schema changes — agents and humans both rely on them.
