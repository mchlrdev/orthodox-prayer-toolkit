# 26 — Export-Prefs pro Prayer

**What to build:** HTML-Export-Einstellungen (Kind→Tag-Map, Wrapper an/aus, Wrapper-Tag, Attribute) pro Gebet lokal persistieren; beim erneuten Öffnen des Modals wiederherstellen; Kind→Tag-Map auf Library-Defaults zurücksetzen können (Wrapper/Attrs nicht vom Reset betroffen).

**Blocked by:** 25 — Export-Modal: HTML end-to-end

**Status:** done

- [x] Prefs sind an Library-Root + Prayer-Pfad gebunden (nicht in der Prayer-JSON)
- [x] Öffnen des Export-Modals lädt gespeicherte Prefs für dieses Gebet; fehlende Prefs → Map aus resolved Styles, Wrapper aus
- [x] „Reset“ setzt nur die Kind→Tag-Map auf aktuelle Library/App-Defaults zurück
- [x] Speichern der Prefs geschieht beim erfolgreichen Export und/oder bei bestätigter Änderung im Modal (konsistent und nachvollziehbar)
