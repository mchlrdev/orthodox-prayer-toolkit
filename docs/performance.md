# Performance

Audit of the app and especially the editor with a large prayer, the root causes found, and what was changed. Measured on 2026-11-02 in Electron 35 (macOS, 120 Hz display) via the Chrome DevTools Protocol (CPU profiles, traces with invalidation tracking, Event Timing, render counters).

## Test prayer

`packages/app/tests/fixtures/perf/lorem-300.json`: bilingual (de / en), 300 Blocks, all four preset kinds plus a custom `refrain` kind with speakers, inline notes, initial caps, and a few untranslated en cells. Two visible columns = 600 editable cells. Regenerate (deterministic) with:

```bash
node scripts/perf-fixture.mjs [outDir] [blockCount]
```

## Results

Median in ms from the action to the next painted frame. The measurement waits two frames, so ~16 ms is the floor. Both columns are unminified production builds of the same code before and after the changes.

| Scenario | Before | After |
|----------|-------:|------:|
| Open the prayer (from another prayer) | 249 | 90 |
| Commit after typing (idle commit / flush) | 62 | 17 |
| Enter: split a Block | 76 | 26 |
| Backspace: merge two Blocks | 68 | 15 |
| Undo / redo | 48 / 43 | 17 / 23 |
| Move a Block (context menu) | 39 | 12 |
| Change a Block's kind (context menu) | 58 | 26 |
| Add / remove a column | 176 / 68 | 80 / 57 |
| Keystroke latency (Event Timing, p50 / max) | 16 / 64 | 16 / 32 |
| Hover over 30 Blocks, scroll through the prayer | frame-bound | frame-bound |
| Find & replace, per query character | 10–17 | 10–17 |

What the editor does per edit:

| Per commit | Before | After |
|------------|-------:|------:|
| `BlockRow` renders | 300 (+300 after validation) | 1 (0 after validation) |
| `EditableBlock` renders | 1200 (+600) | 1 (0) |
| Full-document style recalcs | 2 × ~5700 elements, ~20 ms each | 0 |
| Forced layouts while opening | ~1180 (178 ms) | 5 (21 ms) |

Startup was not a bottleneck: ~24 ms module evaluation and ~12 ms first render. First contentful paint (~220 ms) is mostly Electron window start-up.

## Root causes and fixes

1. **Color scheme effect on every render** (`App.tsx`). `useMantineColorScheme()` returns a new `setColorScheme` each render, and the appearance effect listed it as a dependency, so the effect ran after every App render, which means every edit. Each call injects Mantine's `* { transition: none !important }` stylesheet and removes it 10 ms later: two style recalcs of the whole document, plus localStorage writes. Fix: call it through a ref; the effect runs only when the preference changes.
2. **`isDomEmpty` read `innerText`** (`InlineEditor.tsx`). `innerText` forces a synchronous layout. While a prayer opens, each of the 600 cells writes its DOM and then reads `innerText`, so the browser laid out the page once per cell. Every keystroke paid one forced layout too. Fix: read `textContent`. Cells hold only text nodes and inline spans (no hidden content), so the result is the same.
3. **Double paint on mount.** `EditableBlock` painted its content in a layout effect and again, with identical content, in the first run of its sync effect. Fix: the sync effect skips its first run.
4. **Unstable kind styles** (`usePrayerSession.ts`). `libraryKinds` was rebuilt from `state.drafts` on every edit, which made `resolvedStyles`, and with it every cell's style object, new each time. That defeated the `BlockRow` / `EditableBlock` memoization entirely. Fix: keep the previous array while the kinds are equal.
5. **Style objects keyed by the structure** (`InlineEditor.tsx`). `cssByKind` depended on a string of every Block's kind, so any split, merge, move, or undo restyled all 600 cells. Fix: one CSS object per kind-style object (WeakMap cache).
6. **Row index props.** Rows received `index` and `lastIndex`, so inserting or removing a Block re-rendered every row (and every row below it). Fix: rows get `first` / `last` booleans. Their actions look up the row's position when they run, by Block object in the last rendered structure, so the positional meaning stays exact even with duplicate ids.
7. **Column fill percentage** (`prayerEdit/translations.ts`). `fillPercent` looked every Block up by id (O(n²) per column, per render). Fix: one pass, memoized on the structure. The result is identical, including for duplicate ids (see `tests/fillPercent.test.ts`).

