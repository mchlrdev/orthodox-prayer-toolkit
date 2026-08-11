# 31 — Shared block reveal

**What to build:** Extract one reveal primitive from today’s fill-percent / focus jump so callers can choose scroll behavior, whether to focus and place the caret, and whether to flash the Block. The fill-percent “next empty” control must keep smooth centered scroll, focus, caret-at-end, and the existing jump-target flash. Content outline (later tickets) will call the same primitive with instant scroll, header-aligned start, flash on, focus off.

**Blocked by:** None — can start immediately

**Status:** done

- [x] Fill-percent jump still scrolls smoothly to center, focuses the editable, places the caret, and shows the same jump-target flash timing/look as before
- [x] Reveal accepts explicit options for scroll behavior, focus/caret, and flash (no hidden coupling that forces focus whenever flashing)
- [x] Add-block / insert-after / other existing focus paths either use the primitive correctly or remain behaviorally unchanged
- [x] No Content sidebar UI in this ticket

**Completed:** Implemented with Content outline feature.
