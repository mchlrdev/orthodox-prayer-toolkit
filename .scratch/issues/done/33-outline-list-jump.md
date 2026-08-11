# 33 — Outline list, accordion, jump

**What to build:** Populate the Content sidebar from the session draft: live outline of `heading` / `subheading` Blocks (labels from the primary visible column; empty → muted Untitled). Nest subheadings under the preceding heading; orphan subheadings at root without a group rail; heading groups get a subtle left rail. Default all groups collapsed; header expand/collapse-all toggle and per-group chevrons control open state (session-only). Clicking an entry jumps via the shared reveal primitive (instant, under sticky header, flash on, no focus/caret) and does not toggle accordion. In overlay mode, Content closes after a successful jump. Pure outline-builder helper covered by unit tests.

**Blocked by:** 31 — Shared block reveal; 32 — Content sidebar shell + overlay sidebars

**Status:** done

- [x] Outline lists heading/subheading Blocks in order with correct nesting, orphan roots, Untitled, and live primary-column labels
- [x] Empty prayer shows muted **No heading**; no badges or insert CTAs
- [x] Accordion defaults collapsed; expand-all / collapse-all and chevrons work; row click does not expand/collapse
- [x] Clicking an entry jumps instantly with shared flash and without stealing focus; overlay Content closes after jump
- [x] Unit tests cover outline tree construction (nesting, orphans, empty labels)

**Completed:** Implemented with Content outline feature.
