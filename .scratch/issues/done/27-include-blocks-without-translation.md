# 27 — Include blocks without translation

**What to build:** Im Export-Dialog eine immer sichtbare Checkbox „Include blocks without translation“ (Default aus). Flat-JSON- und HTML-Export lassen Blöcke ohne Übersetzung für die gewählte Variante weiterhin weg, sofern die Checkbox aus ist; wenn an, bleiben leere Slots erhalten (Flat: leere Payload; HTML: leeres Element mit `data-kind`). Die Einstellung wird bei jedem erfolgreichen Export pro Gebet in den Export-Prefs gespeichert — ohne HTML-spezifische Prefs zu überschreiben, wenn gerade Flat JSON exportiert wird.

**Blocked by:** None — can start immediately

**Status:** done

- [ ] Checkbox immer im Export-Modal, Label genau `Include blocks without translation`, Default unchecked / aus Prefs wiederhergestellt
- [ ] Core Flat- und HTML-Export akzeptieren `includeBlocksWithoutTranslation`; bei false/absent identisches Verhalten wie heute (Goldens)
- [ ] Bei true: fehlende Übersetzungen als leere Slots laut Spec (Flat `text: ""` bzw. `lines: []`; HTML leeres Element)
- [ ] Erfolgreicher Export speichert die Flag in den Per-Prayer-Prefs; HTML-Felder nur bei HTML-Export mitschreiben
