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
| `formatVersion` | no | `2` when the file uses speakers; omitted otherwise (missing = `1`). See [Format version](#format-version). |

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
| `rtl` | Optional. `true` when this **whole edition** is right-to-left. Omit for LTR (do not write `false`). |
| `speakers` | Optional. Printed labels per Speaker id for this edition. See [Speakers](#speakers). |

Church Slavonic script differences are **separate variants** under `cu`, not a schema field. Direction is the optional `rtl` flag on that variant — not inferred from `lang`.

Kind-level direction (`dir`: `rtl` / `ltr`) lives in library `styles.json`, not on blocks. A set kind `dir` overrides the variant; omit the token to inherit.

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
| `speaker` | Optional. Id of the Speaker who says the block (`priest`, `people`, …). Same for every Variant. See [Speakers](#speakers). |

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

Exports map `note` runs to HTML / layout character styles as appropriate. Layout RTF/DOCX map each kind to a paragraph style and `note` runs to a character style.

## Speakers

A **Speaker** marks who says a block (liturgical dialogue). The id is on the block; the printed name is per Variant.

```json
{
  "formatVersion": 2,
  "id": "ostergebete",
  "type": "prayer",
  "variants": [
    {
      "lang": "de",
      "variant": "standard",
      "title": "Ostergebete",
      "license": "unknown",
      "source": "draft",
      "speakers": {
        "priest": { "name": "Priester", "short": "P" },
        "people": { "name": "Volk", "short": "V" }
      }
    }
  ],
  "structure": [
    {
      "id": "d1",
      "kind": "verse",
      "speaker": "priest",
      "translations": [
        { "lang": "de", "variant": "standard", "lines": ["Christus ist auferstanden!"] }
      ]
    },
    {
      "id": "d2",
      "kind": "verse",
      "speaker": "people",
      "translations": [
        { "lang": "de", "variant": "standard", "lines": ["Wahrhaftig, er ist auferstanden!"] }
      ]
    }
  ]
}
```

| Rule | Detail |
|------|--------|
| Speaker id | Same pattern as kind ids: letter first, then letters, digits, `_`, `-`; max 64 |
| Block `speaker` | Optional; one per block. Do not type the label into `text` / `lines` |
| Variant `speakers` | Map `{ [id]: { name?, short? } }`. Empty strings are not written; an entry with neither field is omitted; an empty map is omitted |
| No registry | The Speakers of a prayer are the ids used on blocks plus the keys of `speakers` maps. There is no Library list |
| Presets | `priest`, `deacon`, `bishop`, `reader`, `choir`, `people` are offered in the editor only. Core ships no translated labels |
| Printed name fallback | `name` missing → the id, title-cased (`priest` → `Priest`, `my-cantor` → `My cantor`) |
| Printed short fallback | `short` missing → first letter of the resolved name (`Priester` → `P`) |
| Missing name | Validation warns (`speaker-name-missing`) when a used Speaker has no `name` in a Variant that has a translation for that block. The file stays valid |

### Format version

| `formatVersion` | Meaning |
|-----------------|---------|
| missing | `1` — no speakers |
| `2` | The file uses `speaker` or `speakers` |
| higher than the app supports | Validation fails with `format-version-newer`: the app asks for a newer version instead of showing schema errors |

The app writes `formatVersion: 2` only while the file uses speakers and removes it when the last Speaker is gone. Older apps (≤ 0.2.3) reject unknown keys, so Speaker-free prayers stay openable there.

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
9. Speakers: the role is on `speaker` and the labels are in `speakers`; the text has no "Priester:" prefix; `formatVersion` is `2` only when speakers are used  
