# Glossary

Shared domain language for humans and agents. Prefer these terms in UI, docs, and code comments.

| Term | Meaning | Avoid |
|------|---------|--------|
| **Library** | A folder of prayer JSON files plus optional `manifest.json` and `.orthodox-prayer-toolkit/styles.json`. Identity of each prayer is its `id` / `{id}.json` filename. | corpus, vault, workspace, project folder |
| **Library root** | Absolute path of an opened Library. Electron only accepts filesystem ops against roots opened this session (folder dialog or startup examples). | working directory, cwd |
| **Session draft** | Unsaved in-memory Prayer for an open file path, including validation errors and visible variant columns. Multiple drafts may exist when switching prayers without saving. | buffer, dirty state, editor state |
| **Prayer** | One self-contained multilingual JSON document (`Prayer` type). | document (ambiguous), page |
| **Variant** | One `(lang, variant)` edition in the prayer’s registry, with its own title, license, and source. | locale alone, translation file |
| **Block** | One unit in a Prayer `structure` (`id`, `kind`, `translations`). Editor commits and reorder ops mutate Blocks, not free-form HTML. | paragraph, section, row |
| **Kind** | Open string semantic role on a block (`verse`, `annotation`, custom…). | tag (HTML), style name |
| **Kind style** | Visual tokens for a block kind (`fontSize`, `color`, `fontWeight`, `fontStyle`, optional `initialCap` / `htmlTag`). From app defaults and library `styles.json` after allowlisted validation. | CSS theme, stylesheet |
| **Kind rename** | Renaming a block kind updates every prayer in the open Library that uses it (and both style maps). Confirm when more than one prayer is affected. | refactor kind, retag |
| **Flat export** | Single-variant derived document from `exportVariant`. | “compile”, “render” |
| **Structure (model A)** | Shared block skeleton; texts hang off per-variant translations on each block. | parallel files per language |

## Related

- [Prayer format](prayer-format.md)
- [Library layout](library.md)
- [Overview](overview.md)
