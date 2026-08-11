> Kanonische Produkt-Doku dieses Repos. Früher unter Ortho Wiki `docs/04-prayer-framework.md`.

# Gebets-Framework → `orthodox-prayer-toolkit`

## Ziel

Ein **eigenständiges Open-Source-Toolkit** für liturgische Gebetstexte:

1. Gebete als **self-contained JSON** (eine Datei = ein Gebet),
2. **mehrere Übersetzungen** pro Gebet (Sprache **und** Variante innerhalb einer Sprache),
3. **Electron-App** (local-first): Library-Ordner öffnen, editieren, Varianten umschalten, speichern,
4. **Flat-Export** einer einzelnen Variante für beliebige Downstream-Nutzung,
5. später optionale Export-Plugins (HTML, Markdown, Affinity, …) — Architektur offen.

**Content ≠ Design:** Die JSON-Quelle enthält nur Semantik (`kind`, Struktur, Texte). Darstellung (Web, Druck, App-Vorschau) liegt außerhalb der Gebetsdatei.

Ortho Wiki ist der **übergeordnete Projektkontext** und später **Consumer** einer getrennten Gebets-Library. Das Toolkit bleibt **standalone** (eigene Packages, kein Zwang zu WordPress/Wiki-Code).

Verwandt, aber später / Produkt-Ortho-Wiki: [04b-affinity-bridge.md](04b-affinity-bridge.md).

---

## Produktentscheidungen (fest)

| Thema | Festlegung |
|-------|------------|
| Name | `orthodox-prayer-toolkit` |
| Quellformat | JSON, Schema-validiert |
| Markdown als Quelle | nein |
| Runtime MVP | **Core-Library + Electron-App** |
| CLI | nein (MVP) |
| Prod-Library im Toolkit | nein — nur Dev-Beispiele; Prod-Korpus getrennt (z. B. Ortho-Wiki-Library) |
| Speicherung | local-first: App öffnet einen Ordner; Dateien anlegen/lesen/schreiben/löschen |
| Datenbank | nein |
| Dateilayout | **flach:** `{id}.json`; Identität = `id` (Dateiname = `{id}.json`) |
| Taxonomie | Felder in der JSON (`book`, `occasion`, `type`, …), nicht der Ordnerpfad |
| Manifest | optional `manifest.json` am Library-Root: nur Sammlungs-Meta |
| Sprachen | pro Gebet in `variants[]` (Datei ist autark ohne Manifest) |
| Sync zwischen Varianten | kein Enforcement; fehlende Übersetzung = Eintrag fehlt |
| Styles | nicht in Gebets-JSON; App-Defaults + Library-Override |

### Tech-Stack (fest)

| Schicht | Festlegung |
|---------|------------|
| Sprache | **TypeScript** |
| Monorepo | **pnpm** workspaces |
| Core-Build / App-Dev | **Vite** |
| UI | **React** |
| Desktop | **Electron** |
| Komponenten | **Mantine** (`@mantine/core` + passende Mantine-Pakete für Forms/Hooks) — fertige Library, keine selbst gepflegte Lose-Komponenten-Sammlung |
| Tests (Core) | **Vitest** |

Nicht: shadcn/eigene Headless-Primitive-Farm; nicht WordPress/Convex als Toolkit-Stack.

---

## Architektur

```
orthodox-prayer-toolkit/          (eigenständiges Repo)
  packages/core/                  Schema, validate, exportVariant, indexKinds, resolveStyles
  packages/app/                   Electron + React + Mantine + Vite, dünn über Core
  examples/                       Mini-Library nur für Development
```

- **Core** ist die einzige Geschäftslogik-Naht (testbar ohne UI).
- **App** ist dünn: Ordner-I/O, Editor, Vorschau, Style-Panel (Mantine).
- **Ortho Wiki (Website)** lädt später eine **fremde** Library und rendert HTML — ohne Electron; nicht Teil dieses Toolkit-MVPs.

---

## Datenmodell

### Gebetsdatei (self-contained)

| Feld | Rolle |
|------|--------|
| `id` | Stabiler Slug; global eindeutig; Dateiname `{id}.json` |
| `title` | Kanonischer Arbeitstitel (**Englisch**) |
| `type` | Gattung (z. B. `prayer`, `troparion`, `kontakion`, …) — erweiterbar |
| `book` / `occasion` | Optionale Kategorie-Metadaten (Taxonomie ohne Ordner) |
| `tone` | Oktoich-Ton 1–8 oder null |
| `links` | z. B. `saint_id`, `feast_id` (sprachneutrale IDs) |
| `variants[]` | Registry: welche `(lang, variant)` es gibt + Anzeigetitel, Lizenz, Quelle |
| `structure[]` | Gemeinsames Gerüst (Modell A) |
| `meta` | z. B. `revised_at` |

