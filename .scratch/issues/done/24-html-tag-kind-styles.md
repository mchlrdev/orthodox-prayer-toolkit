# 24 — `htmlTag` in Kind-Styles

**What to build:** Pro Kind-Style ein optionales HTML-Tag (App-Defaults + Library-Override) mit Allowlist; Builtin-Defaults `heading→h2`, `subheading→h3`, `verse→p`, `annotation→p`; in der Style-UI wählbar und speicherbar — Grundlage für die Export-Tag-Map.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Kind-Styles tragen optionales `htmlTag`; Validate/Sanitize akzeptieren nur die Allowlist
- [x] Default-Preset-Styles setzen die genannten Builtin-Tags; Unbekannte ohne Tag bleiben ohne (Export fällt später auf `div`)
- [x] Style-UI (App- und Library-Ziel) erlaubt Tag-Wahl; Persistenz wie bei den übrigen Style-Feldern
- [x] Resolved Styles liefern `htmlTag` dort, wo gesetzt (Library schlägt App)
