# Affinity / InDesign Place test samples

Generated from the HTML-export sample prayer (Trisagion fragment).

## Files

| File | Format |
| --- | --- |
| `html-sample.de.standard.docx` | Word DOCX with paragraph styles `heading`, `annotation`, `verse` and character style `note` |
| `html-sample.de.standard.rtf` | RTF with the same style names |

## What to check in Affinity

1. Open **Affinity** (Studio / Affinity.app) or **Affinity Publisher 2**.
2. Create a text frame.
3. **File → Place** each file into the frame (try DOCX first, then RTF).
4. In Affinity Studio: Document Setup → Resources → enable **Import text as linked** if you want update-on-change; then Place again.
5. Inspect **Text Styles / Paragraph Styles**:
   - Are styles named `heading`, `annotation`, `verse` present?
   - Is inline `note` (italic "Starker") preserved?
6. Optionally open the same files in **InDesign** via Place + Show Import Options → Preserve Styles.

## Regenerating

```bash
node samples/generate-affinity-place-samples.mjs
```
