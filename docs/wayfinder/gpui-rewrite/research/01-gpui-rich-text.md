# 01 - GPUI rich-text editing: what exists, what we build

Ticket: `docs/wayfinder/gpui-rewrite/issues/01-gpui-rich-text.md`. Version under study: `gpui-kit` 0.7.1 (Cargo.lock), which pulls `gpui-pre` 0.3.8, `gpui-base` 0.7.1, `gpui-component` 0.7.1. Paths below are relative to `~/.cargo/registry/src/*/` unless they are URLs. Nothing here was compiled; every claim comes from reading source.

## Summary

- **Styled layout exists and is good.** GPUI shapes text with per-range `TextRun { len, font(family, weight, style), color, background_color, underline, strikethrough }` via `WindowTextSystem::shape_line` / `shape_text` (wrapped), and exposes hit-testing (`x_for_index`, `index_for_position`). Family, weight, italic and color per run are covered.
- **Per-run font size is NOT supported.** `font_size` is one argument per shaped line, not part of `TextRun` or `HighlightStyle`. Mixed sizes in one line need us to split into separately shaped fragments and do our own line-box/baseline layout.
- **Cursor, selection, IME, clipboard and undo are not built into GPUI.** GPUI gives only the platform seam (`EntityInputHandler`/`InputHandler`, `Window::handle_input`, clipboard API). The finished editing engine (rope, multi-cursor, undo, IME, copy/paste, wrapping) lives in `gpui-base`'s `Input`/`Textarea`/`Editor`, but it is a plain-text engine.
- **gpui-component's editor supports per-range styling only as overlay highlights.** `EditorState::create_decorations_collection` takes `(byte range, HighlightStyle)` and tracks ranges across edits, but `HighlightStyle` has color, weight, italic, background, underline, strikethrough and fade only. No family and no size. Typing at a range edge does not extend the range. Undo does not restore styles. Clipboard is text only.
- **Zed's editor is not reusable.** `editor`, `text`, `rope` and `multi_buffer` are GPL-3.0 and unpublished. GPUI itself (and `sum_tree`) is Apache-2.0 and usable. Zed's editor also uses one font size per editor with highlights as overlays, so it is a pattern to copy, not code to take. We must build a styled-run document model plus an input element ourselves, on top of GPUI text layout and `EntityInputHandler`.

## Building blocks available (with sources)

### GPUI core (`gpui-pre` 0.3.8, Apache-2.0, repository zed-industries/zed)

