Type: task
Status: resolved

## Question

Funktioniert das Selbst-Update auf echten Geräten? Beta installieren, nächstes `gpui-v*`-Tag setzen, prüfen dass die App das Update findet, lädt und nach Neustart die neue Version zeigt, auf macOS (ad-hoc signiert), Windows und Linux. Mark macht die Installation, der Agent bereitet die Releases vor. Entscheidet: bleibt es bei Velopack.

## Answer

Funktioniert (Mark, 5. Okt. 2026): beta.2 von der Release-Seite installiert, beta.3 getaggt, in der laufenden App geprüft, geladen, installiert und neu gestartet auf beta.3. Getestet auf Marks Rechner. Velopack bleibt der Updater.

Erledigt dafür: `gpui-release.yml` repariert (.NET 10 für `vpk` auf macOS, Upload unter Windows in bash, gültige Probelauf-Version), `vpk` und `velopack`-Crate auf 1.2.161 gepinnt, Paketbau ohne Upload bei PRs, die den Workflow ändern.

Offen für die Parität: Die Beta lädt Updates erst auf Klick, die Electron-App lädt im Hintergrund. Der macOS-Build ist nur für Apple Silicon. Es werden keine Delta-Pakete erzeugt.
