# 23 — Core `exportHtml`

**What to build:** Core-Funktion, die eine einzelne Sprache/Variante als semantisches HTML-Fragment exportiert (ohne Styles): Blöcke als Elemente mit `data-kind`, Zeilen mit `<br>`, Inline-Notes als `<span data-kind="annotation">`; optionale Wrapper mit Auto-Meta und User-Attributen.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Aufruf mit Prayer + `{ lang, variant }` + Tag-Map + Wrapper-Optionen liefert ein Fragment-String
- [x] Fehlende Übersetzung für die Variante → Block entfällt (wie Flat-Export)
- [x] Jedes Block-Element hat `data-kind`; kein Block-`id` im Markup; Text ist escaped
- [x] Unbekannter/fehlender Tag in der Map → `div`; Allowlist: `h1`–`h6`, `p`, `div`, `aside`, `section`, `blockquote`, `span`
- [x] Verse/`lines`: ein Element, Zeilen durch `<br>` getrennt; `text`-Kinds: Inhalt im Element
- [x] Inline-Runs `t:"note"` → `<span data-kind="annotation">…</span>`
- [x] Wrapper aus: nur Sibling-Elemente; Wrapper an: ein Root-Tag (Default-Semantik `article`), Auto-Meta (`lang`, `data-lang`, `data-variant`, `data-title`, `data-license`, `data-source`, `data-type`, optional `data-book` / `data-occasion` / `data-tone`), User-Attribute überschreiben Auto-Meta; kein `data-id`
- [x] Golden-Tests decken mindestens ein Gebet mit Heading, Verse+Note und Annotation ab
