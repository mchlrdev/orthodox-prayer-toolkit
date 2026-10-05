# Karte: GPUI-Rewrite

Wayfinder-Karte für den Umbau der Electron-App auf Rust + GPUI. Tickets liegen unter [`issues/`](issues/), Recherche-Ergebnisse unter [`research/`](research/). Diese Karte ersetzt das frühere Plan-Dokument (eingefroren).

## Destination

Die GPUI-App ersetzt die Electron-App auf `main`: alle Funktionen und UX-Abläufe gleich oder besser, Auto-Update aus GitHub-Releases auf macOS, Windows und Linux, `packages/app` entfernt.

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

## Not yet specified

- **Export-Abläufe in der neuen UI** (Export-Dialog, Vorschau, Dateiauswahl): hängt an Core-Port und App-Architektur.
- **Find & Replace im neuen Editor**: hängt an der Editor-Entscheidung; Hervorhebungen und Ersetzen über mehrere Blocks.
- **Gebetsliste und Katalog bei großen Libraries**: virtuelle Liste, Einlesen im Hintergrund; vermutlich unkritisch, wird nach der Architektur klar.
- **Umstellung selbst**: Reihenfolge von Merge, Entfernen von `packages/app`, App-Name/Bundle-ID/Update-Kanal von Beta auf stabil; Signierung dann neu bewerten.
- **UI-Tests**: wie viel über `gpui-kit`-Test-Support (headless Fenster, Snapshots) abgesichert wird.

## Out of scope

- Library-Leser / HTML-Rendering für Ortho Wiki, Rust-Core als WASM (Mark, 5. Okt.).
- Browser-Modus (`pnpm dev` im Browser) entfällt.
- Mehrsprachige Oberfläche.
- Automatische Migration installierter Electron-Apps.
- Leistungs-Baseline der Electron-App messen.
