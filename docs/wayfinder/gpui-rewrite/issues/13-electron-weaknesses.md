Type: grilling
Status: resolved
Blocked by: 04, 05

## Question

Welche bekannten Schwächen der Electron-App (Paritäts-Checkliste) baut die neue App nach, welche behebt sie? Offen: unsichtbare Validierungsfehler beim Editieren, „Install and Restart“ ohne Nachfrage bei ungespeicherten Änderungen, kein Nachfragen beim Gebetswechsel.

## Answer

Mark, 5. Okt. 2026:

- Validierungsfehler werden sofort beim Editieren angezeigt: Markierung an der betroffenen Stelle, Anzahl im Kopf des Gebets.
- „Install and Restart“ mit ungespeicherten Änderungen zeigt vorher den Unsaved-changes-Dialog (Save all / Discard all / Cancel).
- Gebetswechsel bleibt ohne Nachfrage; ungespeicherte Gebete bleiben im Speicher und tragen den Punkt in der Liste.
- Cmd+S fehlt nicht mehr (siehe Menüs und Tastenkürzel); die wirkungslosen App-Kind-Styles entfallen ersatzlos.
