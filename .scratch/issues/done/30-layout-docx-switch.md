# 30 — Layout DOCX + DOCX|RTF switch

**What to build:** Dieselbe blanke Layout-Story als DOCX; im Modal Switch DOCX | RTF (Default DOCX ohne Prefs); Binary-Save für DOCX; Prefs merken `layoutFormat`; Dateiname `.docx` bzw. weiter `.rtf`. Affinity/InDesign-Place für beide Formate.

**Blocked by:** 29 — Layout RTF end-to-end

**Status:** done

- [ ] Core DOCX mit denselben Stilnamen/Soft-Breaks/Notes/Include-empty/blank styles wie RTF
- [ ] Save-Dialog akzeptiert Binary (DOCX) ohne Korruption; Filter/Titel passen zum Format
- [ ] Switch DOCX|RTF unter Layout; Default DOCX; Prefs stellen Format nach erfolgreichem Layout-Export wieder her
- [ ] Dateinamen `{id}.{lang}.{variant}.docx` / `.rtf`; RTF-Pfad aus 29 bleibt nutzbar
