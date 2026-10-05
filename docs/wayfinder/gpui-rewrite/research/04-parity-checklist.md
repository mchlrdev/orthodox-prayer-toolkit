# Parity checklist: what the Electron app does today

Ticket: docs/wayfinder/gpui-rewrite/issues/04-parity-checklist.md. Sources: `packages/app/src/**`, `packages/app/electron/{main,preload,updateCheck,macUpdateInstall}.ts`, `packages/app/electron-builder.yml`, `docs/*.md`, branch `rewrite/gpui`. Vocabulary follows `docs/glossary.md` (Library, Library root, Library catalog, Session draft, Block, Kind, Kind style, Variant). Paths are relative to `packages/app/` unless they start with `packages/` or `docs/`; `src/` prefixes are dropped inside `components/`, `session/`, `findReplace/`, `prayerEdit/`, `catalog/`. Line numbers refer to the files as of this branch. The inline editor's keystroke-level behaviour is out of scope (other ticket) but the editor is listed as a feature.

## Summary

268 checklist items in 20 areas.

| Area | Items |
|------|------:|
| 1. Window and app shell | 16 |
| 2. Menus and keyboard shortcuts | 20 |
| 3. Library: open, recent, new, reload | 25 |
| 4. Prayer list (Library sidebar) | 18 |
| 5. Prayer lifecycle: create, open, save, rename, delete, import, export JSON | 27 |
| 6. Unsaved changes and closing | 12 |
| 7. Invalid prayer screen | 6 |
| 8. Id collisions and file-name rules | 7 |
| 9. Workspace header and variant columns | 13 |
| 10. Inline editor (feature level; keystroke behaviour is a separate ticket) | 15 |
| 11. Find and replace | 14 |
| 12. Content outline (right sidebar) | 9 |
| 13. Prayer settings modal (Settings, three panes) | 13 |
| 14. Kinds and Kind styles | 18 |
| 15. Library settings | 6 |
| 16. Export | 15 |
| 17. App settings and updates | 13 |
| 18. Settings and preference persistence (where each lives) | 12 |
| 19. Notifications, warnings and error messages (user-visible strings to keep) | 5 |
| 20. Security and platform plumbing worth preserving | 4 |
| **Total** | **268** |

Dialogs and modals: App settings, Library settings, Prayer settings hub (Prayer / Languages / Kinds), Export, New library, New prayer, Unsaved changes, Validation details, Edit kind, and the generic Confirm dialog (delete prayer, rename kind in library, replace all, delete block, delete kind). Native OS dialogs: open folder, choose new-library location, import JSON, export save, update prompts and update errors. Menus: one macOS-only menu bar (App, File, Edit, View, Help) plus the in-app Library menu, row menu and block menus. Persistence: 5 localStorage stores and 3 on-disk files (section 18).

How to use: each item is a user-visible behaviour to reproduce (or consciously drop) in the GPUI app. Tick it only when the GPUI app behaves the same or better.

---

## 1. Window and app shell

- [ ] Main window opens 1280x840, minimum 400x400, hidden until ready-to-show, then shown and focused — packages/app/electron/main.ts:102-125
- [ ] Window title and app name are "Orthodox Prayer Toolkit"; window icon (Win/Linux) and Dock icon (macOS) come from resources/ — main.ts:41-56, 854-857
- [ ] Three-column shell: Library sidebar (left), workspace (centre), Content outline sidebar (right) — packages/app/src/App.tsx:238-404
- [ ] Round edge buttons collapse/expand the Library sidebar and the Content sidebar ("Expand/Collapse library sidebar", "Expand/Collapse content sidebar") — App.tsx:244-266, 369-391
- [ ] Sidebar collapsed state is remembered across launches; defaults: Library open, Content collapsed — packages/app/src/sidebarPrefs.ts:8-11
- [ ] Narrow-window "overlay mode" below 1100 px width: sidebars become overlays, only one open at a time, backdrop click ("Close sidebar") closes them — App.tsx:39, 71, 157-178, 393-403
- [ ] Overlay mode: selecting a prayer auto-collapses the Library; an outline jump auto-collapses the Content sidebar — App.tsx:86-104
- [ ] Overlay mode: Library is pinned open (cannot be collapsed, no backdrop) while a library is open but no prayer is selected (or the selected one has no visible variants) — App.tsx:134-155
- [ ] Entering overlay mode collapses both sidebars (unless pinned) — App.tsx:140-155
- [ ] Workspace shows one of four views: Library welcome, "Select a prayer from the library.", Invalid prayer screen, or the prayer workspace — App.tsx:223-234, 306-351
- [ ] View transitions are keyed per view/prayer (re-mount on switch) — App.tsx:301-304
- [ ] Toast notifications bottom-right, coloured dark (info) or accent (error/warning), with optional auto-close — packages/app/src/main.tsx:26; App.tsx:41-49
- [ ] Top-level error boundary shows "App crashed" alert, message, stack, and a "Try again" button — packages/app/src/components/ErrorBoundary.tsx:18-31
- [ ] Light / Dark / System colour scheme applied at startup before first paint — main.tsx:286-288; packages/app/src/appearancePrefs.ts:1-12
- [ ] Custom theme: accent (burgundy) + neutral dark scale, system font stack, modal blur overlay — packages/app/src/theme.ts:11-60, 120-180
- [ ] macOS: re-open window on Dock activate when none exists; non-macOS quits when all windows close — main.ts:875-877, 884-886

## 2. Menus and keyboard shortcuts