### Variante

Objekt, nicht Slash-Key:

```json
{ "lang": "de", "variant": "standard", "title": "…", "license": "…", "source": "…" }
```

- `lang`: BCP-47 wo möglich (`de`, `en`, `el`, `cu`, …).
- Schrift/Edition (z. B. Kirchenslawisch kyrillisch vs. lateinische Transliteration): **eigene `variant`** unter derselben `lang` (z. B. `synodal-cyrl` / `synodal-latn`).
- Lizenz und Quelle **pro Variante** (Übersetzungsrechte).

### Structure (Modell A)

Ein gemeinsames Gerüst; Texte hängen an Blöcken:

| Block-Feld | Rolle |
|------------|--------|
| `id` | Stabil innerhalb des Gebets (Pflicht) |
| `kind` | **Offener String** (Semantik / Anzeigerolle) |
| `translations[]` | Einträge `{ lang, variant, …Payload }`; fehlende Variante = kein Eintrag |

Payload je nach `kind` (üblich):

- Fließ/`rubric`/`title`/`response`/`note`/`annotation`: `text`
- `verse`: `lines` (inhaltliche Zeilen, keine Layout-Zeilen)

**Empfohlene** Standard-`kind`s (Presets in der App, **nicht** Schema-Enum):  
`rubric` · `verse` · `prose` · `response` · `title` · `note`

### Beispiel (Skizze)

```json
{
  "id": "tropar-prokopios",
  "title": "Troparion of the Great Martyr Procopius",
  "type": "troparion",
  "book": "menaion",
  "tone": 4,
  "links": {
    "saint_id": "prokopios-von-caesarea",
    "feast_id": null
  },
  "variants": [
    {
      "lang": "de",
      "variant": "standard",
      "title": "Tropar des Großmärtyrers Prokopios",
      "license": "unknown",
      "source": "draft"
    },
    {
      "lang": "cu",
      "variant": "synodal-cyrl",
      "title": "Тропарь великомученику Прокопию",
      "license": "unknown",
      "source": "draft"
    }
  ],
  "structure": [
    {
      "id": "r1",
      "kind": "rubric",
      "translations": [
        { "lang": "de", "variant": "standard", "text": "Ton 4. Tropar des Großmärtyrers." }
      ]
    },
    {
      "id": "v1",
      "kind": "verse",
      "translations": [
        {
          "lang": "de",
          "variant": "standard",
          "lines": [
            "Dein Märtyrer Prokopius, Herr,",
            "hat in seinem Leidenskampf den Kranz der Unvergänglichkeit erworben …"
          ]
        }
      ]
    }
  ],
  "meta": {
    "revised_at": "2026-08-08"
  }
}
```

### Flat-Export (eine Variante)

Core exportiert eine abgeleitete Einzelvarianten-JSON (eine `structure` nur mit Text der gewählten Variante; Blöcke ohne Text für diese Variante entfallen). Verwendung (Web, Druck, Bridge) ist Sache des Consumers.

---

## Library-Ordner

```
my-prayer-library/
  manifest.json          # optional: name, description, version, defaultVariant
  .orthodox-prayer-toolkit/
    styles.json          # Library-Override für kind-Styles (siehe unten)
  trisagion.json
  tropar-prokopios.json
  …
```

- Rekursive Indexierung von `*.json`-Gebeten (Manifest/Styles ausgenommen).
- `manifest.json`: **nur** Sammlungsinfo — keine Sprachliste, keine Buchreihenfolge. Sprachen stehen in jeder Gebetsdatei.
- Gebetsdateien sind **ohne** Ordnerstruktur und ohne Manifest gültig ladbar.

---

## Electron-App

### MVP

- Library-Ordner öffnen
- Baum / Liste der Gebete; anlegen, öffnen, speichern, löschen
- Varianten anlegen / umschalten; Anzeigetitel & Meta pro Variante
- Blöcke: `kind` setzen; **neue `kind`s nur in der Block-Konfiguration** (Dropdown = Presets ∪ Kinds dieses Gebets)
- Rename eines `kind`s nur innerhalb des aktuellen Gebets
- Validierung gegen Schema (Core)
- Export: Single-Variant Flat-JSON
- Vorschau mit kind-Styles

### Anzeige-Styles (persistent)

| Regel | Festlegung |
|-------|------------|
| Was | pro `kind`: `fontSize`, `color`, `fontWeight`, `fontStyle` — Map später erweiterbar |
| Wo | App-Defaults **plus** Library-Override (C); Library gewinnt |
| Entdeckung | Beim Öffnen der Library: Union aller `kind`s → unbekannte bekommen Default-Preset → im Style-Panel app-/library-weit editierbar |
| Nicht in | Gebets-JSON |

