# Affinity export research

Research date: 2026-08-11  
Scope: How Affinity Publisher / Affinity (by Canva / “Studio”) can consume external text as mergeable or dynamically updatable content.  
Primary sources preferred: Affinity Help (`affinity.help` Publisher 2; `affinity.studio/help`), official release notes, Serif/Affinity forum staff posts.

---

## Summary (for decision)

**Best fit for Prayer Toolkit → Affinity layout of styled liturgy:** Affinity **by Canva** **linked text** (DOCX / RTF / TXT) via **File → Place** with **Document Setup → Resources → Import text as linked**, then **Resource Manager → Text**. Official Studio help states DOCX **imports paragraph styles** as in the Word document, and linked text **updates like linked images** when the source changes.

**Data Merge** supports **CSV, TSV, plain text, JSON, and XLSX**, but it is a **record→pages/grid generator**: the source is **embedded** and **does not auto-refresh**; you **Update** manually, then **Generate** a **new** `.af` document. Field values are flat merge tokens (plus image paths/URLs), not a flowing multi-style story. Studio adds **Advanced Data Tools** (filter/sort/process + **JavaScript**) marketed as “conditional logic.”

**Publisher V2** could **Place** DOCX/RTF/TXT into frames, but official V2 import-text help did **not** document live-linked story text; community feature requests treated that as missing. Prefer **Affinity by Canva** if live-linked prayer sources matter.

**Uncertainty:** Exact JSON value types beyond “objects and values”; how aggressively DOCX style *names* map onto pre-existing Affinity styles vs creating imported styles; whether linked-text update replaces local Affinity style overrides (Resource Manager tracks Text vs Format vs All changes).

---

## Data Merge

### Supported formats

Official help (Publisher 2 and Affinity Studio) lists the same source types:

| Format | Supported? | Notes from official help |
| --- | --- | --- |
| **CSV** | Yes | “Text (plain/CSV/TSV)” / “text file (plain, CSV, or TSV)” |
| **TSV** | Yes | Preferred when records contain punctuation (commas) |
| **TXT (plain)** | Yes | As a **data source** (tabular/plain merge file), not the same feature as placed story text |
| **JSON** | Yes | Explicitly supported |
| **XLSX** | Yes | Spreadsheet e.g. Excel, Numbers, LibreOffice |

