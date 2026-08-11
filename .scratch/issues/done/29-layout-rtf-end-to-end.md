# 29 — Layout RTF end-to-end

**What to build:** Im Export-Dialog Format „Layout“ wählen und als RTF exportieren: blanke Absatzstile (`{stem}_`+`kind` bzw. bare `kind`), Zeichenstil für Notes, Soft-Breaks bei `lines`, Body only, Include-empty aus Ticket 27. Prefix-Stamm im Modal (leer = kein Prefix), Live-Validierung, Reset nur auf Library→`opt`-Kette. Prefs speichern Layout-Stamm bei erfolgreichem Layout-Export; Dateiname `{id}.{lang}.{variant}.rtf`.

**Blocked by:** 27 — Include blocks without translation; 28 — Library style-prefix stem

**Status:** done

- [ ] Format-Liste enthält Layout; unter Layout Prefix-Stamm + Reset + RTF-Export (DOCX-Switch darf noch fehlen oder fest RTF)
- [ ] Core Layout-RTF: keine Typografie an Stilen; Soft-Breaks; Notes als Character-Style; Meta/Titel nicht im Body; Include-empty wie Spec
- [ ] Prefix: Modal leer = bare names; Prefs/Library/`opt`-Kette wie Spec; Export gesperrt bei ungültigem Stamm
- [ ] Speichern liefert Place-taugliches RTF; Prefs: Layout-Stamm + Include-empty; HTML-Prefs unangetastet bei Layout-Export
