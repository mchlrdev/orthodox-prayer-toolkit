# Spec: HTML export (Prayer Toolkit)

Status: done

Parent: `.scratch/orthodox-prayer-toolkit/spec.md` (MVP done)  
Tickets: `issues/done/22`–`issues/done/26`

## Problem Statement

Editors can already export a single language as Flat JSON. They also need a semantic, style-free HTML fragment for reuse in other sites and tools, with control over element tags and an optional wrapper — without putting HTML into prayer JSON files.

## Solution

Add Core `exportHtml` plus Export-modal HTML mode: kind→tag from styles (overridable per export), optional wrapper with validated attributes, prefs stored per prayer in local storage. Remove unused `print` from the data model.

## Tickets (frontier)

| # | Title | Blocked by |
|---|--------|------------|
| 22 | Remove `print` | — |
| 23 | Core `exportHtml` | — |
| 24 | `htmlTag` in kind styles | — |
| 25 | Export modal HTML | 23, 24 |
| 26 | Per-prayer export prefs | 25 |

Work any of 22 / 23 / 24 next; then 25; then 26.

## Decisions (grilling)

- Fragment of sibling elements; optional wrapper (default `article`)
- Always `data-kind`; inline notes = `<span data-kind="annotation">`; lines = `<br>` inside one element
- Allowlist: `h1`–`h6`, `p`, `div`, `aside`, `section`, `blockquote`, `span`; else `div`
- Style defaults: heading `h2`, subheading `h3`, verse/annotation `p`
- No HTML tags in prayer JSON; export map overrides styles for that export only
- Prefs per prayer (local); reset restores kind→tag map only
- Wrapper auto-meta: `lang`, `data-lang/variant/title/license/source/type`, optional book/occasion/tone; user attrs override; no `data-id`; no block ids in HTML
- Filename `{id}.{lang}.{variant}.html`
- Drop `print` entirely

## Out of Scope

- Full HTML documents (`<!DOCTYPE>`)
- CSS / inline styles in export
- Markdown / Affinity exporters
- Removing block `id` from the prayer data model
- Prayer-level kind→tag stored in prayer JSON