Checked and fine: typing (1–3.5 ms of script per keystroke), Find & replace, `ContentOutline` (reads layout that the next frame needs anyway), the library sidebar with 400 prayers (~8 ms of script per undo), and catalog scan (40 ms for 401 prayers).

Appearance was verified with pixel diffs of screenshots in the same states before and after (top, middle, empty cell, hover chrome on the first and last Block, after split, merge, move, undo). All were identical except the overlay scrollbar thumb, which also differs between two runs of the same build because of its fade timing.

## Import editor

The import view uses the same `InlineEditor`, but the fixes above did not reach it. Measured with the German text of the test prayer pasted as an import (300 Blocks):

| Per commit | Before | After |
|------------|-------:|------:|
| Time to next frame | 44 ms | 17 ms |
| Rows re-rendered | 300 | 1 |

Causes and fixes:

8. **New Prayer on every op** (`importDraftToPrayer`). Every op rebuilt every Block object, so no row could stay memoized. Fix: Core `createImportPrayerBuilder()` reuses the Block of each draft block an op left alone (same object), as long as sources, exclusions, variants and kinds are unchanged. The output equals `importDraftToPrayer` (tested over a sequence of ops).
9. **`leadCell` / `rowsAfter` as row props.** `ImportWorkspace` makes them anew each render, which is correct because their output depends on import state. Fix: the editor passes them through a context, so only those slots re-render; the rows and their editable cells stay memoized. The import DOM is identical before and after.
10. **`contextOf()` rebuilt the segment index on every call** (Core). Per-block helpers (`draftCorrections`, `draftBlockVisible`, the commit ops) call it once per Block, which is O(blocks × segments) per commit. Fix: cache it on the (immutable) `sources` / `excluded` arrays.

## Virtualization (measured, not shipped)

Two prototypes, measured against the shipped state (two columns; open = until the view is stable; scroll = frame gaps while scrolling the whole prayer at 300 px per frame):

| | 300 Blocks: open / add column | 1000 Blocks: open / add column | Scrolling |
|---|---:|---:|---|
| Now | 84 / 70 ms | 274 / 201 ms | frame-bound |
| `content-visibility: auto` (CSS only) | 68 / 51 ms | 224 / 139 ms | frame-bound |
| Windowed rows (IntersectionObserver, ±800 px, placeholder with remembered height) | 45 / 33 ms | 66 / 42 ms | frame-bound (max 17 ms) |

Commits, typing and scrolling do not change. Windowing only pays off for opening and column changes, and it grows with the prayer's length.

What windowed rows broke in the prototype:

| Check | Now | Windowed |
|-------|-----|----------|
| Scroll height after opening | 38 808 px | 33 605 px (estimated; the scrollbar shifts while scrolling) |
| Scroll position after switching prayers | right Block | 6 Blocks off |
| Outline jump to the last heading | 131 px below the top | 470 px below the top (rows above change height during the jump) |
| Find highlights | all 37 | only the mounted one |
| "Jump to next empty" (column %) | caret in the empty cell | no focus (cell not mounted) |

Shipping it would need: mount-before-reveal in `revealBlock` (outline, Find, next empty, arrow keys), scroll restore anchored on a Block id, a height estimate from text length per kind, Find highlights re-applied when rows mount, and keeping focused or selected rows mounted. That is moderate work in `InlineEditor`, `prayerScroll.ts` and the Find highlights, without changing the app structure. Worth it once prayers well above ~500 Blocks are common.

## Further options (not done)

- Code-splitting the import / assistant UI: at most a part of the ~24 ms module evaluation at start-up, and it adds loading states.

## Reproducing

1. `node packages/app/scripts/build-electron.mjs` (or `npx vite build --minify false --base ./` in `packages/app` for readable profiles).
2. Start Electron with a fresh profile and remote debugging: `env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron . --user-data-dir=<tmp>/ud --remote-debugging-port=9333 --disable-renderer-backgrounding --disable-background-timer-throttling`. Put `["<library>"]` into `<tmp>/ud/trusted-libraries.json` and the library into localStorage `orthodox-prayer-toolkit.recent-libraries`.
3. Drive it over CDP: `Profiler.start/stop` for CPU profiles, `Tracing` with `disabled-by-default-devtools.timeline.invalidationTracking` for style invalidation causes, and a `PerformanceObserver` of type `event` for input latency.
