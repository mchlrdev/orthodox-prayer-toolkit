Type: research
Status: resolved

## Question

Wie verhält sich der heutige Inline-Editor genau? Aus `packages/app/src/components/InlineEditor.tsx`, `inlineDom.ts`, `prayerEdit/` und den Tests: alle Interaktionen (Tippen, Enter, Backspace an Grenzen, Einfügen von formatiertem Text, Tastenkürzel, Kind-Wechsel, Aufteilen/Zusammenführen von Blocks, Undo), Randfälle und Datenfluss in den Session draft. Ergebnis: Verhaltensbeschreibung als Maßstab für den Prototyp.

## Answer

Ein `contenteditable` pro Zelle (Block × Variant); Cursor, Auswahl, IME, Undo und Kopieren kommen heute vom Browser. Die App fängt nur Enter (Block an der Cursorposition teilen, nur in der aktiven Variant, neuer Block mit gleichem Kind), Shift+Enter (Zeilenumbruch), Backspace in leerer Zelle (Block löschen, nur wenn alle Variants leer sind), Einfügen (nur Plain Text) und Cmd/Ctrl+Shift+M (Notiz umschalten) ab. Übernahme in den Session draft beim Verlassen der Zelle, beim Teilen und beim Notiz-Umschalten, für Überschriften in der ersten Spalte bei jedem Tastendruck. Es gibt kein App-Undo, nur das Browser-Undo pro Zelle; strukturelle Änderungen lassen sich nur durch Verwerfen des Session drafts rückgängig machen. Kein Zusammenführen von Blocks, keine Cursor-Bewegung zwischen Blocks, kein Cmd/Ctrl+S.

Für den Rewrite heißt das: Was der Browser gratis lieferte, muss das eigene Editier-Element können, mindestens Undo pro Zelle. Vermuteter Bug in der Electron-App: `skipBlurCommitRef` wird vor Backspace/Enter gesetzt und bei frühem Abbruch nicht zurückgesetzt (`InlineEditor.tsx:546`, `:566`). Details, Interaktionstabelle und offene Fragen: [research/03-current-editor-behaviour.md](../research/03-current-editor-behaviour.md).
