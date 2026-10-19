---
name: encode-prayer
description: >-
  Encode liturgical prayers from PDF, websites, scans, or other sources into
  Orthodox Prayer Toolkit JSON. Use when generating prayer JSON, ingesting a
  prayer, converting an existing text, or when headings vs annotations / rubrics
  vs verse are unclear.
---

# Encode prayer JSON

Turn a source (PDF, website, scan, Word, plain text) into one `{id}.json`.

This file is the whole skill. Encode from it. The editor validates on open.

Always emit a markdown `json` fence so the prayer can be copied. Agents may also write `{id}.json` (do not overwrite an existing id). Stop after the JSON: remaining uncertainties as short bullets **above** the fence.

## Steps

1. **Read the entire source**, first line through last. The page title becomes `variants[].title`. The first rubric or spoken line after the title is the first block — encode it. Completion: every paragraph of the source is accounted for; no empty `text` / `lines`.
2. **Outline by role** (see below). Show it before JSON unless the user said to skip questions.
3. **Encode one prayer object.** One source page is one file. Filename `{id}.json` (`id` kebab-case: `^[a-z0-9]+(?:-[a-z0-9]+)*$`).

## Shape

```json
{
  "id": "slug",
  "type": "prayer",
  "book": "horologion",
  "occasion": "osterwoche",
  "variants": [
    {
      "lang": "de",
      "variant": "standard",
      "title": "Display title from the source",
      "license": "unknown",
      "source": "https://…"
    }
  ],
  "structure": []
}
```

| On the prayer | Keys |
|---------------|------|
| Required | `id`, `type`, `variants` (≥1), `structure` (≥1) |
| Optional | `book`, `occasion`, `tone`, `description` |
| Omit if unknown | `book`, `occasion`, `tone`, `description` — do not invent |

| On a variant | Keys |
|--------------|------|
| Required | `lang`, `variant`, `title`, `license`, `source` |
| Optional | `rtl` — write `true` only for a **full** right-to-left edition. Omit for LTR. Never write `false`. |

| On a block | Keys |
|------------|------|
| Only these | `id`, `kind`, `translations`, optional `speaker` |
| Block `id` | Unique in the file (`h1`, `a1`, `v1`, …) |
| `speaker` | Only when the source marks who speaks. See **Speakers** below |

| On the file | Keys |
|-------------|------|
| `formatVersion` | Write `2` only when the file uses `speaker` or a variant `speakers` map. Otherwise omit it |

`tone` is prayer-level only, integer `1`–`8`. Set it when the **whole** prayer is one Oktoechos tone. Several tones in one source → omit `tone`. Tone wording in headings stays (“… im 5. Ton”).

Unclear license/source → `"unknown"` / `"draft"` (or the URL if that is the source).

Missing a translation: omit that entry. Empty strings are invalid.

## Role (kind)

Classify by **role**, not by color or typeface. Genre labels and rubrics often look identical in print.

| Kind | Role | Payload |
|------|------|---------|
| `heading` | Names the item that follows (“Ostertroparion im 5. Ton”, “Psalm 50”) | `text` |
| `subheading` | Second heading level only | `text` |
| `annotation` | Instruction with **no spoken words of its own** (“Dann dreimal das Ostertroparion im 5. Ton:”, “Stehend.”) | `text` |
| `verse` | Words that are said or sung | `lines` |

Spoken liturgical text is `verse`: Gloria Patri / “Ehre sei dem Vater…”, “Jetzt und immerdar… Amen.”, “Herr, erbarme Dich!”, Trisagion, Amen-formulas, Theotokia, hymns. A trailing colon does not make a doxology a rubric.

Glued **genre label** → split:

> Troparion im 4. Ton: Dein Märtyrer Prokopius, Herr, …

→ `heading` “Troparion im 4. Ton” then `verse` with the prayer.

Glued **rubric + spoken words on one line** → one `verse`, rubric as a `note` run:

> Dann vierzigmal: Herr, erbarme Dich!

```json
{
  "id": "v1",
  "kind": "verse",
  "translations": [
    {
      "lang": "de",
      "variant": "standard",
      "lines": [
        [
          { "t": "note", "v": "Dann vierzigmal:" },
          { "t": "text", "v": " Herr, erbarme Dich!" }
        ]
      ]
    }
  ]
}
```

Same pattern for “Dann dreimal: Herr, erbarme Dich!”. Spaces around the note live on the `text` run, not inside `note`.

Standalone instruction that only introduces a named hymn stays an `annotation` block, then heading/verse as usual.

Prefer the four kinds above. Custom `kind` strings only when the source clearly needs one.

## One edition

`variants[]` lists **full editions** of the whole prayer (same structure, another language throughout).

Greek, Church Slavonic, or other languages printed **inside** a German (etc.) page are further `verse` blocks of that same `(lang, variant)`, in source order. They are not extra variants and not parallel `translations[]` on the German block.

Register `el` / `cu` / … only when the source is a complete parallel edition.

A full Arabic / Syriac / other RTL source is one variant with `"rtl": true`. Snippets of those scripts inside an LTR page stay on that LTR variant — omit `rtl`. Do not put `rtl` on blocks. Kind `dir` lives in library `styles.json` (inherit unless the user asked to override a kind); do not invent kind-direction tokens while encoding.

## Speakers

Liturgical dialogue often prefixes a line with who says it: "Priester:", "Diakon:", "Chor:", "Volk:". Encode the role as data, not text.

