# Glossary

Shared domain language for humans and agents. Prefer these terms in UI, docs, and code comments.

| Term | Meaning | Avoid |
|------|---------|--------|
| **Library** | A folder of prayer JSON files plus optional `manifest.json`, `.orthodox-prayer-toolkit/styles.json` and `.orthodox-prayer-toolkit/templates.json`. Identity of each prayer is its `id` / `{id}.json` filename. | corpus, vault, workspace, project folder |
| **Library root** | Absolute path of an opened Library. Electron only accepts filesystem ops against roots opened this session (folder dialog or startup examples). | working directory, cwd |
| **Library catalog** | In-memory metadata index of an opened Library: per file, path, id, title, description, validity/errors, kinds used and declared, whether it needs migration, and variants present. Not full Prayer trees. Filled in chunks as files are read so a large Library does not stall the UI or keep every Prayer in RAM. | in-memory corpus, loading all prayers, vault index |
| **Session draft** | In-memory Prayer for a path that is currently selected and/or has unsaved changes, including validation errors and visible variant columns. Several dirty drafts may exist when switching prayers without saving. A clean Prayer that is not selected is not kept — it is read from disk again on the next open. **Refresh** re-reads the selected prayer from disk (and prompts if it has unsaved changes). | buffer, editor state, caching every opened file |
| **Prayer** | One self-contained multilingual JSON document (`Prayer` type). | document (ambiguous), page |
| **Variant** | One `(lang, variant)` edition in the prayer’s registry, with its own title, license, and source. | locale alone, translation file |
| **Block** | One unit in a Prayer `structure` (`id`, `kind`, `translations`). Editor commits and reorder ops mutate Blocks, not free-form HTML. | paragraph, section, row |
| **Kind** | Semantic role id on a block. The four built-in presets (`heading`, `subheading`, `annotation`, `verse`) exist in every Prayer implicitly, keep lowercase ids in JSON, show title-case labels, and cannot be renamed or deleted. Custom kinds are declared per Prayer in its top-level `kinds` (with optional `speaker: true`); a block may only use a preset or a declared kind. Styles remain library-wide per kind id. | tag (HTML), style name |
| **Kind template** | Named set of custom kinds in the Library's `templates.json`. A stamp: creating a Prayer with it copies its kinds into the Prayer's `kinds`; the Prayer keeps no link, so later template edits never touch existing Prayers. "Apply template" on an existing Prayer adds only missing kinds. Not the same as the built-in preset kinds, which are never in a template. | preset (that means the built-in kinds), profile, linked kind set |
| **Kind style** | Visual tokens for a block kind (`fontSize`, `color`, `fontWeight`, `fontStyle`, optional `textAlign` / `initialCap` / `indicate` / `htmlTag` / `dir`). Built-in defaults plus the open library’s `styles.json`. No `speaker` token — Speaker allowance is on the Prayer's kind entry. In the editor, rem `fontSize` is relative to the App settings editor text size. | CSS theme, stylesheet |
| **Kind rename** | Library-wide: renaming a custom kind updates the blocks and `kinds` of every Prayer in the open Library that uses or declares it, all Kind templates, and the library style key. The new id must not exist anywhere in the Library yet (preset, any Prayer, template or style key): kinds are never merged. Confirm when more than one prayer or any template is affected. Refused up front (nothing written) while an affected file is invalid or `templates.json` / `styles.json` is broken. | refactor kind, retag |
| **Speaker** | Optional open id on a Block (`priest`, `deacon`, `choir`, …) saying who speaks it. Same for every Variant. Printed as a label, never typed into the text. | role, voice, character |
| **Speaker label** | Per-Variant printed `name` and optional `short` for a Speaker (`Priester` / `P`), stored in the Variant's `speakers` map. Missing name → title-cased id; missing short → first letter of the name. | speaker name (ambiguous), tag |
| **Format version** | Top-level `formatVersion` integer. Missing means `1`; written as `3` when the Prayer declares `kinds`, else `2` when it uses Speakers, else omitted. A file with a newer version than the app supports shows "needs a newer app". | schema version, file version |
| **Flat export** | Single-variant derived document from `exportVariant`. | “compile”, “render” |
| **Word table export** | Two-variant DOCX as a default Word table (one structure block per row). Language gutter (empty middle column) is on by default. When Placement is Own column, a speaker gutter (empty column after Speaker) is also on by default. Both optional. Word needs cell widths so empty columns stay. When the prayer has Speakers, a Speaker column is on by default (Placement: Own column). Word only; not Affinity Place. | newspaper columns, bilingual layout |
| **Structure (model A)** | Shared block skeleton; texts hang off per-variant translations on each block. | parallel files per language |

## Related

- [Prayer format](prayer-format.md)
- [Library layout](library.md)
- [Overview](overview.md)