- [ ] macOS only: native menu bar is built; Windows/Linux set the application menu to null (no menu bar at all) — main.ts:754-759
- [ ] macOS app menu: About, Check for Updates…, Services, Hide, Hide Others, Show All, Quit — main.ts:765-783
- [ ] macOS File menu: Close (non-macOS branch "Quit" is unreachable because the menu is not built there) — main.ts:786-789
- [ ] macOS Edit menu: Undo, Redo, Cut, Copy, Paste, Select All — main.ts:793-800
- [ ] macOS Edit > Find… (Cmd+F) sends "find" to the focused window — main.ts:801-805
- [ ] macOS Edit > Find Next (Cmd+G) sends "find-next" to the focused window — main.ts:806-810
- [ ] macOS View menu: Reload, Toggle DevTools, Reset Zoom, Zoom In, Zoom Out, Toggle Fullscreen — main.ts:814-825
- [ ] macOS Help menu: GitHub Releases opens https://github.com/mchlrdev/orthodox-prayer-toolkit/releases in the default browser (the app menu holds Check for Updates on macOS; Help holds it on other platforms, but that menu does not exist there) — main.ts:826-846
- [ ] Ctrl/Cmd+F toggles the Find bar (all platforms, handled in the renderer) — packages/app/src/findReplace/useFindReplace.ts:209-213
- [ ] Ctrl/Cmd+Alt+F opens Find with Replace expanded and focuses the Replace field — useFindReplace.ts:215-220
- [ ] Ctrl/Cmd+G = next match, Ctrl/Cmd+Shift+G = previous match (only while Find is open) — useFindReplace.ts:231-236
- [ ] F3 = next match, Shift+F3 = previous match (only while Find is open) — useFindReplace.ts:238-242
- [ ] Enter / Shift+Enter inside a Find or Replace input = next / previous match — useFindReplace.ts:224-229
- [ ] Esc closes the Find bar — useFindReplace.ts:203-207
- [ ] Menu "Find…" / "Find Next" IPC route into the same open/next logic (Find Next opens Find if closed) — useFindReplace.ts:249-261
- [ ] Ctrl/Cmd+Shift+M toggles an inline note on the selected text in a block — packages/app/src/components/InlineEditor.tsx:529-536
- [ ] Enter inside a block splits it / inserts a new block below; Shift+Enter inserts a newline; Backspace on an empty block deletes it — InlineEditor.tsx:538-588 (keystroke detail is covered by another ticket)
- [ ] Dev-only global shortcut Ctrl/Cmd+Shift+I toggles detached DevTools (not needed in release builds) — main.ts:866-873
- [ ] No Ctrl/Cmd+S shortcut exists: saving is only the Save button or the unsaved-changes dialog — packages/app/src/components/PrayerWorkspace.tsx:278-286
- [ ] No Ctrl/Cmd+O / N / W shortcuts exist for open library / new prayer / close (none registered anywhere) — grep of packages/app

## 3. Library: open, recent, new, reload

