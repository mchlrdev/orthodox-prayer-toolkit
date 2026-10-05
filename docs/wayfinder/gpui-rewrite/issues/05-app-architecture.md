Type: grilling
Status: resolved
Blocked by: 01, 04

## Question

Wie ist die Rust-App geschnitten? Welche Crates (`prayer-core`, eine App-Logik-Crate, `prayer-ui`), wo leben Library catalog, Session draft, Dirty-Status und Undo, wie fließen Änderungen zwischen GPUI-Entities, und was bleibt UI-frei und damit ohne Fenster testbar? Dazu der Undo-Umfang: heute gibt es nur Browser-Undo pro Zelle (siehe Ticket 03); reicht das, oder bekommt die neue App ein Undo über Blocks und Strukturänderungen hinweg?

## Grilling notes (Mark, 5. Okt. 2026)

- Undo: ein Verlauf pro Gebet über alles, was den Session draft ändert (Text, Blockstruktur, Kind, Gebets-Einstellungen, Ersetzen); überlebt Gebetswechsel und Speichern, endet beim Schließen der App.
- Block löschen ohne Nachfrage, Cmd+Z holt ihn zurück.
- Kind umbenennen (schreibt andere Gebete) und Kind-Styles bleiben sofort gespeichert und außerhalb des Undo.
- Crates: `prayer-core` (Port des TS-Cores), `prayer-app` (Library catalog, Session drafts, Dirty, Undo, Datei-I/O, ohne GPUI), `prayer-ui` (nur Oberfläche). Leitlinie: **eine Gebetsdatei ist immer ganzheitlich und funktioniert für sich** (docs/overview.md „Self-contained files“). Der Library catalog ist nur ein aus den Dateien abgeleiteter Index, nie Quelle der Wahrheit; nichts, was ein Gebet zum Funktionieren braucht, liegt außerhalb seiner Datei.
- Library-Ordner wird beobachtet; ungeänderte Gebete werden bei Änderung von außen selbst neu eingelesen. Bei geänderten Gebeten: Hinweis statt Überschreiben.
- Konflikt (ungespeicherte Änderungen + Datei außen geändert): Hinweis „Changed on disk“ mit „Reload“ (per Cmd+Z umkehrbar) und „Keep mine“ (Speichern überschreibt).
- Datei außen gelöscht/umbenannt: ungeänderte Gebete folgen der Platte; geänderte bleiben offen mit „Deleted on disk“, Speichern legt die Datei neu an.

## Answer

Drei Crates: `prayer-core` (reiner Port des TS-Cores: Schema, Validierung, Exporte, Kinds, Styles), `prayer-app` (Library catalog als abgeleiteter Index, Session drafts, Dirty-Status, Undo-Verlauf pro Gebet, Datei-I/O und Ordner-Beobachtung, ohne GPUI und ohne Fenster testbar), `prayer-ui` (GPUI-Entities und Elemente, ruft nur `prayer-app`). Jede Gebetsdatei bleibt ganzheitlich und eigenständig; nichts, was ein Gebet braucht, liegt außerhalb seiner Datei.

Undo umfasst alles, was ein Gebet ändert, pro Gebet bis zum Schließen der App; Block-Löschen ohne Nachfrage. Kind-Umbenennung und Kind-Styles bleiben sofort gespeichert und außerhalb des Undo. Neu gegenüber Electron: Der Library-Ordner wird beobachtet, mit den Konfliktregeln oben.
