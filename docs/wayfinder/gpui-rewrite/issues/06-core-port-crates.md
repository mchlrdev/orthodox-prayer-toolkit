Type: research
Status: resolved

## Question

Welche Rust-Crates tragen den Core-Port? Konkret: JSON-Schema-Validierung nach Draft 2020-12 mit Fehlermeldungen vergleichbar zu Ajv (z. B. `jsonschema`), DOCX schreiben (z. B. `docx-rs`) mit dem, was `exportLayoutDocx.ts` nutzt, RTF (vermutlich von Hand wie heute), HTML-Ausgabe. Pro Crate: Reife, Lizenz, Lücken gegenüber dem TS-Core, mit Quellen.

## Answer

Abhängigkeiten für `prayer-core`: `serde_json`, `jsonschema` 0.58 (Draft 2020-12, alle Keywords des Schemas, Fehlerpfade als JSON-Pointer wie Ajv; das Schema nutzt kein `format`), `docx-rs` 0.4 (deckt alles ab, was `exportLayoutDocx.ts` nutzt: benannte Absatz- und Zeichenstile, Runs, weiche Umbrüche, ein Abschnitt) und `regex`. RTF und HTML werden von Hand geschrieben wie im TS-Core. Beide 0.x-Crates exakt pinnen. Größtes Paritätsrisiko: Fehlermeldungen und die Verschachtelung von `oneOf`/`anyOf`-Fehlern weichen von Ajv ab und müssen gemappt werden; DOCX wird nicht byte-gleich. Beides gehört in Ticket 07. Details und Quellen: [research/06-core-port-crates.md](../research/06-core-port-crates.md).
