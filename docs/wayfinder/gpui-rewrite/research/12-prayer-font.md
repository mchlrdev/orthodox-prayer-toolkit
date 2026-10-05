# 12 – Gebetsschrift (Serif) für die GPUI-App

Stand: 2026-10-05. Geprüft: Cmap per fontTools, Rendering mit Chromium (Playwright, @font-face mit lokalen Dateien, 17 px und 22 px).
Geprüfte Zeichen: Latein inkl. ä ö ü ß; Kirchenslawisch ѣ ѳ ѵ і ѡ ѧ ѫ ꙋ ѿ ꙗ ѕ; U+0483–U+0487; zusätzlich U+2DED (Hochgestelltes ⷭ im „Гдⷭ҇и“); polytonisches Griechisch ἐκομίσατο, ἀθλήσει, Ὁ, ᾧ, ῥ.
Schriftdateien lagen nur im Scratchpad (`.../scratchpad/fonts/`), nicht im Repo.

## „Libron“

Eine Schrift namens **Libron** existiert: https://github.com/nicoverbruggen/libron (Nico Verbruggen, 2026). Sie ist eine überarbeitete Fassung von „Readerly“, das wiederum aus **Newsreader** (Production Type) abgeleitet ist; gedacht für E-Reader. Lizenz OFL. Stile: Regular, Italic, Bold, BoldItalic (statische TTFs, WOFF2).
Der Release-Download (github.com/.../releases) ist im Proxy gesperrt (403). Die FontForge-Quellen (`src/*.sfd`) kamen über raw.githubusercontent.com; daraus mit FontForge TTFs gebaut (nur für den Test).
**Ergebnis: Libron enthält weder Kyrillisch noch Griechisch** (SFD: 0 kyrillische, 0 griechische Glyphen, ~416 lateinische). Es ist damit für den Zweck nicht verwendbar, außer als reine Latein-Schrift mit Fallback. Das gilt auch für die Basis Newsreader.

## Vergleich

