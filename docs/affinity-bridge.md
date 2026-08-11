# Affinity-Bridge v0 (fest)

Entscheidung D09.

## Pipeline

```
ow_prayer_json (Schema)
  → bridge-tool (später)
  → .docx oder .rtf
       Absatzstile: OW_Title, OW_Rubric, OW_Verse, OW_Prose, OW_Response, OW_Note
  → Affinity Publisher: Import / Platzieren
  → Stile im Publisher-Dokument einmalig gestalten
```

## Stil-Mapping

| JSON `kind` | Absatzstil |
|-------------|------------|
| (Dokumenttitel aus title_de) | `OW_Title` |
| `rubric` | `OW_Rubric` |
| `verse` | `OW_Verse` (eine Zeile → ein Absatz oder Soft-Break — Bridge-Option) |
| `prose` | `OW_Prose` |
| `response` | `OW_Response` |
| `title` | `OW_Title` |
| `note` | weglassen wenn `print: false`, sonst `OW_Note` |
| Inline-`note`-Runs in `text`/`lines` | Zeichenstil `OW_InlineNote` innerhalb des Absatzes (nicht eigener Absatz) |

Inline-Anmerkungen (z. B. `(NN)`, `(zwölfmal)`) liegen als Runs `{ "t": "note", "v": "…" }` in der Zeile; Bridge mappt sie auf Character Styles.

## Nicht v0

- IDML-Direktwrite
- automatisches Buch-TOC
- Website-CSS in der Bridge

## Wann bauen

Nachdem ≥5 echte Gebete mit gültiger Lizenz im Schema liegen.
