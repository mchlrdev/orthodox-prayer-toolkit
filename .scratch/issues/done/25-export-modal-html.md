# 25 — Export-Modal: HTML end-to-end

**What to build:** Im Export-Dialog Format „HTML“ wählen; Sprache/Variante wie bisher; bei HTML Wrapper an/aus, Wrapper-Tag, Attribute-Input (live validiert) und Kind→Tag-Map (vorausgefüllt aus resolved Styles); Export schreibt `{id}.{lang}.{variant}.html` über Core `exportHtml`.

**Blocked by:** 23 — Core `exportHtml`; 24 — `htmlTag` in Kind-Styles

**Status:** done

- [x] Format-Auswahl: Flat JSON | HTML; HTML-Einstellungen nur sichtbar bei HTML
- [x] Kind→Tag-Map startet aus resolved Library/App-Styles; Nutzer kann Tags für den Export ändern (Allowlist)
- [x] Wrapper: Default-Tag `article` wenn eingeschaltet; Attribute-String wird live validiert (`on*` / `style` verworfen); Export nur bei gültigen Inputs
- [x] Speichern liefert HTML, das Core `exportHtml` entspricht; Dateiname `{id}.{lang}.{variant}.html`
- [x] Flat-JSON-Pfad bleibt unverändert nutzbar
