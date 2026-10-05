Type: research
Status: resolved

## Question

Was kann die Electron-App heute alles? Vollständige Liste aller Funktionen, Dialoge, Menüpunkte, Tastenkürzel, Einstellungen sowie Speicher- und Warnabläufe (ungespeicherte Änderungen, ungültige Gebete, Id-Kollisionen), gegliedert nach Bereich. Quelle ist der Code unter `packages/app` und `docs/`. Ergebnis: die Paritäts-Checkliste, die vor der Umstellung abgehakt sein muss.

## Answer

Die Checkliste hat 268 Punkte in 20 Bereichen: [research/04-parity-checklist.md](../research/04-parity-checklist.md). Sie ist der Maßstab für die Umstellung.

Auffällig und für spätere Tickets wichtig, von mir im Code nachgeprüft: Die App-weiten Kind-Styles (`userData/kind-styles.json`) werden gelesen und gespeichert, aber beim Darstellen nie verwendet. `resolveStyles` wird ohne `appDefaults` aufgerufen (`packages/app/src/usePrayerSession.ts:221`), wirksam sind nur die Styles der Library (`<library>/.orthodox-prayer-toolkit/styles.json`). Weitere Funde laut Checkliste: kein Speichern-Kürzel, Validierungsfehler werden beim Editieren nicht angezeigt, beim Wechsel des Gebets keine Nachfrage zu ungespeicherten Änderungen, „Install and Restart“ übergeht die Nachfrage, unter Windows/Linux keine Menüleiste.
