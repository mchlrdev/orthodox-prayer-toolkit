# 02 — Prayer-Schema + Validate in Core

**What to build:** JSON-Schema für multilinguales Prayer (Modell A) und eine Core-Funktion `validate`, die gültige Gebete akzeptiert und ungültige mit klaren Fehlern ablehnt — mit Tests, ohne UI-Pflicht.

**Blocked by:** 01 — Standalone-Toolkit-Scaffold

**Status:** done

- [x] Schema deckt id, title, type, variants[], structure[] mit Block-id, offenem kind, translations ab
- [x] Fehlende Übersetzungen sind erlaubt (kein leerer Pflicht-Key)
- [x] Core-Tests: mindestens eine gültige und mehrere ungültige Fixtures

**Completed:** Implemented in the living toolkit; archived so agents do not re-pick this ticket.
