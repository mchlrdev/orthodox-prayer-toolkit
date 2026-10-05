Type: grilling
Status: claimed
Blocked by: 01, 04

## Question

Wie ist die Rust-App geschnitten? Welche Crates (`prayer-core`, eine App-Logik-Crate, `prayer-ui`), wo leben Library catalog, Session draft, Dirty-Status und Undo, wie fließen Änderungen zwischen GPUI-Entities, und was bleibt UI-frei und damit ohne Fenster testbar? Dazu der Undo-Umfang: heute gibt es nur Browser-Undo pro Zelle (siehe Ticket 03); reicht das, oder bekommt die neue App ein Undo über Blocks und Strukturänderungen hinweg?

## Grilling notes (Mark, 5. Okt. 2026)

- Undo: ein Verlauf pro Gebet über alles, was den Session draft ändert (Text, Blockstruktur, Kind, Gebets-Einstellungen, Ersetzen); überlebt Gebetswechsel und Speichern, endet beim Schließen der App.
- Block löschen ohne Nachfrage, Cmd+Z holt ihn zurück.
- Kind umbenennen (schreibt andere Gebete) und Kind-Styles bleiben sofort gespeichert und außerhalb des Undo.
- Crates: `prayer-core` (Port des TS-Cores), `prayer-app` (Library catalog, Session drafts, Dirty, Undo, Datei-I/O, ohne GPUI), `prayer-ui` (nur Oberfläche). Leitlinie: **eine Gebetsdatei ist immer ganzheitlich und funktioniert für sich** (docs/overview.md „Self-contained files“). Der Library catalog ist nur ein aus den Dateien abgeleiteter Index, nie Quelle der Wahrheit; nichts, was ein Gebet zum Funktionieren braucht, liegt außerhalb seiner Datei.
- Library-Ordner wird beobachtet; ungeänderte Gebete werden bei Änderung von außen selbst neu eingelesen. Bei geänderten Gebeten: Hinweis statt Überschreiben (Details Runde 2).
