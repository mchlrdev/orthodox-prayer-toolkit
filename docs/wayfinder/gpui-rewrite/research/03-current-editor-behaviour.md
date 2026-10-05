# 03 - Current editor behaviour (Electron inline editor)

Ticket: `docs/wayfinder/gpui-rewrite/issues/03-current-editor-behaviour.md`. Branch `rewrite/gpui`.
Vocabulary follows `docs/glossary.md` (Library, Block, Kind, Variant, Session draft).

Paths are relative to `packages/app/` unless noted. All citations were read from source in this session; nothing here is from docs or memory.
Abbreviations: `IE` = `src/components/InlineEditor.tsx`, `DOM` = `src/inlineDom.ts`, `PE` = `src/prayerEdit/`, `UPS` = `src/usePrayerSession.ts`, `OPS` = `src/session/operations.ts`, `PW` = `src/components/PrayerWorkspace.tsx`, `FR` = `src/findReplace/`.

## Summary

- The editor is **one `contenteditable` per (Block, Variant) cell**, not one document. The browser owns caret, selection, typing, IME, native undo and clipboard-copy. React code only intercepts Enter, Shift+Enter, Backspace-in-empty-cell, paste, and Cmd/Ctrl+Shift+M (IE:528-612). A GPUI rewrite must therefore re-implement everything the browser gave for free; this spec lists only what the code adds or constrains.
- **Commit is blur-based, not debounced.** DOM text is serialized and written to the Session draft on blur (only if touched and different), on Enter-split, on note toggle, and on every keystroke only for heading/subheading cells in the first visible column (IE:448-460, 585-594, 1165-1172). Validation of the draft is debounced 500 ms after each edit (`session/draftEdit.ts:13`, UPS:118-130). No Library write happens until Save.
- **Block structure ops are Enter (split Block at caret, new Block inherits the Kind, only the active Variant's text moves), Backspace in a fully-empty cell (delete Block, focus previous), Add / Move / Delete buttons, and Kind change that reshapes `lines` <-> `text` for every Variant.** There is **no merge** of Blocks (Backspace/Delete at a non-empty boundary is native browser behaviour inside the cell only) and **no cross-Block caret navigation code**.
- **There is no app-level undo/redo.** Undo/redo is the browser's per-cell native stack via Electron Edit-menu roles (`electron/main.ts:793-794`), which is reset whenever the cell DOM is re-rendered (Enter, note toggle, blur sync). Structural edits (split, delete, move, kind change, replace) cannot be undone except by discarding the whole Session draft (IE:1224, OPS:501-521).
- **Inline `note` runs are the only rich text.** Paste is forced to plain text (IE:595-612), serialization discards every tag except note spans and line breaks (DOM:72-133), and runs are normalized (whitespace peeled out of notes, adjacent notes merged, zero-width chars stripped) in Core `normalizeRuns` (`packages/core/src/textRuns.ts:45-106`). Find/replace highlights are computed from the stored Prayer (not the live DOM) and painted with the CSS Custom Highlight API, so they go stale for a focused, uncommitted cell.

## Data model the editor edits

- **Session draft** (`src/session/types.ts:81-86`): `{ prayer, errors, visibleVariants, dirty }`. The editor receives `prayer` and `visibleVariants` as props and emits whole new `Prayer` objects via `onChange` (IE:76-83). `PrayerWorkspace` passes `session.updateDraft` straight through (src/App.tsx:328, 429; PW:345-353).
- **Block** `{ id, kind, translations[] }`; a translation is `{ lang, variant, text? | lines? }` (PE/structure.ts:25, PE/translations.ts:91-116). Block ids are `b{structure.length+1}-{Date.now() base36}` (PE/structure.ts:9-14).
- **Kind decides the payload shape.** `usesLines(kind)` is true only for `verse` (PE/translations.ts:12-14). Verse stores `lines: InlineContent[]` and is "line mode" in the editor; every other Kind (rubric, heading, subheading, annotation, custom) stores `text: InlineContent` (IE:1030).
- **InlineContent** = `string | TextRun[]`, `TextRun = { t: "text" | "note", v }` (core textRuns.ts:2-8). Packed form is a plain string when there are no notes, else a normalized run array (textRuns.ts:112-119).
- **Read-side fallbacks** (PE/translations.ts:22-37): verse with only `text` shows one line `[text]`; verse with no content shows `[]`; non-verse with only `lines` shows the single line (runs kept) or the lines joined by `"\n"` (runs flattened to plain text); missing translation shows `""`.
- **Empty = omitted.** A cell that serializes to nothing removes that Variant's translation entry (`setTranslation(..., null)` at PE/translations.ts:104-106; PE/commitContent.ts:107-120, 138). No empty translation keys are ever written (matches AGENTS.md rule 4).
- **Variant columns**: `visibleVariants: ActiveVariant[]` (`{lang, variant}`) lives in the Session draft, not the Prayer (types.ts:84). First entry is the **primary** column. It is reconciled against `prayer.variants` on every edit (`session/draftEdit.ts:21-25`, `src/variant.ts:22-36`) and persisted per Prayer path (`savePrayerView`, UPS:134-140; restored in `session/visibleVariants.ts:60-72`).
- **Per-cell transient state** (not in the draft): `dirtyRef`, `skipBlurCommitRef`, `skipSyncOnBlurRef`, `focused`, `domEmpty`, `toolbar` (IE:242-264). Editor-wide: `kindUiBlockId`, `pendingDeleteIndex`, `jumpTargetId`, `lastAddedKind` (default `"verse"`), `focusedIdRef` (IE:678-687).

## Interaction table (action -> behaviour -> source)

### Typing, focus, selection

| Action | Behaviour | Source |
|---|---|---|
| Type / IME input / native edit | Browser edits the cell DOM. `onInput` marks the cell dirty, refreshes the empty/placeholder flag and the note toolbar. No commit unless `liveCommit` (see below). | IE:585-594 |
| Placeholder | Shown via `data-empty` + CSS `::before` with the Kind's display label. Empty = `innerText` minus NBSP/newlines/whitespace is `""` (whitespace-only counts as empty). | IE:117-122, 479, 614, 1161; src/styles.css:1665-1670 |
| Initial cap | `::first-letter` accent colour only when Kind style `initialCap === "true"` and cell not empty. | IE:1164; styles.css:1673-1675 |
| Whitespace rendering | `white-space: pre-wrap`, so `"\n"` renders as a line break. Line mode renders lines joined by `"\n"` text nodes; notes are `<span data-role="note" class="inline-note">`. | styles.css:1657; DOM:20-50 |
| Click on an empty cell | `mousedown` is prevented and the cell is focused with the caret placed from the click point (falls back to end). | IE:489-496, 144-181, 463-470 |
| Click inside a focused cell | If selection is not already inside, caret placed from point; toolbar refreshed next frame. | IE:497-504 |
| Focus an empty cell | Caret forced to end on next frame if selection is not inside. | IE:517-525 |
| Mousedown on a Block's padding / gap (not chrome, not cell, not toolbar, not dialog/popover) | Prevented; focuses the `.inline-content` of the column under `clientX` (first column if none) and places the caret from the point. | IE:1046-1075 |
| Focus tracking | `focusedIdRef` = last focused Block id; cleared on blur unless the Kind UI of that Block is open. Used only by "jump to next empty". | IE:739-750, 951-953 |
| Caret / selection offsets | Plain-text offsets measured with `Range.toString().length` from the cell start; `"\n"` counts 1; notes are transparent. Selection must be fully inside the cell, else `null`. | DOM:135-159 |
| Arrow keys, Home/End, Tab, Cmd+A, drag-select | **Not handled.** Native browser behaviour only; no code moves the caret between cells/Blocks. | grep of IE: no handlers beyond those listed |

### Enter, Shift+Enter, Backspace, Delete

| Action | Behaviour | Source |
|---|---|---|
| Enter (no modifiers, not composing) | Splits the **Block** at the caret/selection in the **active Variant column only**: reads the cell, `splitEditorContent(content, selStart, selEnd, lineMode)` (selection range is dropped), writes `before` into this cell's DOM, then `onInsertBelow(before, after)`. Missing selection offsets = split at end. | IE:551-584; PE/splitContent.ts:48-115 |
| What `splitBlock` does | Commits `before` into the original Block's translation for this Variant (empty `before` removes that translation), inserts a **new Block directly after** with the **same Kind** and empty `translations`, then commits `after` into it (skipped when `after` is `null`). Other Variants' text **stays on the original Block**; the new Block has no translations for them. | PE/structure.ts:30-69 |
| After split | `lastAddedKind` = current Kind. New id from `createBlockId`. After `setTimeout(0)`, focus the new Block in the same column: caret at **start** if `after !== null`, else at **end**; smooth scroll to centre; 900 ms flash. | IE:886-906, 756-831, 100 |
| Split semantics, text Kinds | `splitInline` on plain offsets; clamps offsets; empty sides become `null`; note runs are cut across the boundary. Multi-line input to a text Kind is first joined with `"\n"`. | core textRuns.ts:277-308; PE/splitContent.ts:61-67 |
| Split semantics, verse | Maps offsets to `(lineIndex, local)`; same-line split cuts the line; cross-line selection keeps the start line's head and the end line's tail; lines before/after go to `before`/`after`. Empty sides `null`. Tested: `["Herr,","erbarme dich."]` split at 6 gives `["Herr,"]` / `["erbarme dich."]`. | PE/splitContent.ts:74-114; tests/prayerEdit.test.ts:197-238 |
| Enter at start of cell | `before` is `null`, so this Variant's translation on the original Block is removed and all text moves to the new Block (other Variants stay on the original). Derived from the above; not separately tested. | PE/structure.ts:40-45, 64-68 |
| Shift+Enter | Prevented; `execCommand("insertText", "\n")`; marks dirty. In a verse cell this starts a new **line**; in a text cell it inserts `"\n"` inside the text. Ignored while composing. | IE:552-560 |
| Enter with Alt/Ctrl/Meta | Not handled; browser default (likely inserts a `<div>`/`<br>`, which the serializer handles as a line break). | IE:562; DOM:93-114 |
| Backspace in an **empty** cell (no modifiers, not composing) | Prevented; sets `skipBlurCommit`; calls `onDeleteAtStart`. Note "empty" is whitespace-tolerant (`isDomEmpty`), so Backspace in a whitespace-only cell also deletes the Block. | IE:539-549, 117-122 |
| Delete-Block decision for that Backspace | `isBlockEmptyAcrossVariants(treatAsEmpty = this column)`: empty here and in all other **declared** Variants (`prayer.variants`, not just visible) and more than one Block exist -> `removeBlock`, then focus the **previous** Block (else next) in the same column, caret at end. If other Variants still have text, or it is the only Block, Backspace does **nothing** (swallowed). | IE:833-866, 908-924; PE/translations.ts:136-156 |
| Backspace / Delete in non-empty cell | Native only. **No merge with previous/next Block, no merge across Variants.** | IE:539-549 (returns early only when empty) |
| Trash button | `requestDeleteBlock(index)` without `treatAsEmpty`: empty across all Variants and >1 Blocks -> immediate delete (focus prev/next); otherwise opens a confirm dialog "Delete block?" (also for the sole Block). Confirm calls `removeBlock`. Dialog text says "You can undo by not saving." | IE:1133-1141, 833-864, 1220-1230 |

### Pasting, clipboard, drag

| Action | Behaviour | Source |
|---|---|---|
| Paste (any content) | `preventDefault`; takes only `text/plain`; if empty, nothing happens (rich-only/image clipboards are dropped). Inserted via `execCommand("insertText")` (so it joins the native undo stack and replaces the selection); fallback: manual `deleteContents` + text node + caret after. Marks dirty. HTML/RTF formatting is **never** inserted. | IE:595-612 |
| Newlines in pasted text | Inserted as-is; the serializer splits on `"\n"`, `<br>`, and `<div>/<p>` (blank lines are dropped on serialization). Exact DOM that Chromium builds from `insertText` with `\n` is not verified here (see Open questions). | DOM:79-117 |
| Copy / cut | No handlers; browser default. | grep of IE |
| Drag-drop of text/HTML into a cell | No handler; browser default (unverified). | grep of IE |
| Cmd/Ctrl+B / I / U | Not intercepted. Native `contenteditable` may wrap text in `<b>/<i>/<u>`; the serializer ignores tags (recurses into children) so the formatting disappears on the next commit/re-render. Inferred from code, not run. | DOM:116 |

### Inline notes (the only inline formatting)

| Action | Behaviour | Source |
|---|---|---|
| Cmd/Ctrl+Shift+M | `applyToggleNote()`. Needs a stored non-collapsed toolbar selection (`toolbar.start !== end`); with a collapsed caret it is a no-op (but the cell is still marked dirty). | IE:529-537, 390-394 |
| Toolbar button | Appears above any non-collapsed selection inside the focused cell (`onSelect`/`onKeyUp`/click), toggles on `mousedown` (so blur cannot clear it first), `aria-pressed` = selection overlaps a note. Blur to the toolbar does not commit or clear. | IE:318-347, 432-436, 617-661 |
| Hover toolbar | Hovering a note span shows the "remove note" toolbar (active) unless a real non-note text selection exists; hides 280 ms after the pointer leaves (cancelled when entering the toolbar). | IE:349-388, 264-281, 506-516 |
| Toggle result, text Kinds | `toggleNoteRange(inline, start, end)`: range is whitespace-trimmed; if it **overlaps any note run** all overlapped note runs become text; else the range becomes a note. DOM re-rendered from result, `onCommit` immediately (null if plain text empty), caret refocused, dirty cleared. | IE:413-429; core textRuns.ts:239-271 |
| Toggle result, verse | Offsets mapped to a line; **selection spanning more than one line is ignored** (toolbar cleared, nothing changes). Otherwise toggles within that line, re-renders, commits. | IE:396-412; DOM:226-249 |

### Block-level controls and Kind

| Action | Behaviour | Source |
|---|---|---|
| Kind trigger click | Mounts a `KindSelect` popover (`defaultOpen`) for that Block only (`kindUiBlockId`); unmounts when popover and edit modal are both closed (`onIdle`). Chrome (Kind + move/delete) is shown on hover or while this menu is open. | IE:1077-1111, 752-754; KindSelect.tsx:132-142; styles.css:1645-1649 |
| Change Kind | `setBlockKind(prayer, index, kind)`. Same payload shape (`lines` vs `text` unchanged): only `kind` changes. Shape change (verse <-> other): **every translation of the Block (all Variants, not only visible)** is re-committed under the new Kind. Verse -> text joins lines with `"\n"` (a single line keeps its runs); text -> verse becomes one line (a text containing `"\n"` is stored as **one** line containing `"\n"`, not split, until edited and blurred); empty -> translation removed. Old payload field is dropped. | PE/structure.ts:93-122; PE/commitContent.ts:35-62; PE/translations.ts:22-37; tests/prayerEdit.test.ts:240-325 |
| Pick / add custom Kind | Add: sanitized id must be valid; custom Kind style is ensured in library styles, then `onChange(kind)`. | KindSelect.tsx:159-174 |
| Rename Kind | Delegated to `onRenameKind` (Library-wide, handled in session layer, not in the editor). Presets cannot be renamed. | IE:1090-1092; PE/translations.ts:60-78 |
| Delete custom Kind | `deleteKindWithStyles`: Blocks of that Kind are reassigned to `verse` (or `annotation` if deleting `verse`) **without reshaping payloads** (read-side fallbacks cover it); style keys dropped from app and library maps. Presets cannot be deleted. | IE:1093-1103; PE/styles.ts:58-72; core indexKinds.ts:64-76 |
| Kind styling | `styleToCss`: fontSize, colour, weight, style, textAlign (only `center`/`justify` honoured, else left). Unknown Kind uses `FALLBACK_KIND_STYLE`. `indicate: "true"` sets `data-indicate` on the Block. Notes colour = `styles.annotation.color`. | IE:102-115, 696-710, 1040-1042 |
| Add Block | Appends at the end with `lastAddedKind` (initial `verse`) and empty translations; focuses the first visible column. Menu next to it picks another Kind (sets `lastAddedKind`). | IE:959-967, 1187-1218; PE/structure.ts:16-28 |
| Move up / down | Swaps with the neighbour; buttons disabled at the ends. No focus change. | IE:969-971, 1113-1132; PE/structure.ts:71-83 |
| Outline jump (not editor-internal) | `revealBlock(blockId, {scroll: "instant-start", focusCol: null, flash: true})` scrolls under the sticky column labels and flashes; no focus. | src/App.tsx:96-103; IE:756-815 |

### Multiple Variants / languages

| Action | Behaviour | Source |
|---|---|---|
| Layout | One `.split-row` per Block with one `.split-cell` (one editable) per visible Variant; CSS var `--split-count`; column rules and sticky column labels only when more than one column is visible. Each cell has its own `contenteditable`, caret, dirty flag, native undo stack. | IE:975-1027, 1145-1181 |
| Column label | Language, variant, and a fill percentage button: `filled/total` Blocks with non-whitespace content in that Variant; click jumps to the next empty Block for that column (wraps; starts after the focused Block) and focuses it. Disabled when complete or no Blocks. | IE:996-1022, 945-957; PE/translations.ts:118-133, 158-172 |
| Add / replace / remove / show-all column | Add appends (no duplicates). Replace swaps if the chosen Variant is already visible elsewhere, else substitutes. Remove is blocked at one column. "Show all" lists every `prayer.variants` entry in declaration order. Changes go to the Session draft **without** marking it dirty and without Prayer change. | PW:124-152, 232-293; OPS:241-256 |
| `setActiveVariant` | Moves a Variant to the front (primary). | OPS:258-268 |
| Primary column roles | Header title (`resolveDisplayTitle`), outline labels (primary column only), `liveCommit` for headings, default focus for Add Block / fallback focus after delete. | PW:154; PE/outline.ts:31-41, 44-75; IE:849-852, 960-965, 1165-1172 |
| Typing in one column | Only that Variant's translation changes. Enter splits only that column (other Variants stay on the original Block); Backspace-delete is gated on **all declared** Variants being empty. | see Enter/Backspace rows |

### Find and replace interplay

| Action | Behaviour | Source |
|---|---|---|
| Open / close | Cmd/Ctrl+F toggles; Cmd/Ctrl+Alt+F opens with replace expanded; Escape closes; Cmd/Ctrl+G, F3 next, with Shift previous; Enter / Shift+Enter in the panel inputs next/prev. Electron menu Find / Find Next send IPC. Selection text inside `.workspace-body` seeds the query. State persists per Prayer path (in memory only). | FR/useFindReplace.ts:121-147, 195-261, 55-79; electron/main.ts:800-810 |
| Matching | Over the **stored Prayer** (not the DOM), **visible columns only**, per Block x column on `editorPlainText` (lines joined by `"\n"`). Case-insensitive via `toLocaleLowerCase` unless `matchCase`; whole-word treats letters, digits, `_` and `'` as word chars. Empty query = no matches. Query debounced 150 ms. | PE/findReplace.ts:32-111; FR/useFindReplace.ts:81-96 |
| Highlighting | CSS Custom Highlight API (`find-match`, `find-match-current`); ranges rebuilt from plain offsets over the cell's text nodes (`createRangeFromOffsets`), painted on `requestAnimationFrame` and re-painted by a `MutationObserver` on the workspace body (childList + characterData) whenever the DOM changes. Cleared on close/unsupported/empty. | FR/highlights.ts:9-60; FR/useFindReplaceHighlights.ts:326-371; DOM:251-292; styles.css:1138-1145 |
| Scroll to current match | Adjusts `scrollTop` by 20 px margin; no focus change. | FR/highlights.ts:280-308 |
| Replace current | `replaceRangeInInline` on stored content; replacement inherits note/text role when the range lies within one run, else text. Verse: single-line match replaces within the line (line removed if it becomes empty); **cross-line match flattens the whole cell to plain text lines, losing notes**. Result passes through `applyCommittedContent` (unchanged = same reference, no dirty). One `onChange` per replacement. | PE/findReplace.ts:113-195; core textRuns.ts:315+; tests/findReplace.test.ts:100-119 |
| Replace all | Confirm dialog (count, Block count), then replaces all matches in descending Block order then descending offset, in one `onChange`. | FR/useFindReplace.ts:175-193; PE/findReplace.ts:197-223; PW:357-368 |
| Interplay with a focused cell | The focused cell is never re-rendered from props (see Commit flow), and highlights use stored offsets, so an uncommitted edit makes highlights stale until blur (heading/subheading in primary column commit live, so they stay in sync). Typing into the find input blurs the cell, which commits first. | IE:295-302, 1165-1172; FR/useFindReplace.ts:135 |

## Commit/save flow

1. **DOM -> content.** `serializeEditable` walks the cell: text nodes split on `"\n"`, `<br>` and block-level `<div>/<p>` (not the root) start a new line, note spans become `note` runs, NBSP becomes a space, all other tags are descended without trace. Each line is `normalizeRuns` + `packInline`; **empty lines are dropped**. Verse returns `InlineContent[] | null`; text kinds return the single line or lines joined with `"\n"` (runs preserved) or `null` (DOM:72-133).
2. **When it commits** (cell -> `onCommit` -> `applyCommittedContent(prayer, blockId, col, content)` -> `onChange`; IE:873-884):
   - **Blur**: only if the cell was touched since the last sync, the focus target is not the note toolbar, and `skipBlurCommit` is not set; also skipped when `editorCommitUnchanged` says the serialization equals the stored props (IE:432-461).
   - **Enter-split**: immediately, via `splitBlock` (see above).
   - **Note toggle**: immediately.
   - **`liveCommit` (every `input`)**: only for Kind `heading` or `subheading` in the **first visible column**, so the Content outline updates live (IE:231, 585-594, 1165-1172).
   - **Replace / replace-all / Kind change / add / move / delete**: immediately, no DOM involvement.
   - **Not on a timer, not on selection change, not on focus move between cells except via blur.**
3. **No-op detection.** `committedContentUnchanged` canonicalizes both sides (packed runs; lines compared pairwise; whitespace-only text counts as empty) and returns the **same Prayer reference** when nothing changed (PE/commitContent.ts:14-105, 134-136). `editDraft` ignores `next === current.prayer` (OPS:222-232), so nothing becomes dirty.
4. **Normalization on write.** Verse: lines with zero length are filtered; empty list -> translation removed. Text: whitespace-only string -> removed; run array with empty plain text -> removed; multi-part -> single part or `"\n"`-joined plain text (PE/commitContent.ts:35-62, 107-120).
5. **Session draft update.** `updateDraft` -> `editDraft` -> `applyDraftEdit`: new draft `{ prayer: next, errors: previousErrors, visibleVariants: reconciled, dirty: true }` (`session/draftEdit.ts:16-32`; UPS:387-393). State is written synchronously to `stateRef` and React state (UPS:99-107). Then `scheduleDraftValidation(path)` clears any pending timer and re-arms a **500 ms** debounce that re-runs Core `validate` and replaces `errors` (UPS:118-130; draftEdit.ts:13, 34-37). Prior errors stay visible until it fires.
6. **Draft -> cells.** Props flow back; a cell re-renders its DOM from props (`renderEditable`) in an effect keyed on `contentKey(content)`, `lineMode`, `focused`, **only while not focused** (IE:287-302). Blur of an untouched cell sets `skipSyncOnBlur` so it is not rewritten. Net effect: a focused cell is the source of truth for its own text until blur; after blur the Prayer is.
7. **Dirty/save.** `dirty` shows an "Unsaved" badge and enables Save (PW:173-221). The Save button blurs the focused cell first, so the cell commits before `saveDraft` runs; **there is no Cmd/Ctrl+S binding** (no accelerator in `electron/main.ts`, none in App/UPS). `saveDraft` cancels the pending validation, then `saveSelected` validates synchronously, writes via `persistPrayer`, and clears dirty (UPS:408-415; OPS:399-443). Closing/leaving with dirty drafts prompts (UPS:597-606, 612-615). Discard drops dirty drafts and re-reads from disk (OPS:501-521).
8. **View state** (`visibleVariants`) is saved per Prayer path on leave/switch via `persistCurrentView`, independent of dirty (UPS:134-140, 353).

## Edge cases

- **Stuck `skipBlurCommit`.** The flag is set before Enter/Backspace handlers run (IE:546, 566). If the handler then returns early (Block id not found IE:892-893; Backspace in the sole or still-filled-elsewhere Block IE:861), the flag is not reset, so the **next real blur of that cell skips its commit** (typed text since is lost unless dirty state is later re-triggered). Candidate bug; the GPUI version should not copy it.
- **Backspace swallowed in an empty cell** when other Variants have text or it is the only Block: `preventDefault` still runs, so the user cannot delete the (empty) char/selection natively either; nothing happens (IE:545, 861).
- **Whitespace-only cell counts as empty** for placeholder and Backspace-delete (IE:117-122), but a whitespace-only **verse line** is not dropped on commit (`plainText(l).length > 0` filter, PE/commitContent.ts:45) while a whitespace-only **text** string is (commitContent.ts:53). `packInline` keeps whitespace text, so `"  "` is stored for verse.
- **Blank lines cannot exist.** Serialization drops empty lines (DOM:62-66), so double Shift+Enter collapses and a trailing/leading newline disappears on commit.
- **Note normalization**: whitespace at the edges of a note moves to adjacent text; two notes separated only by whitespace merge into one note containing the whitespace; zero-width chars (U+200B/C/D, U+FEFF) removed; NBSP -> space (core textRuns.ts:45-106; DOM:81, 99).
- **Note toggle with caret only** is a no-op but still sets `dirtyRef` (IE:393-395). A toggle range that trims to empty returns content unchanged (textRuns.ts:246-249).
- **Note toggle across verse lines** is silently ignored (IE:401-404).
- **Replace across lines in verse** loses all inline notes in that cell (PE/findReplace.ts:167-170). Replacing text so a line becomes empty deletes the line (findReplace.ts:124-125). Replacing in an empty verse with a multi-line string splits it into lines (findReplace.ts:149-151).
- **Text Kind containing `"\n"` changed to verse** is stored as a single line containing a newline (see Kind row); render looks right, storage differs until the cell is edited.
- **Kind change on a Block with extra translations** (e.g. leftover `lines` on a text Kind): handled by `translationEditorContent` fallbacks and by re-committing every translation (PE/translations.ts:22-37; structure.ts:110-122).
- **Enter with no selection info** (selection outside the cell): treated as split at end (`+Infinity`) (IE:571-572).
- **IME**: Enter, Shift+Enter and Backspace handlers return early while `isComposing` (IE:540, 552).
- **Enter / Backspace with Alt/Ctrl/Meta** fall through to native (IE:541, 562).
- **Focus after delete** uses `setTimeout(0)` and prefers the previous Block, else next, in the column that triggered it (IE:847-857).
- **Handlers are cached per cell** (`getCommitHandler` etc.) and read the latest Prayer via `ctxRef`, so closures never use stale `prayer`; stale entries are pruned when structure/columns change (IE:712-737, 873-943).
- **Draft with errors still edits**: validation is advisory in the editor; stale `errors` are kept until the debounce fires (draftEdit.ts:15-32).
- **Fill percent on empty prayer** is 100% (translations.ts:163); button disabled when `total === 0`.
- **Test coverage**: vitest runs in plain Node (`vitest.config.ts`), so `InlineEditor.tsx` and `inlineDom.ts` have **no tests**. Covered pure logic: `applyCommittedContent`, `editorCommitUnchanged`, structure ops incl. split/kind change, kind helpers, fill helpers (tests/prayerEdit.test.ts), find/replace (tests/findReplace.test.ts), `applyDraftEdit` and session ops (tests/session.test.ts), outline (tests/outline.test.ts); note math in `packages/core/tests/textRuns.test.ts`.

## Open questions

1. **Native-behaviour inventory.** Which browser-provided behaviours are part of the spec to match: word/line navigation, double/triple-click selection, drag-drop of text between cells, Cmd+B/I/U (see above), spellcheck, autocorrect, Cmd+Z granularity across IME? The code does not say; Chromium behaviour must be observed in the running app.
2. **Pasted newlines.** What DOM does `execCommand("insertText", "a\nb")` produce in a `white-space: pre-wrap` contenteditable here (text node with `\n`, or `<div>/<br>`)? Serializer handles all, but intent (one verse line per pasted line vs one Block) is implied only. Should pasted newlines in text Kinds be preserved or flattened?
3. **Undo.** Is the lack of an app-level undo intended for the rewrite? Native per-cell undo is reset on re-render (Enter, note toggle, blur sync) and does not cover structure ops; the delete dialog tells users to "undo by not saving" (IE:1224). The rewrite needs an explicit decision (cell-local only, per-draft history, or none).
4. **Merge blocks.** Backspace at the start of a non-empty Block and Delete at the end do not merge (no code). Is that a deliberate product choice or a gap to close? Related: should Enter-split of a multi-Variant Block move the same offset in other Variants (currently they stay on the original Block)?
5. **`skipBlurCommit` leak** (Edge cases): confirm by reproduction and decide whether the rewrite should fix it (recommended).
6. **Save shortcut.** No Cmd/Ctrl+S found anywhere in `src/` or `electron/main.ts`; verify there is truly none (e.g. a menu role outside the grep), since the rewrite will need one.
7. **`liveCommit` scope.** Only heading/subheading in the **first** column; edits to those Kinds in other columns commit on blur. Intentional (outline reads the primary column only, PE/outline.ts:31-41) but not documented.
8. **Highlight staleness** while a cell is focused with uncommitted text (find uses the stored Prayer). Acceptable in the rewrite, or should find operate on live buffers?
9. **Kind deletion** reassigns to `verse` without reshaping (relies on read-side fallbacks). Keep this lazy migration or reshape eagerly?
