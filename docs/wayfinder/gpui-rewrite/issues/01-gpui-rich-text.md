Type: research
Status: resolved

## Question

Was bieten GPUI (über `gpui-kit` 0.7.1) und `gpui-component` heute für **editierbaren Text mit gemischten Styles**: Textlayout mit Runs (Schrift, Farbe, Gewicht pro Abschnitt), Cursor, Auswahl, IME/Komposition, Copy/Paste, Undo? Wie macht Zeds Editor das, und welche Teile davon sind als Crate nutzbar? Ergebnis: welche Bausteine es gibt und was selbst gebaut werden müsste, mit Quellen.

## Answer

GPUI liefert gestyltes Textlayout mit Runs (`TextRun`: Schrift, Farbe, Gewicht, kursiv, Hintergrund, Unter-/Durchstreichung) plus Hit-Testing, aber keine Schriftgröße pro Run. Cursor, Auswahl, IME, Zwischenablage und Undo gibt es fertig nur im Plain-Text-Editor von `gpui-base`/`gpui-component`; dessen Hervorhebungen sind Overlays, wachsen beim Tippen nicht mit und werden vom Undo nicht erfasst. Zeds Editor ist GPL und nicht als Crate verfügbar.

Folge: ein eigenes, UI-freies Dokumentmodell auf Run-Basis (mit Undo, getestet) plus ein eigenes GPUI-Editier-Element über `EntityInputHandler`. Die fehlende Größe pro Run stört nicht: Kind und damit Schriftgröße gelten pro Block (`packages/core/src/types.ts`), Runs innerhalb eines Blocks sind nur `text`/`note` (`textRuns.ts`) und unterscheiden sich heute nur in der Farbe (`styles.css:1673` Initiale, `:1681` Notiz). Details und Quellen: [research/01-gpui-rich-text.md](../research/01-gpui-rich-text.md).
