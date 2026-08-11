# 06 — Identität speichern

**What to build:** Felder `id`, `title`, `type`, optionale Kategorie (`book`/`occasion`), `tone`, `links`, `meta` in der UI editieren und auf Disk speichern; nach Reload unverändert. Klare Regel für `id`-Änderung vs. Dateiname/Kollision.

**Blocked by:** 05 — Gebet öffnen + Validierungsstatus in der UI

**Status:** done

- [x] Genannte Identitätsfelder sind editierbar und speicherbar
- [x] Reload aus der Datei zeigt dieselben Werte
- [x] `id`-Änderung folgt einer dokumentierten Regel (Datei umbenennen und/oder Kollision verhindern)
- [x] Speichern löst erneute Validierung aus bzw. blockiert ungültigen Stand klar

**Completed:** Implemented in the living toolkit; archived so agents do not re-pick this ticket.
