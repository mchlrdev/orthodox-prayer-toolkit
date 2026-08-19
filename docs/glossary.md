# Glossary

Shared domain language for humans and agents. Prefer these terms in UI, docs, and code comments.

| Term | Meaning | Avoid |
|------|---------|--------|
| **Library** | A folder of prayer JSON files plus optional `manifest.json` and `.orthodox-prayer-toolkit/styles.json`. Identity of each prayer is its `id` / `{id}.json` filename. | corpus, vault, workspace, project folder |
| **Library root** | Absolute path of an opened Library. Electron only accepts filesystem ops against roots opened this session (folder dialog or startup examples). | working directory, cwd |
| **Library catalog** | In-memory metadata index of an opened Library: per file, path, id, title, description, validity/errors, kinds used, and variants present. Not full Prayer trees. Filled in chunks as files are read so a large Library does not stall the UI or keep every Prayer in RAM. | in-memory corpus, loading all prayers, vault index |
| **Session draft** | In-memory Prayer for a path that is currently selected and/or has unsaved changes, including validation errors and visible variant columns. Several dirty drafts may exist when switching prayers without saving. A clean Prayer that is not selected is not kept — it is read from disk again on the next open. | buffer, editor state, caching every opened file |
| **Prayer** | One self-contained multilingual JSON document (`Prayer` type). | document (ambiguous), page |
| **Variant** | One `(lang, variant)` edition in the prayer’s registry, with its own title, license, and source. | locale alone, translation file |
| **Block** | One unit in a Prayer `structure` (`id`, `kind`, `translations`). Editor commits and reorder ops mutate Blocks, not free-form HTML. | paragraph, section, row |
| **Kind** | Open string semantic role on a block (`verse`, `annotation`, custom…). Built-in presets keep lowercase ids in JSON; the app shows title-case labels and does not allow renaming or deleting them. Custom kinds are stored on the library (`styles.json`) and remain until removed, even if unused. | tag (HTML), style name |
| **Kind style** | Visual tokens for a block kind (`fontSize`, `color`, `fontWeight`, `fontStyle`, optional `initialCap` / `htmlTag`). Built-in defaults plus the open library’s `styles.json`. | CSS theme, stylesheet |
| **Kind rename** | Renaming a block kind updates every prayer in the open Library that uses it (and the library style map). Confirm when more than one prayer is affected. | refactor kind, retag |
| **Flat export** | Single-variant derived document from `exportVariant`. | “compile”, “render” |
| **Structure (model A)** | Shared block skeleton; texts hang off per-variant translations on each block. | parallel files per language |

## Related

- [Prayer format](prayer-format.md)
- [Library layout](library.md)
- [Overview](overview.md)
