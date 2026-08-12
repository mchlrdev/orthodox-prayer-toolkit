# Affinity bridge

Decision notes for mapping prayer structure to **named paragraph styles** for Affinity Publisher (and similar DTP tools).

Layout exporters in Core (`exportLayoutRtf`, `exportLayoutDocx`) implement the toolkit side of this pipeline. Full print/product ownership remains with the consumer document.

## Pipeline

```
Prayer JSON (schema)
  → Core layout export (RTF or DOCX)
       Named paragraph styles (prefix stem, default `opt`)
  → Affinity Publisher: place / import
  → Style the named styles once in the Publisher document
```

Style prefix stem can be set per library via `manifest.stylePrefixStem` (see [library.md](library.md)).

## Kind → paragraph style (conceptual)

Exact prefixed names depend on the stem and exporter; the semantic mapping is:

| JSON `kind` (typical) | Role in layout |
|-----------------------|----------------|
| Document / variant title | Title paragraph style |
| `heading` / `subheading` | Heading styles |
| `annotation` | Rubric / annotation style |
| `verse` | Verse style (one content line → paragraph or soft-break — exporter option) |
| Other custom kinds | Mapped via kind → style name rules in the exporter |

Inline `note` runs inside `text` / `lines` map to a **character** style (inline note), not their own paragraph.

## Not in v0 bridge scope

- IDML direct write
- Automatic book TOC generation
- Pushing website CSS into Affinity

## When to lean on this

After you have real licensed prayers in schema and a Publisher template whose paragraph styles match the export names. See [Core API — Layout](core-api.md#layout-rtf--docx).

## Related

- [Prayer format](prayer-format.md)
- [Product decisions](prayer-framework.md)
