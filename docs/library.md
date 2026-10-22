# Library layout

A **library** is a folder of prayer JSON files plus optional collection metadata, kind styles and kind templates. The absolute path of an opened library is the **library root**.

## Layout

```
my-prayer-library/
  manifest.json                 # optional
  .orthodox-prayer-toolkit/
    styles.json                 # optional kind-style overrides
    templates.json              # optional kind templates
  trisagion.json
  tropar-prokopios.json
  …
```

| Item | Required | Role |
|------|----------|------|
| `{id}.json` | yes (at least one in a useful library) | Prayer documents |
| `manifest.json` | no | Collection meta only |
| `.orthodox-prayer-toolkit/styles.json` | no | Kind styles for this library |
| `.orthodox-prayer-toolkit/templates.json` | no | Kind templates for new prayers |

## Indexing rules

- Prayer files are discovered as `*.json` under the library (manifest and toolkit config excluded).
- Identity is the prayer `id`; filename must be `{id}.json`.
- Duplicate ids across the library are reported on open/refresh.
- Taxonomy is **not** encoded in folder paths — use fields on each prayer.
- The editor’s **Library catalog** holds per-file metadata (title, validity, kinds used and declared, migration flag, variants), not the full Prayer `structure`. Scan in chunks; after save, patch that entry instead of re-reading the whole Library.

## Manifest (`manifest.json`)

Collection metadata only. Languages stay inside each prayer’s `variants[]`.

```json
{
  "description": "Parish draft library",
  "defaultVariant": {
    "lang": "de",
    "variant": "standard"
  },
  "stylePrefixStem": "opt"
}
```

| Field | Role |
|-------|------|
| `description` | Human blurb for the collection |
| `defaultVariant` | Preferred lang/variant for list titles and defaults |
| `stylePrefixStem` | Prefix stem for Layout export paragraph and character style names (default resolution uses `opt`) |

Prayers remain valid without a manifest.

## Kind styles (`styles.json`)

Visual tokens **per kind**, not inside prayer JSON:

| Token | Purpose |
|-------|---------|
| `fontSize` | CSS size string. Editor S–XL are rem (M = 1); they follow App settings editor text size. HTML export keeps rem. |
| `color` | Semantic token (`base` / `accent`) or legacy hex |
| `fontWeight` / `fontStyle` | Weight and style |
| `textAlign` | Optional `left`, `center`, or `justify`. `left` is logical start (follows `dir`). Missing → left, except **verse** and **annotation** default to `justify`. |
| `dir` | Optional `rtl` or `ltr`. Omit to inherit the variant’s RTL flag. When set, this kind overrides the variant. |
| `initialCap` | Optional liturgical initial (`"true"`) |
| `indicate` | Optional editor marker (`"true"`) → `data-indicate` on blocks |
| `htmlTag` | Preferred HTML element for HTML export |