Set a Speaker only when the source marks the speaker. Do not infer one from a verse that sounds like a reply.

1. Remove the label from the text. The block's `lines` / `text` start with the words spoken.
2. Set `speaker` on the block. Use a preset id where it fits: `priest`, `deacon`, `bishop`, `reader`, `choir`, `people`. Otherwise a short custom id (`cantor`), letters, digits, `_` and `-` only, starting with a letter.
3. Add a `speakers` map on **each** variant that has the block. Give `name` as printed in that language and `short` as the book's abbreviation when the source shows one. Omit a field you do not know; do not invent it.
4. One Speaker per block, the same id for every variant.

```json
{
  "id": "d1",
  "kind": "verse",
  "speaker": "priest",
  "translations": [
    { "lang": "de", "variant": "standard", "lines": ["Christus ist auferstanden!"] }
  ]
}
```

```json
"variants": [
  {
    "lang": "de",
    "variant": "standard",
    "title": "…",
    "license": "unknown",
    "source": "draft",
    "speakers": {
      "priest": { "name": "Priester", "short": "P" },
      "people": { "name": "Volk", "short": "V" }
    }
  }
]
```

Source: `Priester: Christus ist auferstanden!` → block `speaker: "priest"`, text `Christus ist auferstanden!`. Source with no marked speaker → no `speaker`, no `speakers`.

Do not put `speaker` on `heading`, `subheading` or `annotation`; the editor does not offer it there. Speakers are for `verse` and custom kinds the library allows.

## Verse payload

`verse` always uses `lines`. The editor shows only `lines` for verse; `text` on a verse is invisible.

- Stanzaic hymn → one array item per poetic line.
- Continuous prose, including `/` `//` chant marks → **one** array item; keep the slashes in the string.
- Inline notes sit inside a line (that item is a run array).

```json
"lines": ["Die Auferstehung Christi haben wir geschaut, / so lasset uns anbeten den heiligen Herrn Jesus, / Den allein sündelosen."]
```

HTML wrapping and comma breaks are not extra array items. Heading / annotation / subheading always use `text`. A translation has either `text` or `lines`, not both.

## Library files

Each prayer is `{id}.json`. That is the whole document.

`manifest.json` is optional **collection** meta only (`description`, `defaultVariant`). It does not list prayers. Leave it unchanged.

## Outline (before JSON)

```
- verse: Auf die Gebete unserer heiligen Väter…
- annotation: Dann dreimal das Ostertroparion im 5. Ton:
- heading: Ostertroparion im 5. Ton
- verse: Christus ist erstanden…          (German)
- verse: Χριστός ανέστη…                  (same edition, next block)
- verse: Христос воскресе…                (same edition, next block)
- heading: Auferstehungshymnus im 6. Ton
- verse: Die Auferstehung Christi haben wir geschaut, / so lasset uns…
- verse: Ehre sei dem Vater und dem Sohne und dem Heiligen Geiste:
- verse: [next troparion, slashes kept]
- verse: Dann vierzigmal: Herr, erbarme Dich!   (note run + text)
- verse [priest]: Christus ist auferstanden!     (label stripped, speaker set)
```

Ask only where heading vs annotation vs verse is still ambiguous.

## Encode example

**Source**

```
Ostertroparion im 5. Ton:
Christus ist erstanden von den Toten,
hat zertreten im Tode den Tod.
Χριστός ανέστη εκ νεκρών…
Dann vierzigmal: Herr, erbarme Dich!
Ehre sei dem Vater und dem Sohne und dem Heiligen Geiste, jetzt und immerdar und in die Ewigkeit der Ewigkeit. Amen.
```

**JSON**

```json
{
  "id": "oster-tropar-probe",
  "type": "prayer",
  "book": "horologion",
  "variants": [
    {
      "lang": "de",
      "variant": "standard",
      "title": "Ostertroparion",
      "license": "unknown",
      "source": "draft"
    }
  ],
  "structure": [
    {
      "id": "h1",
      "kind": "heading",
      "translations": [
        { "lang": "de", "variant": "standard", "text": "Ostertroparion im 5. Ton" }
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
            "Christus ist erstanden von den Toten,",
            "hat zertreten im Tode den Tod."
          ]
        }
      ]
    },
    {
      "id": "v2",
      "kind": "verse",
      "translations": [
        {
          "lang": "de",
          "variant": "standard",
          "lines": ["Χριστός ανέστη εκ νεκρών…"]
        }
      ]
    },
    {
      "id": "v3",
      "kind": "verse",
      "translations": [
        {
          "lang": "de",
          "variant": "standard",
          "lines": [
            [
              { "t": "note", "v": "Dann vierzigmal:" },
              { "t": "text", "v": " Herr, erbarme Dich!" }
            ]
          ]
        }
      ]
    },
    {
      "id": "v4",
      "kind": "verse",
      "translations": [
        {
          "lang": "de",
          "variant": "standard",
          "lines": [
            "Ehre sei dem Vater und dem Sohne und dem Heiligen Geiste, jetzt und immerdar und in die Ewigkeit der Ewigkeit. Amen."
          ]
        }
      ]
    }
  ]
}
```

Copy wording from the source. Do not invent parallel titles in other languages.

## Output

````markdown
```json
{ ... }
```
````

- One JSON object, no comments inside the fence.
- Above the fence: proposed filename plus remaining uncertainties.
- Chat: the fence is the deliverable. Do not claim a file was saved.
- Agent: write `{id}.json` **and** show the fence.
