# Documentation

Guides for people using or extending the Orthodox Prayer Toolkit, and for agents working in this repository.

## Start here

| I want to… | Read |
|------------|------|
| Understand what the project is | [Overview](overview.md) |
| Author or consume prayer JSON | [Prayer format](prayer-format.md) |
| Encode a prayer with an LLM | [LLM ingest skill](../skills/encode-prayer/SKILL.md) |
| Set up a library folder | [Library layout](library.md) |
| Call Core from code | [Core API](core-api.md) |
| Hack on the repo | [Development](development.md) |
| Speak the domain language | [Glossary](glossary.md) |
| Ship a desktop build | [Releasing](RELEASE.md) |
| Plan Affinity / layout print | [Affinity bridge](affinity-bridge.md) |
| Orient a coding agent | [../AGENTS.md](../AGENTS.md) |

## Product decisions

Longer product rationale and locked decisions (content vs design, stack, out of scope):

→ [prayer-framework.md](prayer-framework.md)

The **schema and file shape** in [prayer-format.md](prayer-format.md) are the source of truth for the on-disk format. If anything in older notes conflicts with the schema under `packages/core/schema/`, trust the schema and Core tests.

## Repo map

```
orthodox-prayer-toolkit/
  packages/core/     Pure TypeScript: schema, validate, export, styles
  packages/app/      Electron + React + Mantine editor
  examples/          Dev sample library (not production content)
  docs/              This documentation
  skills/            Portable LLM ingest skill (`encode-prayer/SKILL.md`)
  scripts/           Release helper
  .github/workflows/ CI + release builds
```

Local scratch specs/tickets (if present on a maintainer machine) live under `.scratch/` and are **gitignored** — they are not part of the published project docs.
