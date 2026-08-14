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

Classify by **role**, not by print color or typeface — books often set genre labels and rubrics identically.

| Kind | Role |
|------|------|
| `heading` | Names a section or liturgical item (“Troparion im 4. Ton”). At most one level above `subheading`. |
| `subheading` | Second heading level only. |
| `annotation` | Rubric / instruction with no spoken words of its own (“Dann dreimal das Ostertroparion im 5. Ton:”). |
| `verse` | Spoken or sung prayer text, including doxologies (Gloria Patri), Kyrie, Amen-formulas. |

A glued genre label such as `Troparion im 4. Ton: Gebetstext…` is a **heading block plus a verse block**. A glued rubric plus spoken words on one line (`Dann vierzigmal: Herr, erbarme Dich!`) is one `verse` with an inline `note` run for the rubric. LLM encoding: [skills/encode-prayer/SKILL.md](../skills/encode-prayer/SKILL.md).

### Payload shapes

| Typical use | Payload |
|-------------|---------|
| Headings, annotations | `text` — string or inline **runs** |
| Verse | `lines` always — one item per poetic line, or one item for continuous chant (keep `/` `//` in the string) |

### Languages inside one edition

A German (or other) page that also prints a hymn in Greek or Church Slavonic is still **one variant**. Those snippets are extra `verse` blocks of that same `(lang, variant)`, in source order. Register another variant only when the source is a full parallel edition of the whole prayer.

### Inline notes (runs)

When a string needs marked spans, use runs instead of a plain string. Note runs hold the rubric; surrounding spaces live on adjacent `text` runs:

```json
[
  { "t": "note", "v": "Dann vierzigmal:" },
  { "t": "text", "v": " Herr, erbarme Dich!" }
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
      "id": "h1",
      "kind": "heading",
      "translations": [
        {
          "lang": "de",
          "variant": "standard",
          "text": "Troparion im 4. Ton"
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
7. Spoken doxologies are `verse`; glued rubric + spoken words use a `note` run  
8. Extra languages on a monolingual page are sequential blocks of that variant; `/` stays in the string  
