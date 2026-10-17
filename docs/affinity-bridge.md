# Affinity bridge

Decision notes for mapping prayer structure to **named paragraph and character styles** for Affinity Publisher (and similar DTP tools).

Layout exporters in Core (`exportLayoutRtf`, `exportLayoutDocx`) implement the toolkit side of this pipeline. Full print/product ownership remains with the consumer document.

## Pipeline

```
Prayer JSON (schema)
  → Core layout export (RTF or DOCX)
       Named kind paragraph styles + character style `note`
       (prefix stem, default `opt`)
  → Affinity Publisher: place / import
  → Style each named style in the Publisher document
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

Place imports each kind paragraph style that is applied to a paragraph (`opt_verse`, `opt_heading`, …) and the character style `opt_note` / `note` on inline spans. Body runs show `[No Style]` as a character style; that is expected.

Publisher Place does **not** keep a shared parent from Word/RTF `basedOn`, and it flattens a character style applied to a whole paragraph. Set typeface and Based on per imported kind style in the Publisher document.

When a block’s effective direction is RTL, the paragraph style name gets an `_rtl` suffix (`opt_verse` → `opt_verse_rtl`). Layout files do not set native bidi — the Publisher template owns RTL on those named styles.

## Not in v0 bridge scope

- IDML direct write
- Automatic book TOC generation
- Pushing website CSS into Affinity

## When to lean on this

After you have real licensed prayers in schema and a Publisher template whose paragraph styles match the export names. See [Core API — Layout](core-api.md#layout-rtf--docx).

## Related

- [Prayer format](prayer-format.md)
- [Product decisions](prayer-framework.md)
