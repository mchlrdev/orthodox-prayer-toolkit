Type: grilling
Status: resolved
Blocked by: 01

## Question

Wie werden Kind-Styles (Schrift, Größe, Farbe, Gewicht, Abstände aus App- und Library-Styles) auf GPUI-Textstile abgebildet, welche Schriften sind auf allen drei Systemen verfügbar oder werden mitgeliefert, und wie verhalten sich Hell/Dunkel-Modus und das `gpui-component`-Theme dazu?

## Answer

Mark, 5. Okt. 2026:

- Kind-Style-Werte 1:1 wie heute: Größen S/M/L/XL = 0,875/1/1,125/1,35 rem (14/16/18/21,6 px bei 16 px Basis), Farben Base/Accent hell `#1a1a1a`/`#8b2942`, dunkel `#f2f2f2`/`#d46b82`, fett, kursiv, Accent initial, Indicate, Ausrichtung. Auflösung wie heute: eingebaute Defaults, darüber die `styles.json` der Library.
- Blocksatz (Standard für Verse und Anmerkungen) kann GPUI nicht (`TextAlign` nur Left/Center/Right); wir bauen ihn im eigenen Textlayout des Editors.
- Eine freie Serifenschrift für Gebetstext wird mitgeliefert, damit es auf allen Systemen gleich aussieht. Welche, entscheidet [Schrift für Gebetstext](12-prayer-font.md) (Mark wünscht „Libron“ als Kandidaten).
- Oberfläche: Einstellung Light/Dark/System bleibt, `gpui-component`-Theme auf die heutige Palette abgestimmt, Systemschrift für die UI.

