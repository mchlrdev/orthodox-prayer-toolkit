# 14 — Flat-Export in Core

**What to build:** Core-Funktion `exportVariant(prayer, { lang, variant })` liefert Flat-JSON; Blöcke ohne Text für die Variante entfallen; Golden-Tests.

**Blocked by:** 02 — Prayer-Schema + Validate in Core; 09 — Block-Übersetzungen editieren

**Status:** done

- [x] Export enthält nur die gewählte Variante
- [x] Blöcke ohne Übersetzung fehlen im Export
- [x] Mindestens ein Golden-Fixture (Input → erwartetes Flat-JSON)

**Completed:** Implemented in the living toolkit; archived so agents do not re-pick this ticket.