- **`TextRun`**: `gpui-pre-0.3.8/src/text_system.rs:1228`. `len` is UTF-8 bytes; fields `font: Font`, `color`, `background_color`, `underline`, `strikethrough`. `Font` has `family`, `features`, `fallbacks`, `weight`, `style` (`text_system.rs:1292`). Same shape upstream: https://github.com/zed-industries/zed/blob/main/crates/gpui/src/text_system.rs
- **Shaping**: `shape_line(text, font_size, &[TextRun], force_width) -> ShapedLine` (`text_system.rs:638`, single line, debug-asserts no `\n`) and `shape_text(text, font_size, runs, wrap_width, line_clamp) -> SmallVec<[WrappedLine;1]>` (`text_system.rs:750`, handles newlines and soft wrap). Runs must cover the whole text, otherwise it logs "`TextRun`s do not cover the entire to be shaped text".
- **Hit testing**: `LineLayout::{index_for_x, closest_index_for_x, x_for_index}` (`text_system/line_layout.rs:61,78,108`), `WrappedLineLayout::closest_index_for_position` (`line_layout.rs:361`). `ShapedLine::paint` / `paint_background` (`text_system/line.rs:108,160`) and `WrappedLine::paint` (`line.rs:460`) draw them.
- **`StyledText`** (`src/elements/text.rs:391`): element form of the same thing. `with_runs`, `with_highlights(Range -> HighlightStyle)`, `with_default_highlights`, and `with_font_family_overrides(Range -> family)` (`text.rs:488`) so a family per range is available there. `.layout()` returns `TextLayout` with `index_for_position` (`text.rs:863`), `position_for_index` (`text.rs:897`), `line_layout_for_index` (`text.rs:928`). `InteractiveText` adds click/hover per range (`text.rs:1014`). Read-only: no caret or selection.
- **`HighlightStyle`** (`src/style.rs:580`): `color, font_weight, font_style, background_color, underline, strikethrough, fade_out`. No family, no size. Weight and style are applied onto the run font (`style.rs:512-516`).
- **IME / text input seam**: `trait EntityInputHandler` (`src/input.rs:13`) with `text_for_range`, `selected_text_range`, `marked_text_range`, `unmark_text`, `replace_text_in_range`, `replace_and_mark_text_in_range`, `bounds_for_range`, `character_index_for_point`, optional `paste`, `text_length_utf16`, `accepts_text_input`, `text_input_configuration`. All ranges are UTF-16. Wrapped by `ElementInputHandler::new(bounds, entity)` and registered during paint with `Window::handle_input(&focus_handle, handler, cx)` (`src/window.rs:5253`; only active when the focus handle is focused). `bounds_for_range` is what positions the IME candidate window.
- **Clipboard**: `cx.write_to_clipboard(ClipboardItem)` / `read_from_clipboard()` (`src/app.rs:1630`), `read_from_clipboard_async` (`platform.rs:542`). `ClipboardItem` entries are `String { text, metadata: Option<String> }`, `Image`, `ExternalPaths` (`platform.rs:2957`). `ClipboardItem::new_string_with_json_metadata` (`platform.rs:2985`) lets us carry our own run-JSON beside the plain text (Zed uses this for copy-with-metadata). No HTML/RTF entry type, so inter-app rich paste is out.
- **Reference implementation**: `gpui-pre-0.3.8/examples/input.rs` (and https://github.com/zed-industries/zed/blob/main/crates/gpui/examples/input.rs). A tiny single-line `TextInput`: `EntityInputHandler` impl with `marked_range`, selection, `shape_line`, hand-painted caret and selection quad, copy/paste actions. Uniform style, no undo. This is the minimal skeleton of what we need.
- **`sum-tree`**: `gpui-pre-sum-tree-0.3.8` (Apache-2.0) is available if we want an augmented B-tree for runs; probably overkill for prayer-block sizes.

### `gpui-base` 0.7.1 (the editing engine; `gpui-component` re-exports it)

- Layout note: `gpui-component-0.7.1/src/input/mod.rs` just re-exports `gpui_base::input::*`. The engine is `gpui-base-0.7.1/src/input/` (`base/state.rs` 10.9k lines, `base/element.rs` 4.7k lines). Both crates declare `repository = "https://github.com/longbridge/gpui-kit"` in Cargo.toml. Upstream longbridge/gpui-component is the older lineage; 0.7.1 as shipped is this restructured split. Source in the registry is the truth.
- **What it implements** (`input/base/`): rope (`ropey`) buffer, multi-cursor selections (`cursor.rs`, `selection.rs`), movement (`movement.rs`), word/line actions, `impl EntityInputHandler for InputBaseState<M>` (`state.rs:3933`, `replace_and_mark_text_in_range` at `state.rs:4215`) so IME composition works with marked-text rendering (`element.rs:2653-2661` builds a distinct marked `TextRun`), copy/cut/paste (`state.rs:2656-2760`, plain text via `ClipboardItem::new_string`), undo/redo (`undo_manager.rs`, coalescing typing transactions, 1000 transactions cap), soft wrap and display map (`editor/display_map/`), blink cursor, touch selection, search, and a11y. It is rendered by an `Element` that calls `shape_line` per visual line and `Window::handle_input` (`element.rs:3002`).
- **Modes**: `InputState` (single line), `TextareaState` (multi line), `EditorState` (code editor: folding, LSP, decorations, syntax) - `input/mod.rs:100-122`.
- **Per-range styling hooks**:
  - `InputHighlighter` trait (`input/editor/highlighting.rs:30`): returns ordered, non-overlapping style runs; designed for tree-sitter syntax.
  - `EditorState::create_decorations_collection(Vec<TextDecoration{range, style: HighlightStyle}>) -> TextDecorationCollection` with `set/append/clear/get_ranges` (`input/editor/decorations.rs:72-143, 510-560`). Ranges are UTF-8 byte offsets, follow edits (insert inside expands, insert at either edge does NOT expand, deletion drops empty ranges), are not part of undo history ("deleted ranges are not resurrected by undo"), and are not rendered when masked. Collections layer, first wins on conflicts. Only on `EditorState`, not `InputState`/`TextareaState`.
  - `RangeDecoration` (background fills / frames only, no text-run effect).
  - `InlineToken`: atomic inline objects inside text (`input/base/inline_tokens.rs`); a chip-like unit, not a style.
- **Rich display (read-only)**: `gpui-base-0.7.1/src/text/` (`TextView`, markdown/html, `inline.rs`, `inline_flow.rs`, selection). It does handle a size change per range, but explicitly by splitting: "GPUI runs can vary the font but not its size, so each range needs its own shaped line" (`text/inline.rs:165`). That helper is `pub(super)`, so not reusable. Read-only, no editing.

### Zed's editor (https://github.com/zed-industries/zed, crates/editor)

- Highlights as overlays: `crates/editor/src/display_map/custom_highlights.rs` merges `TextHighlights` / semantic tokens into chunk styles; the element converts chunks to `TextRun`s and calls `shape_line` (`crates/editor/src/element.rs`, `layout_lines` ~line 3174, one `font_size` for all runs at ~3190, `shape_line` calls ~3212). The buffer (`crates/text`, `crates/rope`, `crates/multi_buffer`) holds text only; styles come from tree-sitter/LSP/decoration layers, never stored in the document. Same architecture as gpui-base's editor. IME and input go through the same `EntityInputHandler`.
- **Usability as crates**: `editor`, `text`, `rope`, `multi_buffer` have `license = "GPL-3.0-or-later"` (crates/editor/Cargo.toml, crates/text/Cargo.toml, crates/rope/Cargo.toml) and are not on crates.io (crates.io API returns 404 for `zed-editor`, `zed-text`, `zed-rope`, `zed-multi_buffer`). `gpui` is Apache-2.0 (https://github.com/zed-industries/zed/blob/main/crates/gpui/Cargo.toml) and is the part usable, through `gpui-pre` as pulled by gpui-kit. Zed's editor is also tightly bound to Zed crates (language, project, theme, settings). Treat as design reference only.

## Gaps we'd build ourselves

1. **Document model with inline styles.** Text plus a run list (`Vec<(len, Style)>` or a rope + interval map) where Style = family, size, color, weight, italic. This must map cleanly to prayer JSON blocks/kinds (content != design; run style would be ephemeral formatting or kind-style references). gpui-component stores no styles in its buffer.
2. **Edit semantics for runs.** Insertion inherits the style of the preceding character or a "pending style" set from the toolbar; split/merge runs on style change over a selection; run adjustment on delete/replace/paste. gpui-base's decorations explicitly do not grow at edges, so they cannot give word-processor typing behaviour.
3. **Undo/redo covering styles.** `undo_manager` records text `Change` only. We need transactions of (text edit + run edit), or a snapshot/command stack of our own. Copy the coalescing idea.
4. **Per-run font size (and line layout).** Because `shape_line` takes one size, mixed sizes within a line need multiple shaped fragments laid out inline with a shared baseline, our own line-height rule, and our own wrapping across fragments (or restrict v1 to size-per-block/line). Family, weight, italic, color per run need no workaround.
5. **The editing element.** Cursor and selection painting, mouse/keyboard handling, caret movement across fragments and wrapped lines, selection quads across multiple runs/sizes, `bounds_for_range` for IME, marked text rendering, scrolling, focus. Best base: the gpui `examples/input.rs` skeleton plus patterns from `gpui-base/src/input/base/{state,element}.rs` (IME, marked range, UTF-16 conversion, word movement).
6. **Rich clipboard.** Own run-aware copy/paste through `ClipboardItem::new_string_with_json_metadata` (plain text fallback). Pasting from other apps is plain text only; no HTML/RTF.
7. **Hit-testing/geometry for IME** over our custom fragmenting: `character_index_for_point` and `bounds_for_range` must be consistent with UTF-16 offsets.
8. **Tests** around run splitting/merging, UTF-8/UTF-16 offsets, undo, and a golden round trip to/from prayer JSON (keep this logic in a Core-like pure crate, per AGENTS.md "business logic in Core").

## Recommendation for the prototype

- Do **not** try to extend `gpui-component` `Input`/`Textarea` for this; it would be a text-only engine with a decoration side channel that fights us at every edit. Use it only for ordinary form fields around the editor (title, ids, search).
- Build a small `StyledTextEditor` of our own, in two layers:
  1. A pure, GPUI-free crate: `RichText { text: String, runs }` with insert/delete/apply-style/split-merge, UTF-8/UTF-16 conversion, and its own undo stack. Fully unit-tested.
  2. A GPUI view+element that implements `EntityInputHandler`, calls `Window::handle_input`, shapes with `shape_text`/`shape_line` using `TextRun`s derived from our runs, and paints caret/selection from `ShapedLine`/`WrappedLine` hit-testing. Start from `gpui-pre/examples/input.rs`, and read `gpui-base/src/input/base/state.rs` (IME at 3933-4260) when matching its behaviour.
- **Prototype scope ladder**: (a) one paragraph, per-run family/weight/italic/color, single font size, caret, selection, typing, IME, undo; (b) toolbar-applied styles with "pending style" at caret; (c) copy/paste with run metadata; (d) mixed font size within a line via multi-fragment layout. Decide early whether size per run is a hard requirement. If sizes can be per block (kind style) instead, gap 4 shrinks dramatically.
- Spike risk to retire first: a throwaway `StyledText` read-only render of a runs list (verifies family/weight/italic/color per run on Linux including the fonts used for Church Slavonic/Greek/Cyrillic), then IME composition with marked text spanning runs.

## Sources

Local (crate sources, versions per Cargo.lock):
- `gpui-kit-0.7.1/src/lib.rs`, `gpui-kit-0.7.1/Cargo.toml` (facade over gpui-pre 0.3.8, gpui-base, gpui-component; repository longbridge/gpui-kit)
- `gpui-pre-0.3.8/src/{text_system.rs, text_system/line.rs, text_system/line_layout.rs, elements/text.rs, style.rs, input.rs, window.rs, platform.rs, app.rs}`, `gpui-pre-0.3.8/examples/input.rs`, `gpui-pre-0.3.8/Cargo.toml` (Apache-2.0)
- `gpui-base-0.7.1/src/input/{mod.rs, README.md, base/state.rs, base/element.rs, base/undo_manager.rs, base/change.rs, base/inline_tokens.rs, editor/highlighting.rs, editor/decorations.rs}`
- `gpui-base-0.7.1/src/text/{mod.rs, inline.rs, range_highlight.rs}`
- `gpui-component-0.7.1/src/input/mod.rs` (re-exports gpui-base input)

Remote (fetched via raw.githubusercontent.com / crates.io API, 2026-10-05):
- https://github.com/zed-industries/zed/blob/main/crates/gpui/src/text_system.rs (`TextRun`)
- https://github.com/zed-industries/zed/blob/main/crates/gpui/src/style.rs (`HighlightStyle`)
- https://github.com/zed-industries/zed/blob/main/crates/gpui/examples/input.rs
- https://github.com/zed-industries/zed/blob/main/crates/editor/src/display_map/custom_highlights.rs
- https://github.com/zed-industries/zed/blob/main/crates/editor/src/element.rs
- https://github.com/zed-industries/zed/blob/main/crates/{editor,text,rope}/Cargo.toml (GPL-3.0-or-later) and `crates/gpui/Cargo.toml` (Apache-2.0)
- https://crates.io/api/v1/crates/gpui (latest 0.2.2, repo zed-industries/zed) and `/crates/gpui-component` (0.7.1)