There is no `speaker` token: whether a custom kind allows Speakers is set per prayer on its `kinds` entry ([Prayer format](prayer-format.md#kinds)). A legacy `speaker` token is read without error and consumed by [migration](#migration-on-open).

**Resolution order:** built-in defaults → library `styles.json` (library wins). Kinds without an entry get a fallback preset so they appear in Kind styles immediately. The editor writes styles only to this library file; adding a custom kind in a prayer writes no style entry (the kind uses the fallback until its style is edited).

**Kind styles list** (Library settings → Kind styles) shows the union of: presets, kinds declared or used in any prayer (Library catalog), kinds in templates, and keys in `styles.json`. A style entry whose kind is in no prayer and no template is marked **unused** and offered for removal; it is never deleted automatically. While any prayer file is not valid JSON nothing is marked unused (that file could use it); kinds of files that parse but do not validate count as used.

Validate / sanitize via Core `validateStyles` / `sanitizeStyles` / `resolveStyles`.

## Kind templates (`templates.json`)

Named sets of custom kinds, used as **stamps** when creating a prayer:

```json
{
  "templates": [
    { "id": "hymns", "label": "Hymnen", "kinds": [{ "id": "refrain", "speaker": true }] }
  ]
}
```

| Field | Rule |
|-------|------|
| `id` | Kebab-case slug, unique in the file |
| `label` | Non-empty display name |
| `kinds` | Same entry shape and rules as a prayer's `kinds` (presets never listed); may be `[]` |

| Action | Effect |
|--------|--------|
| New prayer with a template | The template's `kinds` are copied into the prayer. "No template" = presets only |
| Edit / delete a template | Never touches existing prayers (no link back) |
| Apply template to an existing prayer | Additive: kinds the prayer lacks are appended in template order; existing entries stay unchanged. Undoable session-draft edit |
| Kind rename | Also renames the kind in every template; refused while `templates.json` has errors |

Templates are managed in Library settings → Kind templates (create from a label, the id derived with Core `templateIdFromLabel`; rename label; delete, edit the kind list incl. speaker flag and order; add a kind the library already knows or a new id). While `templates.json` has errors the list is read-only and the problems are shown; valid templates can still be picked for new prayers. "Apply template" is in Prayer settings → Kinds. Validate / sanitize via Core `validateTemplates` / `sanitizeTemplates`.

## Migration on open

Older files may use custom kinds without declaring them (kinds and the `speaker` token used to be library-wide in `styles.json`).

- On read, each prayer is migrated **in memory** (Core `migratePrayer`), so old files open and validate. Migration is additive: every undeclared non-preset kind used in `structure` is appended to `kinds` (first appearance order), with `speaker: true` if the legacy `styles.json` token said so, then `formatVersion` is normalised. Blocks, texts, speakers and variants are untouched.
- When prayers need migration (or `styles.json` still has `speaker` tokens), the app asks "N prayers use the old format — migrate now?". Confirming writes, in this order:
  1. the migrated prayers;
  2. `templates.json` with a template `legacy-kinds` ("Bisherige Kinds") holding **all** custom kinds the library knew before (`styles.json` keys plus kinds used anywhere, with legacy speaker flags) — only if there is at least one and no template with that id exists;
  3. `styles.json` with the `speaker` tokens stripped — **only if every prayer write succeeded**.
- While `styles.json` is not a readable JSON object the migration waits (no prompt, "Migrate…" disabled with the reason): its legacy speaker tokens are unknown, so writing would lose speaker flags. For the same reason an old-format prayer cannot be saved until the file is fixed (the editor says so). When only legacy tokens remain and `templates.json` has errors, migration also waits for that file.
- Declining ("Not now") leaves files on disk unchanged and is not asked again until the library is opened again; Library settings offers "Migrate…" meanwhile. Prayers keep opening via the in-memory migration (an opened old file is not marked unsaved); saving an edited prayer writes the new format.
- After migrating, a report lists written, skipped (unsaved edits) and failed files, and says when the `speaker` tokens were kept in `styles.json` because not every prayer was migrated.

## Id / filename behaviour (editor)

- On save, the file is written as `{id}.json`.
- Renaming `id` renames the file in its folder (`sub/a.json` → `sub/b.json`); save is blocked when another prayer in the library already has that id or a file exists at the target. New files (create, import, rename) are created exclusively, so a file that appears meanwhile is never overwritten.
- Files are written atomically (temp file + rename), so a crash or a full disk never leaves a half-written prayer, `styles.json` or `templates.json`.
- Deleting a prayer removes its file and patches the Library catalog (no full rescan).
- **Export prayer JSON** (right-click a sidebar row) writes the complete `{id}.json` source file via a save dialog. Unsaved draft changes are included.
- The editor **Export** dialog can write a two-column **Word table** (order of two variants; language gutter and, for Own column, speaker gutter are checked by default and can be turned off; Speakers default to Own column). That file is for Microsoft Word; Affinity Place cannot flow tables as story text. Export options are remembered per Prayer (local), including the last format.
- **Import prayer JSON** (library menu) copies a picked `.json` into the library root as `{id}.json`. The file is copied byte for byte and migrated in memory (undeclared kinds declared; the catalog flags it for the migration prompt); saving an edit writes the new format. Existing ids/filenames are not overwritten.
- The editor has no block paste / import between prayers yet. Core `declareBlockKinds` is the helper for that (declares missing kinds, carrying `speaker` from the source prayer when known); text pasted into a cell never changes kinds.

## Opening folders (editor)

- A folder becomes usable after you pick it in a native dialog (Open, Create). The app remembers picked folders in its app data folder (`trusted-libraries.json`), so recent libraries reopen without a dialog.
- A recent folder the app has not seen picked (e.g. from an older version) asks once for confirmation in a native dialog. The renderer cannot grant itself access to other folders.

## External changes (editor)

- The app watches the open library folder for `.json` changes made outside it (another editor, git, sync tools).
- A prayer without unsaved edits reloads from disk; new files appear in the list, deleted ones disappear.
- A prayer with unsaved edits keeps them and shows **Changed on disk** or **Deleted on disk**: keep your version (the next save overwrites or recreates the file) or load the disk version.
- Changes to `manifest.json`, `.orthodox-prayer-toolkit/styles.json` or `.orthodox-prayer-toolkit/templates.json` rescan the library.
- **Refresh** (library menu) rescans the catalog and reloads the open prayer from disk. Unsaved prayers are prompted first (save all, discard all, or cancel). Browser preview has no folder watcher, so use Refresh after external edits.

## Dev sample

`examples/` is a small library for development. It is **not** a production corpus — ship real content in a separate repository or artifact.

## Related

- [Prayer format](prayer-format.md)
- [Glossary](glossary.md) — Library, Library root, Kind, Kind style, Kind template, Kind rename