Sources: [Publisher 2 — Data merge](https://affinity.help/publisher2/en-US.lproj/pages/Advanced/dataMerge.html); [Affinity Studio — Data merge](https://www.affinity.studio/help/advanced-data-merge/); page-layout key features also list “XLSX spreadsheet, TSV, CSV, and JSON” ([Key features — page layout](https://www.affinity.studio/help/introduction-key-features-pagelayout/)).

Marketing shorthand on [Get Affinity](https://www.affinity.studio/get-affinity) highlights “Data merge from **.csv** with tokens, image merge, and **conditional logic**” — CSV is the headline example, not the exclusive format.

### CSV / TSV structure

From official Data merge help:

- **First line (row)** of the file becomes **field names** in Affinity.
- That row **must contain explicit names** (example given: `First name, Last name, email address` → fields *First name*, *Last name*, *email address*).
- CSV is common; **TSV avoids problems** when data contains punctuation.
- Delimiter and quote characters can be controlled in the Data Merge UI when adding a text-based source (Studio: match **Delimiter** and **Quote** to the file).

Image columns: values are **file paths** (absolute, or relative to the data source or saved document) or, for picture-frame binding in Studio, also **URLs**.

### JSON structure

Official requirement (same wording in Publisher 2 and Studio help):

> For JSON files … **only a single top-level array of objects** (and values in those objects) are supported; **lower level arrays and objects are not supported**.

Implied shape:

```json
[
  { "fieldA": "…", "fieldB": "…" },
  { "fieldA": "…", "fieldB": "…" }
]
```

**Not documented officially (uncertainty):** whether nested objects/arrays inside a property are silently dropped vs erroring; which scalar types are allowed beyond strings; UTF-8/BOM expectations for JSON (forum discussions often mention CSV encoding; treat BOM/encoding for JSON as unverified here).

### Live link vs generate-once

Official behavior is **two-stage**, not a live InDesign-style data merge binding in the *output*:

1. **Template document:** Adding a data source **embeds** a copy in the Affinity file. The path is remembered. If the external file changes, you **update the embedded copy manually** — “**it will not update automatically**.” Preflight can warn that the external source was modified (Studio help).
2. **Generate:** Merging creates a **new Affinity document** (`.af` in Studio wording) by repeating pages/grid cells until records are exhausted. Studio Data Merge panel: **Generate** “creates a new Affinity document based on the current document, its enabled data sources and your specified settings.”

So:

- **Not** continuous live refresh of generated pages when the CSV changes.
- **Yes** you can edit the external file → **Update** in Data Merge Manager/panel → **Generate again** (new output doc).
- Community clarification (user PixelEngineer, citing help workflow): after generate, “the data source will **disconnect** upon conversion” in the merged document; keep the **template** for re-merge. Save the spreadsheet/CSV **before** Update/Fix so Affinity reads the on-disk saved state ([forum thread](https://forum.affinity.serif.com/index.php?/topic/157067-preflight-error-data-merge-sources-need-updating-wont-go-away/)). Staff (Dan C) engaged that thread as a bug investigation; the embed/manual-update model matches help, not a staff contradiction.

### Studio-era Data Merge additions (vs classic Publisher merge)

Official Studio Data merge / Data Merge panel docs add **Advanced Data Tools**:

- Filter by range **or criteria** (match all/any rules; case-insensitive comparisons).
- **Sort** on one or more fields.
- **Process** matched records (prefix/postfix, warnings, skip records).
- **Script** tab: **JavaScript** to manipulate the selected data source (example starter code provided).

That is the documented basis for marketing “conditional logic.” Core formats and embed/Generate model remain as above.

---

## Linked / placed text

### What can be placed

Official **Placing content** (Publisher 2 and Studio) lists among placeable documents:

- Microsoft Word (**DOCX**)
- **RTF**
- **Plain text**

Footnote: see **Importing text** for textual documents.  
Sources: [Publisher 2 — Placing content](https://affinity.help/publisher2/en-US.lproj/pages/Media/placeImages.html); [Studio — Placing content](https://www.affinity.studio/help/media-place-images/).

### Publisher V2: import into frames (not documented as live-linked stories)

[Publisher 2 — Importing text](https://affinity.help/publisher2/en-US.lproj/pages/Text/importText.html): Place / drag-drop DOCX, RTF, TXT into text frames (or artistic/path text). Describes content placement; **no** “Import text as linked” / Resource Manager text workflow in that V2 article.

Long-standing community request for “linked text documents” like images ([forum topic](https://forum.affinity.serif.com/index.php?/topic/108635-linked-text-documents/), 2020) treated live-linked Word/RTF/TXT as **missing** — consistent with V2 help silence.

**Resource Manager (general):** Linked vs embedded applies to placed **resources** (images/documents); update via Resource Manager when the source changes ([Publisher 2 Resource Manager](https://affinity.help/publisher2/en-US.lproj/pages/Media/resourceManager.html)). V2 placing tips emphasize linked/embedded for Affinity/PDF/SVG/PSD/EPS — **not** DOCX/RTF/TXT as updatable story links.

### Affinity by Canva: linked text is an official feature

[New features for Affinity 2.x upgraders](https://www.affinity.studio/help/introduction-new-features/):

- **Linked Text Documents** — “Edit external text sources placed in page layouts”; “Linked content updates as you modify original files (**like linked images**)”; “For **DOCX, RTF and TXT** files.”

[Studio — Importing text](https://www.affinity.studio/help/text-import-text/):

1. Document Setup → **Resources** → enable **Import text as linked**.
2. Place via Place Tool / File → Place.
3. “Affinity **maintains links** to any text files placed … You can review their status in the **Resource Manager**.”
4. DOCX: “**Text styles are imported and applied to text as in the original document.**”
5. RTF and plain text also importable; replace / insert / append behavior depends on selection.

[Studio — Resource Manager](https://www.affinity.studio/help/media-resource-manager/):

- Lists **image and text** resources; filter by **Images** or **Text**.
- Text resources expose **Changes**: None / Text / Format / All.
- Linked **Modified** → **Update/Refresh**; Missing → Relink/Replace.
- Settings: **Automatically update linked resources when modified externally**.

March 2026 release notes (official Help Center article body) include Resource Manager fixes that **assume text resources exist**, e.g. “Missing Relink button for **text files** (Mac only)”, “**Text files** get automatically updated from Modified when a file is reopened despite Auto-update Setting being disabled” — evidence that linked text is shipped and being bug-fixed, not merely marketed.

**Uncertainty:** Whether “updates like linked images” always reflows style mappings cleanly after Affinity-side edits; Format vs Text change flags imply partial updates are possible—behavior details beyond the status labels are thinly documented.

---

## RTF/DOCX import for styles

### Official guidance

| Source | Guidance |
| --- | --- |
| Studio Importing text | DOCX **imports text styles** and applies them as in the original. RTF/TXT supported; styles called out explicitly for DOCX. |
| Staff (Lee D), 2019 | Publisher places **.docx, RTF and plain text**. For structured import, staff recommended **plain text** then apply styles **in Publisher** for greater control, because Publisher “may not be able to maintain/recognise styles or structures” from another app ([forum](https://forum.affinity.serif.com/index.php?/topic/93227-publisher-how-to-import-structuredstyled-text/)). |

**Tension to mark:** Older **staff** advice (control via plain text + local styles) vs **current Studio help** (DOCX styles import). For Canva-era Affinity, prefer Studio help for DOCX style import; Lee D’s caution still useful if style fidelity is unreliable across Word→Affinity mappings.

### Practical recommended workflow (styled prayer by `kind`)

Synthesized from primary docs + staff/community practice (label community steps as such):

1. **Define Affinity paragraph styles** named after toolkit kinds (`rubric`, `verse`, `prose`, `response`, `title`, `note`, …).
2. **Preferred for Affinity by Canva + iteration:** Export a **DOCX** (or RTF) where each block is a paragraph with a **matching Word style name**, enable **Import text as linked**, Place into linked frames, iterate on the DOCX and **Update** in Resource Manager.  
   *Rationale: official style import + official linked text.*
3. **Fallback / max control (aligns with Lee D):** Export **plain text** (or lightly tagged text), Place once, apply Affinity styles (optionally Find & Replace / regex on tags — common community pattern in the same thread; not an official “tag language”).
4. **Data Merge** only if the product is **many records → many pages/cards** (one prayer per page, directory, etc.). Put body copy in a field and style the **placeholder** in the template; do **not** expect rich multi-style runs inside one CSV cell from official docs. Nested toolkit JSON must be **flattened** to a top-level array of objects for JSON merge.

---

## Implications for Prayer Toolkit

| Need | Affinity mechanism | Fit |
| --- | --- | --- |
| Export structured prayers with **per-kind paragraph styles** into a layout | **DOCX (styles) → Place**; Studio: **linked** DOCX/RTF/TXT | **Strong** for Studio; V2 Place without live link |
| Keep Affinity layout **in sync** when toolkit text changes | Studio **Import text as linked** + Resource Manager | **Strong** (Studio); weak/absent as documented on V2 |
| Drive **catalogs / one-record-per-page** from flat export | **Data Merge** CSV/TSV/JSON/XLSX → Generate new doc | **Good** for that pattern; poor for long multi-style flowing services |
| Feed **nested** prayer JSON directly to Data Merge | Not supported (top-level array of objects only) | Export a **flattened** merge file |
| Live Data Merge output when CSV edits | No — embed + manual Update + **regenerate** | Design template + re-Generate pipeline |
| Conditional merge logic | Studio Advanced Data Tools / JS | Available in Studio; verify needed rules against Process/Script docs |

**Exporter design suggestions (decision-oriented):**

1. Primary Affinity bridge: **`kind` → Word/RTF paragraph style** exporter (DOCX preferred for style import), optional **link-friendly** single-story or per-section files.
2. Secondary: **flat JSON/CSV** Data Merge exporter for card/catalog use; one object/row per record; no nesting.
3. Target **Affinity by Canva** if linked text is a requirement; keep V2 Place as one-shot import only.
4. Do not rely on Data Merge for liturgical **style runs** inside a single field without verifying in-app (not documented).

---

## Sources

### Official help

- [Affinity Publisher 2 — Data merge](https://affinity.help/publisher2/en-US.lproj/pages/Advanced/dataMerge.html)
- [Affinity Publisher 2 — Placing content](https://affinity.help/publisher2/en-US.lproj/pages/Media/placeImages.html)
- [Affinity Publisher 2 — Importing text](https://affinity.help/publisher2/en-US.lproj/pages/Text/importText.html)
- [Affinity Publisher 2 — Resource Manager](https://affinity.help/publisher2/en-US.lproj/pages/Media/resourceManager.html)
- [Affinity Studio — Data merge](https://www.affinity.studio/help/advanced-data-merge/)
- [Affinity Studio — Data Merge panel](https://www.affinity.studio/help/panels-data-merge-panel/)
- [Affinity Studio — Importing text](https://www.affinity.studio/help/text-import-text/)
- [Affinity Studio — Placing content](https://www.affinity.studio/help/media-place-images/)
- [Affinity Studio — Managing document resources](https://www.affinity.studio/help/media-resource-manager/)
- [Affinity Studio — Embedding vs linking](https://www.affinity.studio/help/media-embedding-vs-linking/)
- [Affinity Studio — New features (2.x upgraders)](https://www.affinity.studio/help/introduction-new-features/)
- [Affinity Studio — Key features — page layout](https://www.affinity.studio/help/introduction-key-features-pagelayout/)
- [Affinity Studio — March 2026 release notes](https://www.affinity.studio/help/mar-26-release-notes/) (article body: Data Merge + Resource Manager / text-file fixes)
- [Get Affinity — feature list](https://www.affinity.studio/get-affinity) (CSV tokens, image merge, conditional logic; linked text frames = frame linking, distinct from linked text *files*)

### Forum (staff / workflow confirmation)

- Lee D (Staff): place DOCX/RTF/plain; prefer plain text + style in Publisher — [Publisher how to import structured/styled text?](https://forum.affinity.serif.com/index.php?/topic/93227-publisher-how-to-import-structuredstyled-text/)
- Dan C (Staff) + community workflow on embed/update/Generate disconnect — [Preflight “Data Merge sources need updating”](https://forum.affinity.serif.com/index.php?/topic/157067-preflight-error-data-merge-sources-need-updating-wont-go-away/)
- Feature request context (linked text missing historically) — [Linked Text Documents](https://forum.affinity.serif.com/index.php?/topic/108635-linked-text-documents/)

### Secondary / not relied on for claims

Third-party tutorials (Elaine Giles, Codec, YouTube) largely restate CSV→Generate; used only as discovery pointers toward official pages, not as authorities.
