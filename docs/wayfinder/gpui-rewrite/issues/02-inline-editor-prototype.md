Type: prototype
Status: resolved
Blocked by: 01, 03

## Question

Lässt sich in GPUI ein **Inline-Editor** bauen, der einen Block direkt im formatierten Text editiert, mit Kind-Styles pro Abschnitt, und sich so verhält wie heute (Cursor, Auswahl, Tastatur, Einfügen, Undo)? Ein grober Prototyp für einen Block, den Mark ausprobiert. Entscheidet den Editor-Ansatz: gpui-component erweitern oder eigenes Element.

## Answer

**Eigenes Element, kein Ausbau von gpui-component.** Mark hat den Prototyp am 5. Okt. 2026 auf macOS ausprobiert: Tippen, Notizen umschalten, Enter/Shift+Enter, Backspace-Zusammenführen, Undo/Redo, Pfeile über Blockgrenzen und Doppelklick funktionieren so, wie er es erwartet. Einziger Wunsch war Ziehen nach Doppelklick (wortweise erweitern), inzwischen eingebaut.

Was der Prototyp festlegt:

- Dokumentmodell als Text + Runs (`text`/`note`) pro Zelle, Layout über `shape_text` mit einem `TextRun` pro Run, Eingabe über `EntityInputHandler` (UTF-16-Bereiche für IME).
- Größe und Schnitt kommen pro Block aus dem Kind, Runs unterscheiden sich nur in der Farbe.
- Backspace am Blockanfang führt mit dem vorherigen Block zusammen (heute in Electron nicht so), Mark hat es angenommen.
- Ein Undo-Verlauf über Tippen und Blockstruktur hinweg fühlt sich richtig an; der genaue Umfang gehört zur App-Architektur.

Noch nicht geprüft: mehrere Variant-Spalten nebeneinander, Find & Replace-Hervorhebung, Einfügen von formatiertem Text, sehr lange Gebete.

Primärquelle: Prototyp in `crates/prayer-ui/src/prototype_editor/` auf `rewrite/gpui`, Stand Commit `b01e918`. Er bleibt dort, bis der echte Editor ihn ersetzt, und wird dann gelöscht (die Commit-Historie hält ihn fest).

