# 32 — Content sidebar shell + overlay sidebars

**What to build:** Add a right-hand Content sidebar shell, visually symmetric with the Library (same height, 280px width token, edge collapse). Persist open/closed for **both** Library and Content in localStorage. Below 1100px viewport width, open sidebars overlay the workspace with a dimmed backdrop, are mutually exclusive, and close on backdrop click. Header shows **Content** (outline body can be a placeholder / empty “No heading” until ticket 33). No Action-bar button.

**Blocked by:** None — can start immediately

**Status:** done

- [x] Content sidebar mirrors Library edge-collapse and sizing; both can sit in layout flow at ≥1100px
- [x] Library and Content open/closed prefs survive reload via localStorage
- [x] Below 1100px: overlay + dim; opening one closes the other; backdrop click closes the open overlay
- [x] Content header title is **Content**; empty body shows muted **No heading** (or equivalent empty chrome) until outline lands
- [x] No outline jump / accordion behavior required yet

**Completed:** Implemented with Content outline feature.
