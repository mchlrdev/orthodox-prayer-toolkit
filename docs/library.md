# Library layout

A **library** is a folder of prayer JSON files plus optional collection metadata and kind styles. The absolute path of an opened library is the **library root**.

## Layout

```
my-prayer-library/
  manifest.json                 # optional
  .orthodox-prayer-toolkit/
    styles.json                 # optional kind-style overrides
  trisagion.json
  tropar-prokopios.json
  …
```

| Item | Required | Role |
|------|----------|------|
| `{id}.json` | yes (at least one in a useful library) | Prayer documents |
| `manifest.json` | no | Collection meta only |
| `.orthodox-prayer-toolkit/styles.json` | no | Kind styles for this library |

## Indexing rules

- Prayer files are discovered as `*.json` under the library (manifest and toolkit config excluded).
- Identity is the prayer `id`; filename must be `{id}.json`.
- Duplicate ids across the library are reported on open/refresh.
- Taxonomy is **not** encoded in folder paths — use fields on each prayer.

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
| `stylePrefixStem` | Prefix stem for Layout export paragraph style names (default resolution uses `opt`) |

Prayers remain valid without a manifest.

## Kind styles (`styles.json`)

Visual tokens **per kind**, not inside prayer JSON:

| Token | Purpose |
|-------|---------|
| `fontSize` | CSS size string |
| `color` | Semantic token (`base` / `accent`) or legacy hex |
| `fontWeight` / `fontStyle` | Weight and style |
| `initialCap` | Optional liturgical initial (`"true"`) |
| `htmlTag` | Preferred HTML element for HTML export |

**Resolution order:** discovered kinds from the open library → app defaults → library overrides (library wins). Unknown kinds get a fallback preset so they appear in the style panel immediately.

Validate / sanitize via Core `validateStyles` / `sanitizeStyles` / `resolveStyles`.

## Id / filename behaviour (editor)

- On save, the file is written as `{id}.json`.
- Renaming `id` renames the file; if the target exists, save is blocked.
- Deleting a prayer removes its file and refreshes the list.

## Dev sample

`examples/` is a small library for development. It is **not** a production corpus — ship real content in a separate repository or artifact.

## Related

- [Prayer format](prayer-format.md)
- [Glossary](glossary.md) — Library, Library root, Kind style, Kind rename
