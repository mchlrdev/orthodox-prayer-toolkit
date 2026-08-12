# Prayer format

Canonical on-disk shape for a prayer. Schema source: [`packages/core/schema/prayer.schema.json`](../packages/core/schema/prayer.schema.json). Types: `Prayer` in `@orthodox-prayer-toolkit/core`.

## Model A (shared structure)

One prayer has:

- a **variants** registry — which `(lang, variant)` exist, with display title, license, source
- a shared **structure** — ordered blocks; each block has per-variant **translations**

Missing a translation means the entry is **omitted** (never an empty placeholder key).

There is **no** top-level canonical `title`. Human-facing titles come from the active or preferred variant (`resolveDisplayTitle`).

## File identity

| Rule | Detail |
|------|--------|
| Filename | `{id}.json` |
| `id` | Kebab-case slug: `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| Rename | Changing `id` renames the file; collisions block save (no silent overwrite) |

## Top-level fields

| Field | Required | Role |
|-------|----------|------|
| `id` | yes | Stable slug; must match filename |
| `type` | yes | Genre slug (`prayer`, `troparion`, `kontakion`, …) — open string |
| `variants` | yes | At least one language/edition entry |
| `structure` | yes | At least one block |
| `book` | no | Collection / book slug (e.g. `menaion`, `horologion`) |
| `occasion` | no | Occasion slug |
| `tone` | no | Oktoechos tone `1`–`8`, or `null` |
| `description` | no | Short language-neutral summary |
| `meta.custom` | no | Arbitrary string/number/boolean/null map |

## Variant registry

```json
{
  "lang": "de",
  "variant": "standard",
  "title": "Tropar des Großmärtyrers Prokopios",
  "license": "unknown",
  "source": "draft"
}
```

| Field | Notes |
|-------|--------|
| `lang` | BCP-47 where possible (`de`, `en`, `el`, `cu`, …) |
| `variant` | Edition/script within the language (e.g. `standard`, `synodal-cyrl`, `synodal-latn`) |
| `title` | Display title for this language/edition |
| `license` / `source` | Rights & provenance; unclear → `unknown` / `draft` |

Church Slavonic script differences are **separate variants** under `cu`, not a separate schema field.

## Blocks

```json
{
  "id": "v1",
  "kind": "verse",
  "translations": [
    {
      "lang": "de",
      "variant": "standard",
      "lines": ["Line one…", "Line two…"]
    }
  ]
}
```

| Field | Role |
|-------|------|
| `id` | Stable within the prayer |
| `kind` | Open semantic role string (not a closed schema enum) |
| `translations[]` | `{ lang, variant, text? }` or `{ lang, variant, lines? }` |

### Recommended kinds (editor presets)

Not enforced by schema — suggestions in the UI:

`heading` · `subheading` · `annotation` · `verse`

Custom kinds are allowed; library style maps discover them when the library opens.

### Payload shapes

| Typical use | Payload |
|-------------|---------|
| Prose / rubric-like / headings | `text` — string or inline **runs** |
| Verse / line-broken chant | `lines` — array of strings or runs |

`lines` are **content** lines, not layout/print line breaks.

### Inline notes (runs)

When a string needs marked spans (e.g. parenthetical notes), use runs instead of a plain string:

```json
[
  { "t": "text", "v": "Say this " },
  { "t": "note", "v": "thrice" },
  { "t": "text", "v": "." }
]
```

Exports map `note` runs to HTML / layout character styles as appropriate.

## Minimal example

```json
{
  "id": "tropar-prokopios",
  "type": "troparion",
  "book": "menaion",
  "tone": 4,
  "variants": [
    {
      "lang": "de",
      "variant": "standard",
      "title": "Tropar des Großmärtyrers Prokopios",
      "license": "unknown",
      "source": "draft"
    }
  ],
  "structure": [
    {
      "id": "r1",
      "kind": "annotation",
      "translations": [
        {
          "lang": "de",
          "variant": "standard",
          "text": "Ton 4."
        }
      ]
    },
    {
      "id": "v1",
      "kind": "verse",
      "translations": [
        {
          "lang": "de",
          "variant": "standard",
          "lines": [
            "Dein Märtyrer Prokopius, Herr,",
            "hat in seinem Leidenskampf den Kranz der Unvergänglichkeit erworben…"
          ]
        }
      ]
    }
  ]
}
```

See also `examples/tropar-prokopios.json` and `examples/ostergebete.json`.

## What does **not** belong in prayer JSON

- Fonts, colors, weights (use library / app kind styles)
- HTML layout, CMS fields, site navigation
- Affinity frame geometry

Semantic flags may grow over time; pixel layout stays outside the prayer file.

## Validation

```ts
import { validate } from "@orthodox-prayer-toolkit/core";

const result = validate(data);
if (!result.ok) {
  // result.errors: { path, message }[]
}
```

## Flat export

`exportVariant(prayer, { lang, variant })` produces a single-language document: one title/license/source, and a `structure` containing only that variant’s payloads (blocks without a translation are omitted unless `includeBlocksWithoutTranslation` is set).

Other exporters (`exportHtml`, `exportLayoutRtf`, `exportLayoutDocx`) take the same lang/variant idea — see [Core API](core-api.md).

## Quality checklist

1. One file = one logical prayer; self-contained  
2. `id` matches `{id}.json`; globally unique in the library  
3. Every block has a stable `id`; `kind` is a meaningful open string  
4. Prefer omitting missing translations over empty strings  
5. License + source set on every variant  
6. Keep layout out of the source file  