| Schrift | Quelle | Lizenz | Stile | Fehlende Codepoints (von den geprüften) |
|---|---|---|---|---|
| Libron | github.com/nicoverbruggen/libron (src/*.sfd) | OFL 1.1 | R, I, B, BI (statisch) | Kyrillisch und Griechisch komplett; Latein/Umlaute ok. Fehlt u. a. U+0461 0463 0467 046B 0473 0475 047F 0483–0487 A64B A657 2DED, alle Griechisch |
| Noto Serif | https://github.com/google/fonts/tree/main/ofl/notoserif (Noto Project Authors) | OFL 1.1 | Variabel wght 100–900 + wdth 62,5–100, Upright + Italic (deckt R/I/B/BI) | **keine** (inkl. U+0483–0487, U+2DED) |
| Gentium Book Plus | https://github.com/google/fonts/tree/main/ofl/gentiumbookplus (SIL) | OFL 1.1 (Reserved Names „Gentium“, „SIL“) | R, I, B, BI (statisch) | U+0461 ѡ, U+0467 ѧ, U+046B ѫ, U+047F ѿ, U+A64B ꙋ, U+A657 ꙗ, U+0483–0487, U+2DED; Griechisch ok |
| Libertinus Serif | https://github.com/google/fonts/tree/main/ofl/libertinusserif (Quelle: github.com/alerque/libertinus) | OFL 1.1 | R, I, B, BI (statisch) | U+0484–0487, U+A64B ꙋ, U+A657 ꙗ, U+2DED (Bold zusätzlich U+0461 0467 046B 047F 0483); Griechisch ok |

Weitere geprüft, nicht gerendert:
- EB Garamond (OFL, variabel wght 400–800 + Italic): fehlen U+0461 0467 047F 0483–0487 A64B A657.
- Source Serif 4 (OFL, variabel): fehlen u. a. ѡ ѧ ѫ ѿ ꙋ ꙗ, 0483–0487 und mehrere polytonische Zeichen (ἐ Ἀ-Block U+1F00, 1F10, 1F49, 1FA7, 1FE5).
- Ponomar Unicode (SCI, OFL, https://github.com/slavonic/Ponomar bzw. google/fonts ofl/ponomar): Kirchenslawisch vollständig, aber nur ein Stil (Regular) und kein Griechisch (U+03AE… und U+1F00… fehlen). Nur als Zusatzschrift für Slawisch denkbar, nicht als Hauptschrift. Monomakh/Pochaevsk nicht geladen (ebenfalls Slawisch-Spezialfonts).
- Hinweis: Alle OFL-Schriften dürfen gebündelt werden; OFL-Text und Copyright mitliefern, Reserved Font Names bei Änderung beachten (Gentium).

## Visuelle Beobachtungen (aus den PNGs)

- **Noto Serif**: Alle Zeilen sauber; Titlo, Akzente (Oxia/Varia), Pokrytie und das hochgestellte ⷭ über Гд…и sitzen korrekt; keine Tofu-Kästchen. Italic-Kirchenslawisch („Ѳеѡ́форъ ѕѣлѡ̀ ꙗ҆́кѡ“) lesbar. Nüchtern, etwas breit/gedrungen, weniger „Buchcharakter“, dafür robust.
- **Gentium Book Plus**: Schöne, ruhige Buchschrift, Griechisch sehr gut. Bei „Гдⷭ҇и“ erscheinen zwei Tofu-Kästchen (U+2DED und U+0487 fehlen). Ѡ/ѿ-Zeichen kommen aus der Systemfallback-Schrift (ꙋ, ꙗ, ѡ wirken dort uneinheitlich).
- **Libertinus Serif**: Elegante Buchschrift, Griechisch gut; bei „Гдⷭ҇и“ zwei Tofu-Kästchen; ѡ und ꙗ stammen teils aus Fallback (ω-Form wirkt „lateinisch“).
- **Libron**: Lateinischer Text sehr angenehm (Newsreader-Charakter, etwas kräftiger), aber Kyrillisch/Griechisch komplett aus der Systemfallback-Schrift, Tofu bei Гдⷭ҇и (drei Kästchen).
- Hinweis zur Methode: Chromium fällt bei fehlenden Glyphen auf Systemschriften zurück; deshalb zählt für die Bewertung die Cmap-Prüfung, die Bilder zeigen die Fallbacks nur indirekt (als abweichender Strich/Tofu).

## PNGs

- /mnt/project-files/gpui-rewrite/fonts/libron.png
- /mnt/project-files/gpui-rewrite/fonts/noto-serif.png
- /mnt/project-files/gpui-rewrite/fonts/gentium-book-plus.png
- /mnt/project-files/gpui-rewrite/fonts/libertinus-serif.png
- /mnt/project-files/gpui-rewrite/fonts/overview.png (alle vier)

## Empfehlung

Als Hauptschrift **Noto Serif** (OFL, variabel, Upright + Italic): als einzige der geprüften Kandidaten deckt sie sämtliche geforderten Zeichen ab – Latein mit Umlauten, vollständiges Kirchenslawisch einschließlich Titlo, U+0484–0487 und U+2DED, sowie polytonisches Griechisch – und rendert die Kombinationszeichen im Test fehlerfrei; Regular, Italic und Bold sind über die Variable-Font-Achsen abgedeckt (bei GPUI prüfen, ob Variable-Font-Instanzen unterstützt werden, sonst statische Instanzen mit fontTools `instancer` erzeugen). Gentium Book Plus oder Libertinus Serif wirken als Buchschrift schöner, haben aber Lücken im Kirchenslawischen (ѡ ѧ ѫ ѿ ꙋ ꙗ, Combining-Marks), die man nur mit einer zweiten Schrift (z. B. Noto Serif als Fallback oder Ponomar für Slawisch) füllen könnte. Libron kommt als Hauptschrift nicht in Frage, da Kyrillisch und Griechisch gänzlich fehlen.

## Garamond-Varianten

Geprüft mit derselben Codepoint-Liste (Cmap, fontTools) plus U+2DED; Rendering wie oben. Dateien nur im Scratchpad.

| Schrift | Quelle | Lizenz | Stile | Fehlende Codepoints |
|---|---|---|---|---|
| EB Garamond | https://github.com/google/fonts/tree/main/ofl/ebgaramond (Octavio Pardo; Ursprung Georg Duffner) | OFL 1.1 | variabel wght 400–800, Upright + Italic (R/I/B/BI) | ѡ U+0461, ѧ U+0467, ѿ U+047F, ꙋ U+A64B, ꙗ U+A657, U+0483–0487, U+2DED. Latein, Umlaute, ѣ ѳ ѵ і ѫ ѕ und polytonisches Griechisch vorhanden |
| Cormorant Garamond | https://github.com/google/fonts/tree/main/ofl/cormorantgaramond (Christian Thalmann, Catharsis Fonts) | OFL 1.1 | variabel wght 300–700, Upright + Italic | Griechisch teilweise (α ε θ ι κ λ ο σ τ, ή, ί, ἀ U+1F00, ἐ U+1F10, Ὁ U+1F49, ᾧ U+1FA7, ῥ U+1FE5), ѡ ѧ ѿ ꙋ ꙗ, U+0483–0487, U+2DED. Gleiches Bild für Cormorant (ohne „Garamond“) |

- Weitere freie Garamonds: „Garamond Libre“ und „Garamondt“ nicht als Dateien gefunden (nicht in google/fonts; Downloadquellen über den Proxy nicht erreichbar bzw. nicht verifizierbar), daher nicht geprüft. Die Original-Quelle von EB Garamond (github.com/georgd/EB-Garamond) liefert keine fertigen TTFs im Repo (Releases gesperrt, 403).
- Keine Garamond ist vollständig. EB Garamond ist die beste reine Garamond: Griechisch komplett, Kirchenslawisch bis auf fünf Buchstaben und alle Kombinationszeichen. Cormorant Garamond ist wegen des fast fehlenden Griechisch ungeeignet (im Bild sieht man Fallback in anderer Strichstärke).

### Kombination EB Garamond mit Noto Serif als Fallback

Stack `'EB Garamond','Noto Serif'` (entspricht der glyphweisen Fallback-Logik der App). Fehlende Zeichen (ѡ ѿ ꙗ ꙋ, Titlo, ⷭ) kommen aus Noto Serif.
- Positiv: Keine Tofu-Kästchen mehr; Titlo und ⷭ über „Гдⷭ҇и“ sitzen korrekt.
- Nachteil: Noto Serif hat deutlich größere x-Höhe und dunkleren Strich als EB Garamond; die Fallback-Glyphen (ѡ in „нашегѡ“, „Ѳеѡ́форъ“, ꙗ, „Мѹ́“ und das „Д“ im Titlo-Cluster) wirken sichtbar größer und fetter und zerreißen die Zeile. Bei 17 px stärker als bei 22 px. Der Cluster „Гдⷭ҇и“ fällt bei Fallback als Ganzes aus Noto, wodurch Д/д-Form und Größe wechseln.
- Urteil: Als Notlösung akzeptabel, für liturgischen Satz mit häufigen ѡ/ѿ/Titlo (also fast jede Zeile) eher störend. Kosmetisch lässt sich Noto skalieren (ca. 0,88 × Größe) oder in der Gewichtung leichter wählen (Variable Font wght ca. 350), falls GPUI das erlaubt.

PNGs: /mnt/project-files/gpui-rewrite/fonts/garamond-eb-garamond.png, garamond-cormorant-garamond.png, garamond-noto-fallback.png, overview-garamond.png (Noto Serif, EB Garamond, Stack).

### Empfehlung (Garamond)

Wenn der Garamond-Charakter gewünscht ist: EB Garamond als Primärschrift mit Noto Serif als Fallback bündeln und die Fallback-Glyphen in Größe (ca. 0,88–0,92) und Gewicht angleichen, falls die App das pro Fallback-Schrift steuern kann. Ohne diese Feinjustierung bleibt Noto Serif allein die sicherere Wahl, weil sie ohne Fallback konsistent aussieht.
