Type: grilling
Status: resolved
Blocked by: 06

## Question

Wie genau muss der Rust-Core dem TS-Core entsprechen (byte-gleich, inhaltlich gleich, nur gleich valide), wie werden die gemeinsamen Fixtures genutzt, und wie fällt Abweichung auf, solange beide Cores existieren?

## Answer

Mark, 5. Okt. 2026:

- **Gleiche Ergebnisse, neuer Code.** Gültig/ungültig identisch, Fehlermeldungen zeigen auf dieselbe Stelle (Wortlaut darf abweichen), Flat-JSON-, HTML- und RTF-Export byte-gleich, DOCX inhaltlich und in der Formatierung gleich. Funktion und Bedienung bleiben gleich, aber der TS-Code wird **nicht** Zeile für Zeile übersetzt: Aufbau und Typen werden für Rust neu durchdacht (idiomatisches Rust), solange das Ergebnis gleich ist.
- **Der TS-Core fällt weg**, sobald die Rust-App alles kann (`packages/` komplett). Bis dahin dient er als Referenz: Ein Vergleichsjob lässt beide Cores über die gemeinsamen Fixtures laufen. Vor dem Entfernen werden die erwarteten Ergebnisse als Golden-Dateien in die Rust-Tests übernommen.
- Bei Abweichungen gelten Schema und Docs („Schema is law“), nicht einer der Cores.