- [ ] Dev builds auto-open the repo's examples/ library on startup; packaged builds start with no library — main.ts:90-95, 155-159; packages/app/src/usePrayerSession.ts:227-244
- [ ] "Open library…" shows a native folder picker titled "Open prayer library folder" — main.ts:161-170
- [ ] Only library roots opened this session (picker, recent, create, dev startup) may be read/written by file IPC; others throw "Library root is not open in this session" — main.ts:59-75
- [ ] All file paths are confined to the library root (no `..`, absolute segments or symlink escape; NUL rejected) — packages/app/nodeFs.ts:13-71
- [ ] Library scan lists every `.json` recursively (skips `node_modules` and `.git`), sorted; only flat root-level `{id}.json` names count as prayers — nodeFs.ts:74-90; packages/app/src/catalog/scan.ts:71
- [ ] Library catalog is built progressively: stub list first, then metadata read in chunks of 25 files, list updates after each chunk — scan.ts:92-125; packages/app/src/catalog/types.ts:38
- [ ] `manifest.json` is read and normalised if valid; an invalid manifest is silently treated as absent — scan.ts:24-36
- [ ] `.orthodox-prayer-toolkit/styles.json` is read and sanitised; unreadable/invalid parts produce "Library styles cleaned" toast (first time only) — scan.ts:38-56; packages/app/src/session/operations.ts:153-163
- [ ] Busy state while scanning disables Open/Import/Refresh/New-library controls — usePrayerSession.ts:197; PrayerList.tsx:190,197; LibraryWelcome.tsx:50-57
- [ ] Opening a library records it in Recent libraries (max 10, newest first, de-duplicated by path) — packages/app/src/recentLibraries.ts:2, 45-55
- [ ] Recent list lives in the Library menu (up to 8 shown), marks the current one "(current)" and disables it, shows full path as tooltip/subtitle — PrayerList.tsx:87, 128-171
- [ ] Each recent row has an X ("Remove from recent") — PrayerList.tsx:153-166; LibraryWelcome.tsx:81-91
- [ ] Opening a recent library re-authorises the path in main; if the folder is gone: toast "Could not open library", entry removed from Recent — usePrayerSession.ts:269-282; main.ts:206-215
- [ ] Library welcome screen (no library open): "Open a library to begin", Open library… / New library… buttons, full Recent list or "No recent libraries yet." — packages/app/src/components/LibraryWelcome.tsx:31-98
- [ ] Sidebar with no library: title "No library", hint "Open or create a library to list prayers." — PrayerList.tsx:210, 253-258
- [ ] Sidebar header shows the folder basename (tooltip) and the manifest description under it — PrayerList.tsx:205-219
- [ ] "New library…" modal: Folder name (required, no `/` `\`, not `.`/`..`; inline error), Description, Default language (default "de"), Default variant (default "standard"); both-or-neither rule; button "Choose location…" — packages/app/src/components/NewLibraryModal.tsx:35-62, 77-82, 102-172
- [ ] New library flow: native folder picker "Choose location for the new library" (button "Create here", can create folders); fails with "Folder already exists: <name>" if target exists; writes manifest.json; toast "Library created / manifest.json written"; then opens it — main.ts:172-203; usePrayerSession.ts:284-310
- [ ] Cancelling either picker is a silent no-op — main.ts:166-167, 192; usePrayerSession.ts:265, 297
- [ ] "Refresh" (Library menu) rescans the library from disk; asks about unsaved changes first — PrayerList.tsx:194-200; usePrayerSession.ts:312-322
- [ ] Rescan keeps the selected prayer and any dirty drafts that still exist on disk — operations.ts:168-183
- [ ] Switching library with dirty drafts is intercepted by the Unsaved changes dialog (open-folder action) — usePrayerSession.ts:246-257
- [ ] Switching library resets the session (drafts, selection, create draft) but keeps app styles — operations.ts:109-113
- [ ] Opening a library closes the Library settings modal — App.tsx:184-197, 546
- [ ] Browser-dev mode only: "Desktop app required" toast when Open/New/Recent is tried — operations.ts:48-54 (browser preview is out of scope for the rewrite; list kept for completeness)

## 4. Prayer list (Library sidebar)

- [ ] List sorted by `id` (or filename when id unknown) — packages/app/src/catalog/build.ts:125-129
- [ ] Each row shows id, display title (resolved for library default variant), and description; falls back to path when unscanned/invalid — PrayerList.tsx:275-292
- [ ] Display title uses manifest default variant, else first variant — packages/app/src/session/operations.ts:92-106
- [ ] Not-yet-scanned files appear immediately with the id taken from the filename — packages/app/src/catalog/build.ts:25-45
- [ ] Filter box "Filter prayers…" matches id, title, description, path (case-insensitive substring); "No prayers match." when empty — PrayerList.tsx:89-97, 224-234, 339-343
- [ ] Row with unsaved changes shows a dot ("Unsaved changes"); row reflects the draft's live id/title/description — PrayerList.tsx:276-282; operations.ts:92-106
- [ ] Invalid prayers show an accent "!" badge — PrayerList.tsx:295-299
- [ ] Selected row highlighted; click opens the prayer — PrayerList.tsx:264-274
- [ ] Row "⋯" menu: "Export prayer JSON…" and "Delete" — PrayerList.tsx:300-335
- [ ] "+" button next to the filter = New prayer — PrayerList.tsx:235-243
- [ ] Library "⋯" menu items: Open library…, New library…, Recent, App settings, Library settings, Import prayer JSON…, Refresh (last three only with a library open) — PrayerList.tsx:104-204
- [ ] Sidebar alert "Duplicate ids" listing colliding ids — PrayerList.tsx:247-251
- [ ] Opening a prayer is async: reads file, validates, picks columns; read failure shows "Could not open prayer" — usePrayerSession.ts:341-385
- [ ] Re-selecting the already-open prayer is a no-op — usePrayerSession.ts:346-351
- [ ] Switching away from a clean prayer drops its in-memory draft; dirty drafts are kept — operations.ts:124-135
- [ ] Scroll position per prayer is remembered while the app runs (in-memory only) — packages/app/src/prayerScroll.ts:3-65
- [ ] Per-prayer visible columns restored when reopening a prayer (persisted) — packages/app/src/viewPrefs.ts:3, 22-37; session/visibleVariants.ts:1-35
- [ ] Catalog union of kinds and variants (feeds kind lists, Library settings default-language choices) — catalog/build.ts:131-153

## 5. Prayer lifecycle: create, open, save, rename, delete, import, export JSON

- [ ] New prayer: picks first free id `new-prayer-N` by checking disk, opens "New prayer" modal — packages/app/src/session/operations.ts:553-572
- [ ] New prayer template: type "prayer", tone null, one variant de/standard "Unbenannt" (license "unknown", source "draft"), one empty verse block b1 — packages/app/src/library.ts:56-78
- [ ] New prayer modal fields: File name (id, required, autofocus), Description, Type, Tone (1-8), Book, Occasion, plus Language Code, Edition, Display title, License, Source for the first variant; Cancel / Create; Create disabled when id empty; modal can't be dismissed while busy — packages/app/src/components/NewPrayerModal.tsx:46-72; PrayerBasicsFields.tsx; VariantMetaFields.tsx
- [ ] Create validates against the schema: failure toast "Cannot create" with joined messages — operations.ts:588-600
- [ ] Create id-collision: toast "Id collision — File <id>.json already exists. Choose another id." (modal stays open) — operations.ts:602-615
- [ ] Create success: writes pretty-printed JSON + trailing newline, toast "Created", selects the new prayer with its variant as only column, closes modal — operations.ts:617-646; App.tsx:411-415
- [ ] Create write failure: toast "Create failed" — operations.ts:647-658
- [ ] Only one create draft at a time — operations.ts:557
- [ ] Editing a prayer marks the draft dirty; shows an "Unsaved" badge next to the title and enables Save — session/draftEdit.ts:68-84; PrayerWorkspace.tsx:237-241, 283
- [ ] Schema validation of the draft runs 500 ms after each edit; errors are kept on the draft — session/draftEdit.ts:65; usePrayerSession.ts:118-132
- [ ] Save: re-validates; on errors blocks with toast "Cannot save — "<id>": fix validation errors first." — operations.ts:399-423; session/persistPrayer.ts:16-22
- [ ] Save writes `{id}.json` (pretty JSON + newline), clears dirty, toast "Saved" with filename — persistPrayer.ts:37-45; operations.ts:425-440
- [ ] Rename by id edit: on save writes the new `{id}.json`, then deletes the old file — persistPrayer.ts:24-43
- [ ] Rename collision: save blocked with "Cannot save — Id collision: <file> already exists." (no overwrite) — persistPrayer.ts:27-35
- [ ] After a rename the saved column layout and catalog entry move to the new path and the selection follows — operations.ts:370-397; viewPrefs.ts:255-272
- [ ] Rename is not atomic (write new, then delete old; delete failure surfaces as save error after the new file exists) — persistPrayer.ts:39-49
- [ ] Save All (from the Unsaved dialog) saves every dirty prayer in order; stops on first failure with "Cannot save all"; success toast "N prayers saved" — operations.ts:445-499
- [ ] Delete: row menu > Delete opens "Delete prayer?" confirm ("This cannot be undone."); deleting removes the file, its saved view prefs and catalog row, clears selection if it was open; toast "Deleted" — App.tsx:510-523; operations.ts:661-697
- [ ] Delete failure: toast "Delete failed" — operations.ts:685-696
- [ ] Import prayer JSON…: native open dialog "Import prayer JSON" (JSON / All Files); copies the file bytes unchanged into the library root as `{id}.json` (or source basename if no id) — main.ts:377-397; session/prayerFileIo.ts:44-58, 118-214
- [ ] Import rejects non-flat names ("Cannot import “<name>” as a prayer file.") — prayerFileIo.ts:37-57
- [ ] Import id/path collision: toast "Id collision — “<id>” already exists as <path>." / "File <path> already exists." (never overwrites) — prayerFileIo.ts:155-187
- [ ] Import success: toast "Imported", opens the imported prayer (invalid files open in the Invalid screen, bad JSON adds an "Invalid JSON" toast) — prayerFileIo.ts:202-213
- [ ] Export prayer JSON… (row menu): native save dialog "Export prayer JSON", default `{id}.json`; exports the unsaved draft if dirty else the disk bytes; toast "Exported" with path; failure "Export failed" — prayerFileIo.ts:61-115; main.ts:325-374
- [ ] Opening a file with invalid JSON: toast "Invalid JSON" + Invalid prayer screen — operations.ts:290-300
- [ ] Opening a file that fails the schema: Invalid prayer screen (no toast) — operations.ts:302-309
- [ ] Save keeps `visibleVariants` columns; saving also persists the view — operations.ts:393

## 6. Unsaved changes and closing

- [ ] Window close with dirty drafts is intercepted: main cancels the close and asks the renderer, which shows the Unsaved changes dialog — main.ts:127-131; usePrayerSession.ts:613-621
- [ ] Renderer tells main whether any draft is dirty (`setDirty`) so a clean app closes immediately — usePrayerSession.ts:608-611; main.ts:410-415
- [ ] Unsaved changes dialog: "N prayer(s) have unsaved changes. Save all, discard all, or cancel."; buttons Cancel / Discard all / Save all; not dismissible while busy — packages/app/src/components/UnsavedChangesDialog.tsx:20-56
- [ ] Save all then continues the pending action (close window / reload library / open folder); stops if any save failed — usePrayerSession.ts:556-572
- [ ] Discard all drops dirty drafts; for reload/open-folder/close this continues the pending action; when the pending action is a plain refresh it re-reads the selected prayer from disk — usePrayerSession.ts:574-596; operations.ts:501-525
- [ ] Cancel leaves everything as is — App.tsx:543
- [ ] Same dialog guards: switching library (open/recent/new), Refresh, window close — usePrayerSession.ts:246-257, 312-322
- [ ] Switching between prayers does NOT prompt: dirty drafts are kept in memory and marked in the list — usePrayerSession.ts:352-363; operations.ts:124-135
- [ ] Browser `beforeunload` guard when unsaved (browser-dev only; Electron relies on the main-process close hook) — usePrayerSession.ts:598-606
- [ ] Update "Install and Restart" bypasses the unsaved-changes dialog (all close listeners are removed first) — main.ts:570-575
- [ ] Closing the window persists the current column view first — usePrayerSession.ts:615-617
- [ ] Block delete is only "undone" by not saving (dialog says so); kind rename, in contrast, writes other prayers' files immediately and is not covered by the dirty/unsaved flow — InlineEditor.tsx:1223-1224; App.tsx:531

## 7. Invalid prayer screen

- [ ] Selecting an invalid/corrupt file shows "Cannot open prayer", the file name, and the text "This file is invalid or corrupted and cannot be opened in the editor. Fix the JSON on disk, then refresh the library." — packages/app/src/components/InvalidPrayerScreen.tsx:26-37
- [ ] Info icon "Show validation details" opens a modal listing each error with its JSON path and message ("No details available." if none) — InvalidPrayerScreen.tsx:38-81
- [ ] Invalid prayers cannot be edited in the app (no raw JSON editor, no repair) — App.tsx:306-307
- [ ] Invalid prayers can still be deleted from the list; the badge "!" is shown — PrayerList.tsx:295-335
- [ ] Settings/Export/Save UI is unavailable on this screen — App.tsx:306-336
- [ ] Opened prayer with zero usable variants falls back to the "Select a prayer" empty state — App.tsx:230-233

## 8. Id collisions and file-name rules

- [ ] Duplicate ids across files are detected on scan and shown as toast "Duplicate prayer ids" (8 s, `id: path1, path2`) and as a sidebar "Duplicate ids" alert — operations.ts:137-152; PrayerList.tsx:247-251
- [ ] Duplicate-id toast shown only when collisions first appear (not on every chunk) — operations.ts:143
- [ ] Create collision, rename-on-save collision, import collision all refuse to overwrite (see section 5) — operations.ts:602-615; persistPrayer.ts:27-35; prayerFileIo.ts:155-187
- [ ] Kind-rename file writes use existing paths, never renames — session/renameKindLibrary.ts:96-164
- [ ] File name field in prayer settings is the prayer id (label "File name"), required — components/PrayerBasicsFields.tsx:19-25
- [ ] `filenameMismatch` is computed in the catalog but never displayed (nothing to port, but a mismatching file is saved under `{id}.json`, leaving the old file removed) — catalog/build.ts:66,104; grep shows no UI use
- [ ] Rename IPC itself refuses an existing target: "Target already exists" — main.ts:285-287 (unused by UI; the app renames through write+delete)

## 9. Workspace header and variant columns

- [ ] Header shows the prayer's display title in the first visible variant — PrayerWorkspace.tsx:218, 236
- [ ] Header actions: Find (tooltip "Find (⌘F)"), Settings, Export, Save — PrayerWorkspace.tsx:244-286
- [ ] Save button disabled when not dirty; shows loading while busy — PrayerWorkspace.tsx:278-286
- [ ] Column bar shown when the prayer has more than one variant — PrayerWorkspace.tsx:290
- [ ] Each visible column is a chip "lang / variant" with tooltip of its title — PrayerWorkspace.tsx:98-105
- [ ] Chip menu "Switch column" lists all variants (label "lang / variant — title") to replace this column; picking one already shown swaps the two — PrayerWorkspace.tsx:107-125, 188-200
- [ ] Chip X "Remove column" (hidden when only one column) — PrayerWorkspace.tsx:127-138, 202-205
- [ ] "Add" button/menu "Add translation" lists variants not yet visible — PrayerWorkspace.tsx:308-343
- [ ] "Show all" shows every variant as a column (only if more than one is hidden) — PrayerWorkspace.tsx:212-216, 344-354
- [ ] Column order = reading order; the first column is the "primary" variant (outline, title, live commit) — usePrayerSession.ts:198; ContentOutline usage App.tsx:362
- [ ] Column set is persisted per prayer path per library — viewPrefs.ts:228-239
- [ ] Removing a variant in settings reconciles columns and picks a fallback — session/draftEdit.ts:73-76; variant.ts:22-36
- [ ] Sticky column label strip when split: lang, variant and a "% filled" button that jumps to the next empty block in that column — InlineEditor.tsx:985-1025

## 10. Inline editor (feature level; keystroke behaviour is a separate ticket)

- [ ] WYSIWYG contenteditable editing directly in the formatted text, one cell per block per visible variant (side-by-side columns) — InlineEditor.tsx:1027-1180
- [ ] Block text styled live from its Kind style (size, colour, weight, italic, alignment, accent initial, "indicate" marker) — InlineEditor.tsx:78-90, 1030-1050
- [ ] Line-mode kinds (multi-line `lines`) vs. single text kinds — InlineEditor.tsx:1030; prayerEdit/translations.ts
- [ ] Inline notes: select text, floating toolbar button "Mark as inline note"/"Remove inline note" (also on hover over a note), Ctrl/Cmd+Shift+M — InlineEditor.tsx:376-400, 529-536, 617-660
- [ ] Plain-text paste only (rich clipboard content is stripped) — InlineEditor.tsx:595-613
- [ ] Heading / subheading edits in the primary column commit live on every input; all other cells commit on blur — InlineEditor.tsx:1163-1172, 456-470
- [ ] Per-block chrome: Kind button (opens Kind picker), Move up, Move down, Delete block — InlineEditor.tsx:1076-1150
- [ ] Delete block: confirm "Delete block?" ("This removes the block and its translations from the prayer. You can undo by not saving."); empty blocks delete without confirmation; the sole block can't be deleted by Backspace — InlineEditor.tsx:833-868, 1220-1233
- [ ] "Add <Kind>" button appends a block of the last used kind and focuses it; chevron menu "Choose block kind" picks another kind — InlineEditor.tsx:1187-1216
- [ ] Enter splits a block at the caret in the active column; new block gets next id and focus — InlineEditor.tsx:886-905, 551-588
- [ ] Clicking in a block's margin focuses the editable under the pointer's column — InlineEditor.tsx:1046-1075
- [ ] Jump to next empty block in a column (the "% filled" chip) — InlineEditor.tsx:945-958, 1005-1020
- [ ] Scroll/reveal API used by outline and find: smooth-center or instant-start, optional caret, "flash" highlight (900 ms) on the target — InlineEditor.tsx:100, 756-830
- [ ] The per-block Kind picker mounts only for the block whose Kind button was clicked and unmounts when idle (picker and edit modal both closed) — InlineEditor.tsx:1076-1110; components/KindSelect.tsx:117-141
- [ ] Find matches highlighted inside the editor (current match emphasised) — packages/app/src/findReplace/highlights.ts; findReplace/useFindReplaceHighlights.ts

## 11. Find and replace

- [ ] Find bar under the header (role "search", aria-label "Find and replace"): Find field with search icon, placeholder "Find" — components/FindReplacePanel.tsx:62-74
- [ ] Toggles: Match case (aria-pressed), Whole word (W) — FindReplacePanel.tsx:76-104
- [ ] Counter "n / m" (or "0 / 0" with dimmed style) — FindReplacePanel.tsx:38-41, 106-114
- [ ] Previous / Next match buttons (tooltips "Previous (Shift+Enter)", "Next (Enter)"), disabled with no matches; wrap-around navigation — FindReplacePanel.tsx:116-141; findReplace/state.ts:32-35
- [ ] Replace toggle (tooltip "Replace (⌥⌘F)" / "Hide replace") expands a Replace field with "Replace" and "Replace all" buttons — FindReplacePanel.tsx:143-215
- [ ] Close button (tooltip "Close (Esc)") — FindReplacePanel.tsx:160-170
- [ ] Search runs 150 ms after typing, across all visible variant columns of the current prayer — useFindReplace.ts:81-96
- [ ] Current match scrolled into view; all matches highlighted, current one emphasised — useFindReplace.ts:101-112
- [ ] Opening Find pre-fills the query from the current selection inside the workspace — useFindReplace.ts:37-46, 121-136
- [ ] Find state (query, flags, replace text, expanded, index) is remembered per prayer path for the app session — useFindReplace.ts:55-79
- [ ] Replace current match edits the prayer draft (marks dirty) — useFindReplace.ts:165-173
- [ ] Replace all asks "Replace all? Replace N occurrence(s) in M block(s)?" then edits the draft — PrayerWorkspace.tsx:421-432; useFindReplace.ts:175-193
- [ ] Find works over run arrays/lines and inline notes (plain-text matching with offsets) — packages/app/src/prayerEdit/findReplace.ts:13-60
- [ ] Find/Replace never writes to disk by itself; the usual Save applies — useFindReplace.ts:165-188

## 12. Content outline (right sidebar)

- [ ] Title "Content"; lists headings (top level) and subheadings (nested) of the primary variant — components/ContentOutline.tsx:141-147; prayerEdit/outline.ts:43-75
- [ ] Empty label "No heading"; blank headings show "Untitled" — ContentOutline.tsx:25-29, 173-175
- [ ] Click an entry to jump to that block (instant scroll to the sticky line, flash) — ContentOutline.tsx:225; App.tsx:94-104
- [ ] Heading groups expand/collapse via chevron ("Expand heading"/"Collapse heading") — ContentOutline.tsx:229-243
- [ ] "Expand all" / "Collapse all" button when any group exists — ContentOutline.tsx:148-168
- [ ] Scrollspy highlights the active entry while scrolling the prayer and auto-expands its group — ContentOutline.tsx:67-118; prayerEdit/outline.ts:77-105
- [ ] Orphan subheadings at root level are listed; nested subheadings never win scrollspy — outline.ts:83-105
- [ ] Expanded state survives structure changes for headings that still exist — ContentOutline.tsx:56-65
- [ ] Sidebar hidden/collapsed by default; state persisted (see section 1) — sidebarPrefs.ts:8-11

## 13. Prayer settings modal (Settings, three panes)

- [ ] Modal "Settings" (760 px, no padding) with left navigation: Prayer, Languages, Kinds; pane resets to "Prayer" when the selected prayer changes — components/PrayerSettingsModal.tsx:44-52, 66-97; App.tsx:180-182
- [ ] Opened from the header Settings icon; a New prayer draft uses NewPrayerModal instead — App.tsx:406-445
- [ ] Prayer pane fields: File name (id), Description, Type (hint "e.g. prayer, troparion"), Tone (1-8, integer, optional, null when cleared), Book, Occasion — components/PrayerBasicsFields.tsx:19-86
- [ ] Empty description/book/occasion are removed from the JSON (omitted), per "no empty values" rule — PrayerBasicsFields.tsx:32-37, 68-73, 79-84
- [ ] Extra fields: key/value list under `meta.custom`; "No extra fields yet."; "Add field" creates `field_N`; rename key on blur/Enter; value edit; clearing a value deletes the key; trash button removes; empty map is dropped — components/ExtraFieldsEditor.tsx:10-121
- [ ] Languages pane: accordion with one item per variant (label "lang / variant", title preview), "Remove" button (disabled when only one variant), "Add language" button — components/LanguagesPanel.tsx:84-140
- [ ] Per-variant fields: Language Code, Edition, Display title, License, Source — components/VariantMetaFields.tsx:9-41
- [ ] Add language creates `en` / `draft-N`, title copied from first variant ("Untitled" fallback), license "unknown", source "draft", and opens it — LanguagesPanel.tsx:47-58
- [ ] Removing a variant keeps at least one; active column switches to the first remaining — LanguagesPanel.tsx:60-82
- [ ] Editing lang/edition of the active variant keeps it the active column — LanguagesPanel.tsx:32-45
- [ ] Removing a variant only removes it from `variants`; that variant's translations stay on the blocks (not pruned; Core validate has no orphan-translation check) — components/LanguagesPanel.tsx:60-64; packages/core/src/validate.ts:57-100
- [ ] Kinds pane = Kind styles panel (section 14) — PrayerSettingsModal.tsx:121-144
- [ ] All settings edits go to the same dirty draft and mark it unsaved (nothing saves on close) — PrayerSettingsModal.tsx:105-119; session/draftEdit.ts

## 14. Kinds and Kind styles

- [ ] Kinds panel: accordion of all kinds (presets first via ordering), labels title-cased; "Open a library to edit kind styles." when no library is open — components/KindStylesPanel.tsx:35, 87-93, 104-114
- [ ] Per-kind style fields: Size (S 0.875rem / M 1rem / L 1.125rem / XL 1.35rem; arbitrary rem snaps to nearest), Color (Base / Accent swatch picker), Align (Left / Center / Justified), Bold, Italic, Accent initial, Indicate, "HTML tag for export" (allowlist, clearable, placeholder "Default (div)") — components/KindStyleFields.tsx:20-25, 99-175; colors.ts:11-14
- [ ] Style edits are written immediately to the library's `.orthodox-prayer-toolkit/styles.json` (validated first; "Cannot save library styles" toast on failure); no Save button — session/operations.ts:763-797; KindStylesPanel.tsx:60-74
- [ ] Custom kinds show a Remove button and a "Kind" rename field (letters/digits/_/-, starts with a letter, max 64; live sanitising; inline errors "Required", "Built-in kinds cannot be renamed", "Use a letter, then letters, digits, _ or -", "That name is reserved", "Already exists") — KindStylesPanel.tsx:115-152; prayerEdit/translations.ts:60-77; core validateStyles.ts:15-30
- [ ] Preset kinds (heading, subheading, annotation, verse) can't be renamed or removed, but their style can be edited — KindStylesPanel.tsx:106, 115, 133
- [ ] "Add kind" → inline field "new-kind", Enter/Add commits (Esc cancels, "Already exists" error) and persists it as a library kind even if unused — KindStylesPanel.tsx:76-85, 165-208; prayerEdit/styles.ts:24-31
- [ ] Remove kind: deletes the kind's style entries (library + app maps) and converts blocks using it to a preset kind (Core `deleteKind`) — PrayerSettingsModal.tsx:133-142; prayerEdit/styles.ts:57-72
- [ ] Rename kind: committed on blur/Enter; if more than one prayer in the library uses it, confirm "Rename kind in library?" ("Rename “A” to “B” in N prayers? This writes those files now."); one or zero affected prayers rename without confirm — session/operations.ts:943-967; App.tsx:525-537
- [ ] Rename kind applies to every prayer (open drafts in memory, other files on disk), library styles and app styles, then toasts "Kind renamed" (with "· N skipped" if some files failed) — session/renameKindLibrary.ts:19-164; operations.ts:881-941
- [ ] Rename kind failure: toast "Kind rename failed" — operations.ts:929-940
- [ ] Kind scanning for rename covers unread catalog stubs by reading them — renameKindLibrary.ts:19-64
- [ ] Per-block Kind picker (button with the kind label): popover listing all kinds with check on current, pencil "Edit kind …", and "Add kind…" with inline "new-kind" field — components/KindSelect.tsx:286-390
- [ ] Choosing a kind changes that block's kind — InlineEditor.tsx:1092-1094; KindSelect.tsx:321-324
- [ ] "Edit kind “X”" modal: Kind rename field, full style fields (dropdowns inside the modal), Delete (custom only) with confirm "Delete kind?" ("Blocks using it become verse. Style overrides for this kind are removed."; Core `deleteKind` falls back to verse, or annotation when deleting verse), Done — KindSelect.tsx:217-283, 396-412; packages/core/src/indexKinds.ts:64-76
- [ ] Adding a kind from the picker also writes it to library styles; the new kind is applied to the block — KindSelect.tsx:143-160
- [ ] Style resolution: discovered kinds + built-in defaults + library `styles.json` (library wins); unknown kinds get a fallback preset — usePrayerSession.ts:216-225; docs/library.md
- [ ] Kind-style definitions: fontSize, color (base/accent token or legacy hex), fontWeight, fontStyle, optional textAlign (verse/annotation default justify), initialCap, indicate, htmlTag — docs/library.md:60-68
- [ ] App-level `kind-styles.json` (userData) is read at startup and rewritten on kind rename/remove, but never fed into rendering (see "Things that surprised me") — electron/main.ts:146-148, 298-306; usePrayerSession.ts:200-214

## 15. Library settings

- [ ] "Library settings" modal (only with a library open): Description, Default language (searchable dropdown from variants in the library and open drafts, clearable, "(not in library)" suffix for stale values, placeholder "None (first language per prayer)"), Layout style prefix (stem; `_` suffix shown; validated "letters/digits only, starting with a letter — or empty") — components/LibrarySettingsModal.tsx:118-186
- [ ] Hint "Add a language to a prayer first, then pick a library default here." when no variants exist — LibrarySettingsModal.tsx:182-186
- [ ] Save writes `manifest.json` (pretty, newline), toast "Library updated / manifest.json saved", closes; failure toast "Could not save library settings" and the modal stays open — session/operations.ts:699-736; usePrayerSession.ts:324-339
- [ ] Save disabled while the prefix is invalid; Cancel — LibrarySettingsModal.tsx:104-105, 188-199
- [ ] Manifest fields preserved/produced: description, defaultVariant {lang, variant}, stylePrefixStem — LibrarySettingsModal.tsx:49-65
- [ ] Default variant drives list titles, initial columns and export language prefill — operations.ts:92-106; session/visibleVariants.ts:1-35; session/exportPick.ts:1-18

## 16. Export

- [ ] Export modal (header Export icon): Language (searchable, prefilled with library default variant else first), Format (Flat JSON / HTML / Layout), checkbox "Include blocks without translation" — components/ExportModal.tsx:253-420
- [ ] Hint "Add a language in prayer settings before exporting."; Export disabled until a language is chosen — ExportModal.tsx:416-421, 179-183
- [ ] Format resets to Flat JSON and language to the default every time the modal opens — ExportModal.tsx:119-146
- [ ] HTML: per-kind HTML tag selects ("Kind → HTML tag", default from kind styles, "Reset tags"), "Wrap in root element" with Wrapper tag (allowlist) and Wrapper attributes (parsed/validated, errors inline) — ExportModal.tsx:293-357
- [ ] Layout: File type DOCX / RTF, Style prefix (default from library stem, `_` shown, invalid-stem error, "Reset" button) — ExportModal.tsx:359-405
- [ ] Export always uses the in-memory draft, including unsaved changes — session/operations.ts:811-817
- [ ] Output file names `{id}.{lang}.{variant}.flat.json`, `.html`, `.docx`, `.rtf` — session/exportPrayerVariant.ts:282-313
- [ ] Native save dialog with per-format title ("Export flat variant JSON", "Export HTML", "Export Layout RTF", "Export Layout DOCX") and filters — main.ts:325-364
- [ ] Binary (DOCX) vs text writes; successful path remembered for reveal — main.ts:366-373
- [ ] Success toast "Exported" with the full path; modal closes (also closes when the user cancels the save dialog) — operations.ts:859-865; ExportModal.tsx:245-247
- [ ] Failure toast "Export failed"; modal stays open — operations.ts:866-877; ExportModal.tsx:245
- [ ] Invalid wrapper attributes or tag block export — exportPrayerVariant.ts:265-268; ExportModal.tsx:171-177
- [ ] Per-prayer export preferences persisted after each successful export: include-empty, HTML tag map + wrapper settings, layout format + prefix stem — packages/app/src/exportPrefs.ts:6-40, 171-197
- [ ] Exports are produced by Core (`exportVariant`, `exportHtml`, `exportLayoutRtf`, `exportLayoutDocx`) — session/exportPrayerVariant.ts:1-9
- [ ] "Reveal in folder" IPC (`shell:showItem`) exists for exported/library paths but no UI calls it — main.ts:399-406; grep of src

## 17. App settings and updates

- [ ] "App settings" modal (Library menu > App settings): Appearance (Light / Dark / System), About with version and update status — components/AppSettingsModal.tsx:101-161
- [ ] Opening the modal immediately loads the version and runs an update check ("Checking for updates…" with spinner) — AppSettingsModal.tsx:36-67
- [ ] Update status messages: dev "Update checks run only in the installed app."; "You're up to date."; "Version X is available."; "Version X is ready to install."; error text shown in red — electron/updateCheck.ts:44-57; AppSettingsModal.tsx:92-136
- [ ] "Check for updates" button (hidden in dev); "Install and Restart" button when a download is ready; note "The update is downloading. You'll be asked to install it when it's ready." — AppSettingsModal.tsx:137-160
- [ ] Live status broadcast to open windows (`app:update-status`) — main.ts:451-457; preload.ts:130-141
- [ ] Startup check 5 s after launch, silent on failure — main.ts:743-745; docs/RELEASE.md:57-72
- [ ] Auto-download on; on macOS no auto-install on quit (custom installer), elsewhere auto-install on quit — main.ts:663-666
- [ ] Update-downloaded dialog "Update ready — Version X has been downloaded." with "Install and Restart" / "Later"; Later suppresses prompts for this session and disables auto-install on quit — main.ts:541-568
- [ ] Menu "Check for Updates…": dev shows "Update checks run only in packaged builds."; pending update re-prompts install; otherwise checks and shows "Update available… downloading", "You're up to date. Version X is the latest release.", or "Update check failed" — main.ts:625-658, 671-717
- [ ] macOS install: spawns a detached bash script that waits for the app to exit, unzips the downloaded ZIP with ditto, replaces the .app, relaunches; errors "Update install failed" dialogs (missing file / helper failure) — main.ts:577-611; electron/macUpdateInstall.ts:1-68
- [ ] Windows/Linux install via `quitAndInstall` — main.ts:610
- [ ] Update feed is GitHub Releases of mchlrdev/orthodox-prayer-toolkit (latest*.yml) — packages/app/electron-builder.yml (publish block)
- [ ] Dev builds never contact the update feed — main.ts:485-494, 626-635, 661

## 18. Settings and preference persistence (where each lives)

- [ ] Colour scheme (light/dark/system) — renderer localStorage `orthodox-prayer-toolkit.appearance-prefs` — appearancePrefs.ts:1-12
- [ ] Sidebar collapsed flags — localStorage `orthodox-prayer-toolkit.sidebar-prefs` — sidebarPrefs.ts:1-11
- [ ] Recent libraries (path + lastOpened, max 10) — localStorage `orthodox-prayer-toolkit.recent-libraries` — recentLibraries.ts:1-2
- [ ] Per-prayer visible columns, keyed by library root then path — localStorage `orthodox-prayer-toolkit.prayer-views` — viewPrefs.ts:3
- [ ] Per-prayer export preferences, keyed by library root then path — localStorage `orthodox-prayer-toolkit.export-prefs` — exportPrefs.ts:6
- [ ] Library description / default variant / style prefix stem — `<library>/manifest.json` — session/operations.ts:699-722
- [ ] Library kind styles and custom kinds — `<library>/.orthodox-prayer-toolkit/styles.json` — main.ts:150-152
- [ ] App-level kind styles — `<userData>/kind-styles.json` (see surprises) — main.ts:146-148
- [ ] Scroll position per prayer and find state per prayer — memory only, lost on quit — prayerScroll.ts:3; useFindReplace.ts:55
- [ ] Preference reads/writes are best-effort (try/catch, silently ignore corrupt or unavailable storage); malformed entries are filtered — appearancePrefs.ts:18-47; recentLibraries.ts:21-42
- [ ] Storage is per machine/user profile; nothing syncs; no settings file other than the above — (design)
- [ ] Per-prayer prefs are not cleaned up on delete except the column view (`removePrayerView`); export prefs stay — operations.ts:669; exportPrefs.ts

## 19. Notifications, warnings and error messages (user-visible strings to keep)

- [ ] "Could not open library", "Example library", "Could not create library", "Could not open prayer", "Cannot save", "Cannot save all", "Cannot create", "Create failed", "Delete failed", "Export failed", "Cannot export — Prayer is invalid.", "Import failed", "Cannot import", "Id collision", "Invalid JSON", "Duplicate prayer ids", "Library styles cleaned", "Could not save library settings", "Cannot save app styles", "Cannot save library styles", "Kind rename failed" — session/operations.ts, prayerFileIo.ts, usePrayerSession.ts
- [ ] Success toasts: "Saved", "Created", "Deleted", "Exported", "Imported", "Library created", "Library updated", "Kind renamed" — same files
- [ ] Error toasts are accent-coloured, success toasts dark; auto-close is the Mantine default (4 s) unless a notice sets it (6-8 s for the duplicate-id, styles-cleaned and desktop-required notices) — session/operations.ts:48-54, 144-163; App.tsx:41-49
- [ ] Export of a prayer not in memory validates the disk file first ("Cannot export — Prayer is invalid.") — operations.ts:818-835
- [ ] Failed style persistence for app styles throws unhandled (no try/catch around `writeAppStyles`/`writeLibraryStyles`) — operations.ts:756, 782

## 20. Security and platform plumbing worth preserving

- [ ] Renderer sandbox: contextIsolation on, nodeIntegration off, preload exposes a typed `prayerToolkit` API — main.ts:111-116; preload.ts:68-144
- [ ] Reveal/open-folder only for paths from export dialogs or inside open libraries — main.ts:77-88
- [ ] `fs:readTexts` limited to 100 paths per call — main.ts:233-253
- [ ] Packaged as dmg+zip (macOS x64/arm64, ad-hoc signed), NSIS/AppImage etc. for Win/Linux, artifact names without spaces — packages/app/electron-builder.yml; docs/RELEASE.md

---

## Things that surprised me

1. **The app-level `kind-styles.json` (in Electron `userData`) is effectively dead.** It is read at startup (`usePrayerSession.ts:200-214`), kept in session state, rewritten on kind rename/remove, but `resolveStyles` is only ever called with `libraryOverrides` (`usePrayerSession.ts:221-224`), never `appDefaults`. The Kind styles panel also writes only to the library's `styles.json` (`KindStylesPanel.tsx:60-74`; `docs/library.md` says "The editor writes styles only to this library file"). For the map's "adopt Kind styles from Electron automatically" rule this means the real Kind styles already live inside each Library folder and carry over for free; there is nothing meaningful to migrate from `userData`. `onChangeApp` plumbing (`App.tsx:320`, `PrayerSettingsModal.tsx:138`, `InlineEditor.tsx:1101`) can be dropped.
2. **All preferences are browser `localStorage`, not files.** Colour scheme, sidebar state, Recent libraries, per-prayer columns and per-prayer export prefs sit in Chromium's profile for the Electron app. A fresh GPUI install starts empty on all of these (consistent with "Rest frisch"), but note that Recent libraries will be empty too.
3. **Draft validation errors are never shown while editing.** `draftErrors` feed only the Invalid prayer screen and the sidebar "!" badge. If a draft becomes invalid (for example two variants with the same lang/edition, empty required field) the user only learns this when Save fails with the generic toast "fix validation errors first"; there is no list of what is wrong. A GPUI port could do better here.
4. **Update "Install and Restart" skips the Unsaved changes dialog.** `allowWindowsToClose()` removes all close listeners first (`main.ts:570-577`), so a dirty Session draft is lost on update install. Worth deciding whether to keep or fix.
5. **Windows and Linux have no menu bar at all** (`Menu.setApplicationMenu(null)`, `main.ts:754-759`). Find is reachable only via the header icon and Ctrl+F; Check for Updates only via App settings. The Help menu items for those platforms in the template are dead code, and so is File > Quit.
6. **The menu "Find…"/"Find Next" items duplicate renderer shortcuts.** On macOS Cmd+F is both a menu accelerator and a window `keydown` handler, so the IPC path and the DOM path both exist; porting needs just one.
7. **No Save shortcut.** There is no Ctrl/Cmd+S (or Ctrl/Cmd+N/O) anywhere; Save is only the header button or Save all in the dialog.
8. **Switching prayers never prompts**, because dirty Session drafts accumulate in memory across switches (list shows dots). The prompt appears only for close, Refresh and library switch. Consequently "Save all" can write several files, and a rename collision in one aborts the rest ("Cannot save all").
9. **Rename-by-id is write-new-then-delete-old** (`persistPrayer.ts:39-42`), not an atomic rename; the `fs:rename` IPC exists (`main.ts:274-291`) but the UI never calls it. If the delete fails the prayer exists twice.
10. **`filenameMismatch` and `scanned` on catalog entries are computed but never rendered.** A file whose `id` does not match its filename is not flagged in the UI; the list shows the id from the content. Duplicate ids are flagged (toast + sidebar alert).
11. **Kind rename writes other prayers' files immediately** (confirm dialog says "This writes those files now"), bypassing the dirty/Save model; open drafts are renamed in memory instead. Files that fail are skipped and reported only as "· N skipped" with no per-file detail.
12. **Removing a variant leaves its translations in the blocks** (only `variants` is filtered, `LanguagesPanel.tsx:60-64`), and Core validation has no check for orphans, so the JSON keeps unreachable translation entries.
13. **Export modal closes even if the user cancels the OS save dialog** (`savedPath === null` is not `false`, `ExportModal.tsx:245-247`), and it exports unsaved draft content, not what is on disk.
14. **The "Delete kind?" message branch for `verse` (becomes annotation) is unreachable** from the UI because presets cannot be deleted (`KindSelect.tsx:402-406`); Core's `deleteKind` still has that fallback.
15. **Library menu items are the only route to App settings, Library settings, Import and Refresh**; there is no keyboard path or menu bar entry for them.
16. **New library is a two-step flow** (modal collects name/manifest, then the OS folder picker chooses the parent); the default variant "de"/"standard" is prefilled, and New prayer is also hard-coded to de/standard with title "Unbenannt" (German placeholder in an English UI).
17. **A "Reveal in folder" IPC exists (`shell:showItem`) with allow-listing but no UI calls it**, and `clearSelection`/`clearEditor` in the session hook are unused; candidates for omission rather than parity.
18. **Startup update check is deferred 5 s and silent on failure; the App settings modal triggers its own check every time it opens**, so opening settings on a flaky network shows an error line even though startup was silent.
19. **Dev-only behaviour to ignore:** examples library auto-open, global Ctrl/Cmd+Shift+I DevTools shortcut, and the whole browser-dev (Vite FS bridge) mode with its "Desktop app required" toast are not product features.
