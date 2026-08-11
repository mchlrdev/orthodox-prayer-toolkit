# Spec: Editor Content outline (TOC sidebar)

**Status:** ready-for-agent

Parent: `.scratch/orthodox-prayer-toolkit/spec.md` (MVP done)  
Tickets: `issues/31`–`issues/34`

### Tickets (frontier)

| # | Title | Blocked by |
|---|--------|------------|
| 31 | Shared block reveal | — |
| 32 | Content sidebar shell + overlay sidebars | — |
| 33 | Outline list, accordion, jump | 31, 32 |
| 34 | Scrollspy active section | 33 |

Work 31 and 32 in parallel; then 33; then 34.

## Problem Statement

When editing a long Prayer, the editor cannot jump between sections. Headings and subheadings exist as Blocks in `structure`, but there is no outline navigation, no sense of “where am I,” and the only related jump (fill-percent → next empty Block) is tightly coupled to focus/caret behavior that a TOC should not reuse as-is.

## Solution

Add a right-hand **Content** sidebar, visually symmetric with the Library sidebar, that shows a live outline of `heading` and `subheading` Blocks. The user toggles it from the edge (like the Library), expands/collapses groups, clicks an entry to jump to that Block with the same flash affordance as the fill-percent jump (but instant scroll and no cursor), and sees which heading section currently sits at the top of the editor scrollport. On narrow viewports both sidebars become mutually exclusive dimmed overlays.

## User Stories

1. As an editor, I want a right-hand Content sidebar beside the prayer workspace, so that I can navigate long prayers without scrolling blindly.
2. As an editor, I want the Content sidebar the same width and height as the Library sidebar, so that the shell feels symmetric.
3. As an editor, I want an edge collapse control on the Content sidebar like the Library, so that I can reclaim editor width with one familiar gesture.
4. As an editor, I want my Content sidebar open/closed preference remembered in localStorage across reloads, so that I do not re-open it every session.
5. As an editor, I want the Library sidebar open/closed preference also remembered in localStorage, so that both sidebars behave consistently.
6. As an editor, when the viewport is at least 1100px wide, I want both sidebars able to sit in the layout flow together, so that outline and library remain visible while editing.
7. As an editor, when the viewport is under 1100px, I want an open sidebar to overlay the workspace instead of crushing the editor, so that the prayer text stays usable.
8. As an editor, when overlay mode is active, I want a dimmed backdrop, so that it is clear the sidebar is temporary chrome.
9. As an editor, when overlay mode is active, I want opening one sidebar to close the other, so that only one overlay competes for attention.
10. As an editor, when I click the dimmed backdrop, I want the open overlay sidebar to close, so that I can return to the prayer quickly.
11. As an editor, after I click a Content outline entry while the Content sidebar is in overlay mode, I want that overlay to close, so that I land on the target Block with full editor width.
12. As an editor, I want the Content sidebar header titled **Content**, so that the panel’s purpose is obvious.
13. As an editor, I want a single toggle in the Content header that expands all outline groups or collapses all of them, so that I can switch between overview and compact modes.
14. As an editor, I want each heading group to have its own chevron, so that I can open only the sections I care about.
15. As an editor, I want outline groups collapsed by default when the Content sidebar session starts, so that the list stays compact until I expand it.
16. As an editor, I want expand/collapse choices (including expand-all / collapse-all) to last only for the current session, so that stale open state does not linger after reload when structure changes.
17. As an editor, when I click an outline entry, I do **not** want that click to expand or collapse its group, so that navigation and accordion control stay separate.
18. As an editor, I want outline entries for every `heading` and `subheading` Block in document order, so that the outline mirrors the prayer skeleton.
19. As an editor, I want each `subheading` nested under the nearest preceding `heading`, so that structure relationships are visible.
20. As an editor, I want orphan `subheading`s (before any `heading`) listed at root with subheading typography and no group rail, so that preamble sections are honest and not fake-parented.
21. As an editor, I want a subtle left rail linking a heading to its nested subheadings, so that group membership is visible without heavy cards or borders.
22. As an editor, I want outline labels taken from the primary (first visible) translation column, so that the outline stays stable while I edit other columns.
23. As an editor, I want outline labels to update as I type in that primary column, so that the outline stays truthful while drafting.
24. As an editor, when a heading/subheading has no text yet, I want the outline to show muted **Untitled**, so that empty Blocks remain jump targets.
25. As an editor, when a prayer has no heading or subheading Blocks, I want muted **No heading** in the Content sidebar, so that emptiness is explained without badges or CTAs.
26. As an editor, when I click an outline entry, I want the editor to jump instantly so that Block’s top sits under the sticky workspace header, so that navigation feels precise.
27. As an editor, when I jump via the outline, I do **not** want the caret or focus moved into the Block, so that reading/navigation does not steal typing context unexpectedly.
28. As an editor, when I jump via the outline, I want the same jump-target flash used by the fill-percent control, so that feedback is consistent.
29. As an editor, when I click the fill-percent control, I still want smooth centered scroll, focus, and caret-at-end, so that “next empty Block” remains an editing affordance.
30. As a toolkit maintainer, I want fill-percent jump and outline jump to share one reveal primitive (scroll / focus / flash options), so that flash styling and timing do not diverge.
31. As an editor, while I scroll the workspace body, I want the Content outline to mark the current **heading** section (last heading whose top is at or above the scrollport top, accounting for sticky header offset), so that I always know where I am.
32. As an editor, I do **not** want nested subheadings marked active (except orphan root subheadings), so that active state stays at section level.
33. As an editor, when scrollspy lands in an orphan subheading region, I want that orphan subheading marked active, so that preamble sections are not a blind spot.
34. As an editor, when no outline entry qualifies as active, I want no active highlight, so that the UI does not lie.
35. As an editor, I do **not** want scrollspy to auto-expand accordion groups, so that collapse-all and manual chevrons remain authoritative.
36. As an editor, I want no new Action-bar Content button, so that chrome stays limited to the edge toggle pattern.
37. As a toolkit maintainer, I want pure outline-building and active-resolution helpers covered by unit tests, so that hierarchy and scrollspy rules do not regress.
38. As a toolkit maintainer, I want existing fill-percent jump behavior preserved after the reveal prefactor, so that translators do not lose their workflow.

