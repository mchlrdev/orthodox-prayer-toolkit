# 34 — Scrollspy active section

**What to build:** While the workspace body scrolls, mark the active Content outline entry: the last heading whose top is at or above the scrollport top (sticky header offset included). Nested subheadings are never active; orphan root subheadings may be active when scrollspy lands on them. No active mark when nothing qualifies. Scrollspy must not auto-expand accordion groups. Pure active-resolution helper covered by unit tests where metrics can be fed in.

**Blocked by:** 33 — Outline list, accordion, jump

**Status:** done

- [x] Scrolling the editor updates the active heading according to the top-edge scrollspy rule + header offset
- [x] Nested subheadings are never active; orphan root subheadings can be active; no false active when none qualify
- [x] Scrollspy does not open collapsed outline groups
- [x] Unit tests cover active id resolution for representative metric fixtures

**Completed:** Implemented with Content outline feature.
