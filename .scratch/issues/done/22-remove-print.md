# 22 — `print` aus dem Modell entfernen

**What to build:** Das ungenutzte Übersetzungsfeld `print` vollständig aus Schema, Types, Flat-Export, Annotation-Commit und Examples entfernen, sodass keine toten Daten mehr geschrieben oder validiert werden.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `print` ist nicht mehr Teil des Prayer-/Flat-Modells und nicht mehr im JSON-Schema
- [x] Annotation-Commit schreibt kein `print` mehr
- [x] Examples und Fixtures enthalten kein `print`
- [x] Core- und App-Tests grün ohne Bezug auf `print`
