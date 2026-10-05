Type: research
Status: resolved

## Question

Wo genau legt die Electron-App ihre Kind-Styles ab (`kind-styles.json` unter `userData`) auf macOS, Windows und Linux, abgeleitet aus `productName` und Electron-Konventionen, und welches Format hat die Datei? Ergebnis: Pfade und Format, damit die neue App sie beim ersten Start übernehmen kann.

## Answer

`kind-styles.json` liegt unter dem Electron-`userData`-Ordner „Orthodox Prayer Toolkit“: macOS `~/Library/Application Support/Orthodox Prayer Toolkit/`, Windows `%APPDATA%\Orthodox Prayer Toolkit\`, Linux `$XDG_CONFIG_HOME` bzw. `~/.config/Orthodox Prayer Toolkit/`. Format: flaches JSON-Objekt Kind-Id → String-Felder (`fontSize`, `color`, `fontWeight`, `fontStyle`, `initialCap`, `indicate`, `htmlTag`, `textAlign`), teilweise, über Standard-Kinds gemergt, ungültige Einträge werden still verworfen. Die neue App liest die Datei beim ersten Start von dort und validiert sie wie der Core. Die übrigen Einstellungen liegen nur im localStorage und werden nicht übernommen. Details und Quellen: [research/10-electron-settings-location.md](../research/10-electron-settings-location.md).

**Korrektur nach Ticket 04:** Diese Datei bestimmt die Darstellung nicht. `resolveStyles` bekommt keine `appDefaults` (`packages/app/src/usePrayerSession.ts:221`); wirksam sind nur die Library-Styles, und die wandern mit der Library mit. Die Übernahme dieser Datei bringt deshalb nichts Sichtbares.