## Implementation Decisions

### Seams

- **Primary:** App pure helpers for (1) building the Content outline tree from a Prayer’s `structure` plus the primary visible variant’s text, and (2) resolving the active outline id from scroll metrics + heading geometry. Prefer these over React-tree tests. Prior art: `prayerEdit/` helpers and `packages/app/tests/prayerEdit.test.ts`.
- **Secondary:** Editor reveal primitive extracted from today’s focus/jump path — options for scroll behavior, whether to focus/place caret, and whether to set the existing jump-target flash. Fill-percent and Content jump are call sites only.
- **Tertiary:** App shell layout for Library + Content sidebars (flow vs overlay, persistence, mutual exclusivity). Keep business rules out of CSS-only hacks where possible; breakpoint **1100px**, width shared via existing sidebar width token (**280px**).

### Outline model

- Include only Blocks whose `kind` is `heading` or `subheading` (preset kinds).
- Nest each `subheading` under the nearest preceding `heading`; orphan `subheading`s are root entries.
- Label = plain text from the primary visible translation column for that Block; empty → muted `Untitled`.
- Live: outline derives from current session draft structure/translations (no separate TOC document).

### Content sidebar UX

- Title: **Content**.
- Default accordion: all groups collapsed; session-only open state; expand-all / collapse-all header toggle overrides prior expand/collapse.
- Per-group chevron toggles that group only.
- Outline row click: navigate only (does not toggle expand).
- Visual: left rail for heading→children groups; orphan subs without rail; no badges/count chips.
- Empty: muted **No heading**.

### Jump / flash

- Reuse `data-jump-target` flash (~900ms clear) already used by fill-percent jump.
- Content jump: `behavior: "auto"` (instant), align Block top under sticky header offset, **no** focus/caret.
- Fill-percent jump: keep smooth + center + focus + caret-at-end + same flash.
- One shared reveal entry point with explicit options so the two call sites cannot accidentally share the wrong defaults.

### Scrollspy

- Scroll container: workspace body.
- Active = last `heading` whose top ≤ scrollport top + sticky-header offset; if the geometric hit is an orphan root `subheading`, that subheading may be active; nested subheadings never active.
- Scrollspy never opens accordion groups.
- No active mark when nothing qualifies.

### Shell / persistence

- Content sidebar mirrors Library edge-collapse affordance.
- Persist Content open/closed and Library open/closed in localStorage (global app prefs, not per-prayer).
- Below 1100px: overlay + dim; only one sidebar open; backdrop click closes; Content overlay closes after outline jump.
- At/above 1100px: both may be open in flow; outline jump does not force-close Content.

### Non-goals baked into decisions

- No Action-bar nav button / popover TOC.
- No outline entries for `verse`, `annotation`, or custom kinds unless they are literally `heading`/`subheading`.
- No insert-heading CTA from the empty state.
- No per-prayer accordion persistence.

## Testing Decisions

- Good tests assert **external behavior** of helpers (outline tree shape, labels, orphan nesting, active id for given metrics) — not React internals, DOM query soup, or CSS class names as the contract.
- **Modules under test:** outline builder + active resolver (primary); reveal option wiring can be covered lightly if extracted as a pure “choose scroll/focus flags” helper, otherwise rely on manual/demo verification for the DOM flash.
- **Prior art:** `packages/app/tests/prayerEdit.test.ts` style — small fixtures, assert returned structures; Core package tests only if outline logic is deliberately placed in Core (default: keep in App unless reuse across packages appears).
- Preserve fill-percent jump semantics in any regression checks or manual acceptance on ticket 31.

## Out of Scope

- Exporting TOC / outline into HTML, Flat JSON, or Layout exports.
- Outline editing (reorder/rename Blocks from the sidebar).
- Search/filter inside Content.
- Keyboard outline navigation beyond basic clickability/accessibility of controls.
- Remembering accordion expand state across reloads or per prayer.
- Marking nested subheadings as scrollspy-active.
- Mobile-specific redesign beyond the 1100px overlay rules.
- Changing Kind presets or prayer schema.

## Further Notes

- Domain vocabulary: **Library**, **Session draft**, **Block**, `structure`, `kind` (`heading` / `subheading`), visible translation columns / primary column — see `orthodox-prayer-toolkit/CONTEXT.md`.
- Existing jump path lives in the inline editor (`jumpTargetId` + `data-jump-target`); Content must not invent a second flash system.
- Library sidebar collapse is currently React state only; this feature intentionally upgrades **both** sidebars to persisted prefs for symmetry.
