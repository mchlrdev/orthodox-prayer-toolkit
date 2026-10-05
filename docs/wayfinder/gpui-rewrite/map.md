# Karte: GPUI-Rewrite

Wayfinder-Karte für den Umbau der Electron-App auf Rust + GPUI. Tickets liegen unter [`issues/`](issues/), Recherche-Ergebnisse unter [`research/`](research/). Diese Karte ersetzt das frühere Plan-Dokument (eingefroren).

## Destination

Die GPUI-App ersetzt die Electron-App auf `main`: alle Funktionen und UX-Abläufe gleich oder besser, Auto-Update aus GitHub-Releases auf macOS, Windows und Linux, `packages/` (Electron-App und TS-Core) entfernt.

## Notes

- **Domäne:** Begriffe aus [`docs/glossary.md`](../../glossary.md) (Library, Block, Kind, Variant, Session draft). Regeln aus [`AGENTS.md`](../../../AGENTS.md) gelten weiter: Geschäftslogik im Core, Schema ist Gesetz, Inhalt ≠ Design.
- **Skills:** grilling + domain-modeling für Grilling-Tickets, prototype für Prototyp-Tickets, research (über Sonnet-Helfer) für Recherche, codebase-design für Modulgrenzen.
- **Nur Entscheidungen:** Die Karte entscheidet, gebaut wird daneben auf `rewrite/gpui`, sobald eine Entscheidung steht.
- **Feste Vorgaben von Mark (5. Okt. 2026):**
  - Direktes Editieren im formatierten Text ist Pflicht, kein anderes Bedienkonzept.
  - Volle Parität aller Funktionen und Abläufe, oder besser. Vor der Umstellung eine Paritäts-Checkliste, alles abgehakt.
  - Alle drei Plattformen, gleichwertig.
  - Oberfläche bleibt Englisch.
  - Einstellungen: Kind-Styles aus der Electron-App automatisch übernehmen, Rest frisch.
  - Signierung: ohne Zertifikate wie heute (ad-hoc), Warnungen akzeptiert.
  - Keine Leistungsmessung als Vorbedingung; Motivation ist Electron-RAM/Tempo und das Experiment selbst.
  - Einziger Nutzer ist Mark: Umstieg per Neuinstallation, keine automatische Brücke.
- **Bereits gebaut:** Cargo-Workspace (`crates/prayer-core`, `crates/prayer-ui`), Rust-CI auf drei Systemen, Updater (Velopack, Beta = GitHub-Pre-Releases `gpui-v*`), Release-Workflow `gpui-release.yml`.
- **Kommunikation:** Mark schreibt Deutsch.

## Decisions so far

<!-- eine Zeile pro gelöstem Ticket: Name als Link, Kernaussage -->

- [Was GPUI für editierbaren formatierten Text bietet](issues/01-gpui-rich-text.md): Layout mit farbigen Runs ja, Editier-Logik nur für Plain Text; wir bauen Dokumentmodell und Editier-Element selbst, Größe pro Run wird nicht gebraucht.
- [Wie sich der heutige Inline-Editor verhält](issues/03-current-editor-behaviour.md): Browser liefert Cursor/IME/Undo, App fängt nur Enter, Shift+Enter, Backspace, Einfügen, Notiz-Kürzel ab; kein App-Undo, Übernahme beim Verlassen der Zelle.
- [Welche Rust-Crates den Core-Port tragen](issues/06-core-port-crates.md): `jsonschema` + `docx-rs` + `regex`, RTF und HTML von Hand; Ajv-Meldungen und DOCX-Bytes werden nicht gleich.
- [Paritäts-Checkliste](issues/04-parity-checklist.md): 268 Punkte in 20 Bereichen; App-weite Kind-Styles sind heute wirkungslos, mehrere Lücken der Electron-App gefunden.
- [Selbst-Update auf echten Geräten](issues/08-self-update-on-devices.md): beta.2 → beta.3 per Selbst-Update funktioniert; Velopack bleibt.
- [Inline-Editor-Prototyp](issues/02-inline-editor-prototype.md): eigenes GPUI-Element mit Text+Runs-Modell trägt; Mark hat es auf macOS ausprobiert, Backspace-Zusammenführen und Undo über Blocks angenommen.
- [Wie die Rust-App geschnitten ist](issues/05-app-architecture.md): `prayer-core` / `prayer-app` (UI-frei) / `prayer-ui`; Gebetsdatei bleibt eigenständig, Catalog nur Index; Undo pro Gebet über alles; Ordner wird beobachtet.
- [Wie genau der Rust-Core dem TS-Core entspricht](issues/07-core-port-strategy.md): gleiche Ergebnisse (DOCX nur inhaltlich), idiomatisch neu geschrieben statt übersetzt; TS-Core nur Referenz bis zur Umstellung, dann weg.
- [Kind-Styles in GPUI](issues/09-kind-styles-in-gpui.md): Werte 1:1, Blocksatz selbst gebaut, Gebetsschrift wird mitgeliefert (Auswahl offen), Theme auf heutige Palette.
- [Menüs und Tastenkürzel](issues/11-menus-and-shortcuts.md): keine Menüleiste unter Windows/Linux, alles in der App erreichbar; Cmd+S/O/N/, neu, alte Kürzel 1:1; Kontextmenüs erwünscht.
- [Schwächen der Electron-App](issues/13-electron-weaknesses.md): Validierung live sichtbar, Neustart fürs Update fragt nach ungespeicherten Änderungen, Gebetswechsel bleibt ohne Nachfrage.
- [Update-Verhalten](issues/14-update-behaviour.md): Download im Hintergrund, nur Neustart fragen; nur Apple Silicon; Deltas optional.
- [Wo die Electron-App Kind-Styles speichert](issues/10-electron-settings-location.md): `userData/Orthodox Prayer Toolkit/kind-styles.json` pro OS; wirkt aber nicht auf die Darstellung (siehe Parität), die echten Styles liegen in der Library.

## Not yet specified

- **Export-Abläufe in der neuen UI** (Export-Dialog, Vorschau, Dateiauswahl): hängt an Core-Port und App-Architektur.
- **Find & Replace im neuen Editor**: hängt an der Editor-Entscheidung; Hervorhebungen und Ersetzen über mehrere Blocks.
- **Gebetsliste und Katalog bei großen Libraries**: virtuelle Liste, Einlesen im Hintergrund; vermutlich unkritisch, wird nach der Architektur klar.
- **Umstellung selbst**: Reihenfolge von Merge, Entfernen von `packages/` (Schema und Fixtures ziehen vorher an einen neuen Ort, Docs und AGENTS.md werden umgeschrieben), App-Name/Bundle-ID/Update-Kanal von Beta auf stabil; Signierung dann neu bewerten.
- **Bedienkonzept mit Kontextmenüs**: welche heutigen Drei-Punkte-Menüs und Knöpfe durch Rechtsklick-Menüs ersetzt oder ergänzt werden (Gebetsliste, Blocks, Kinds); wird beim Bau der jeweiligen Bereiche entschieden.
- **UI-Tests**: wie viel über `gpui-kit`-Test-Support (headless Fenster, Snapshots) abgesichert wird.

## Out of scope

- Library-Leser / HTML-Rendering für Ortho Wiki, Rust-Core als WASM (Mark, 5. Okt.). Der TS-Core wird dafür nicht aufgehoben.
- Browser-Modus (`pnpm dev` im Browser) entfällt.
- Mehrsprachige Oberfläche.
- Automatische Migration installierter Electron-Apps.
- Leistungs-Baseline der Electron-App messen.