---

## Was nicht in die Gebetsquelle gehört

- Schriftarten, Farben, Gewichte (außer als App/Library-Styles neben der Sammlung)
- HTML-Layouts, CMS-Felder, Website-Navigation
- Affinity-Rahmenpositionen

Erlaubt: semantische Flags später (z. B. `role`) — keine Pixel in der Prayer-JSON.

---

## Qualitätsregeln

1. Eine Datei = eine logische Einheit; self-contained.
2. `id` / Dateiname global eindeutig.
3. Jeder Block hat stabile `id`; `kind` ist freier String.
4. `verse.lines` = inhaltliche Zeilen, keine Layout-Zeilen.
5. Rubriken vom Gebetstext getrennt (`kind`).
6. Keine leeren Übersetzungs-Keys — fehlend = weglassen.
7. Lizenz + Quelle pro Variante; unklar → `draft` / `unknown`.

---

## Verbindung Ortho Wiki / Kalender

- Tagesansicht (Wiki) verknüpft über `links.saint_id` / `feast_id` — kein Copy-Paste in den Kalender.
- Wiki **owned** nicht das Toolkit; es konsumiert später eine Library + eigenen Renderer.
- Ältere DE-only-Skizzen (`title_de`, `language: "de"` const unter `content/_schemas/`) sind **Vorgänger**; kanonisch ist dieses Dokument + Toolkit-Schema.

---

## Out of Scope (dieses Framework-MVP)

- CLI
- Affinity/InDesign/HTML-Export-Plugins (Architektur offenlassen)
- Wiki-Build-Pipeline / Submodule-Wiring
- Cloud-Sync, Multi-User-Server, Datenbank
- Striktes Structure-Sync zwischen Varianten
- Browser-only File-System (ohne Electron)

---

## Umsetzungsplan (Tickets)

Parent-Spec: `.scratch/spec.md`  
Ticket-Dateien: `.scratch/issues/` (offen) · `issues/done/` (01–21 erledigt)  
Status-Regeln: `docs/agents/issue-tracker.md`  
MVP-Tickets **01–21** sind **done** und liegen unter `issues/done/` — nicht erneut umsetzen.

| # | Ticket | Blocked by | Liefert |
|---|--------|------------|---------|
| 01 | Standalone-Toolkit-Scaffold | — | Eigenständiger Package-Tree; Electron-Stub; Core importierbar |
| 02 | Prayer-Schema + Validate in Core | 01 | Schema Modell A; `validate`; Core-Tests |
| 03 | Beispielgebet in Dev-Library | 02 | Gültiges Beispiel (2. Variante teilweise) |
| 04 | Electron: Ordner öffnen + Gebete listen | 01 | Library-Ordner → Liste der Gebets-`id`s |
| 05 | Gebet öffnen + Validierungsstatus UI | 02, 04 | Read-only Öffnen + gültig/Fehler |
| 06 | Identität speichern | 05 | `id`/`title`/`type`/… speichern; id↔Datei-Regel |
| 07 | Varianten-Registry editieren | 06 | Varianten-Meta anlegen/ändern |
| 08 | Structure-Blöcke: Gerüst editieren | 06 | Blöcke + `kind`-Dropdown (Presets ∪ Gebet) |
| 09 | Block-Übersetzungen editieren | 07, 08 | `text`/`lines` je aktiver Variante; keine leeren Keys |
| 10 | Aktive Variante umschalten | 09 | Editor folgt gewählter Variante |
| 11 | Neue Variante anlegen (leer) | 10 | Registry + Lücken, keine Auto-Empty-Keys |
| 12 | `kind` umbenennen (nur aktuelles Gebet) | 08 | Rename aller betroffenen Blöcke in der Datei |
| 13 | Vorschau mit Default-Kind-Styles | 10 | Gestylte Lesvorschau (noch ohne Library-Override) |
| 14 | Flat-Export in Core | 02, 09 | `exportVariant` + Golden-Tests |
| 15 | Flat-Export aus der App | 14, 10 | UI-Export über Core |
| 16 | Kinds der Library indexieren | 04, 02 | Union aller `kind`s beim Open |
| 17 | Style-Panel + App-Defaults persistent | 13, 16 | Styles editieren; App-Persistenz |
| 18 | Library-Style-Override | 17 | Library > App; Defaults für neue Kinds |
| 19 | Gebet löschen | 04, 06 | Datei weg; Liste aktualisiert |
| 20 | Doppelte `id` erkennen | 04, 02 | Kollisionsmeldung, kein stilles Überschreiben |
| 21 | Optionales Manifest lesen | 04 | Sammlungs-Meta anzeigen; Gebete bleiben autark |
