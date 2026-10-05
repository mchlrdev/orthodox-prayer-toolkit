//! PROTOTYPE — the editing view and element.
//!
//! One `EditorProto` entity owns all Blocks, the focused Block and the
//! selection inside it. Each Block is painted by a `BlockElement` that shapes
//! its runs with wrapping and stores the layout back on the entity, so mouse
//! hit-testing, caret painting and the IME (`EntityInputHandler`) all work on
//! the same layout.

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use gpui_kit::*;

use super::model::{Block, Cell, EditKind, History, RunKind};

actions!(
    prototype_editor,
    [
        Backspace,
        Delete,
        Left,
        Right,
        Up,
        Down,
        SelectLeft,
        SelectRight,
        SelectUp,
        SelectDown,
        WordLeft,
        WordRight,
        SelectWordLeft,
        SelectWordRight,
        Home,
        End,
        SelectAll,
        SplitBlock,
        LineBreak,
        ToggleNote,
        Undo,
        Redo,
        Copy,
        Cut,
        Paste,
    ]
);

const CONTEXT: &str = "PrototypeEditor";

pub fn bind_keys(cx: &mut App) {
    let c = Some(CONTEXT);
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, c),
        KeyBinding::new("delete", Delete, c),
        KeyBinding::new("left", Left, c),
        KeyBinding::new("right", Right, c),
        KeyBinding::new("up", Up, c),
        KeyBinding::new("down", Down, c),
        KeyBinding::new("shift-left", SelectLeft, c),
        KeyBinding::new("shift-right", SelectRight, c),
        KeyBinding::new("shift-up", SelectUp, c),
        KeyBinding::new("shift-down", SelectDown, c),
        KeyBinding::new("home", Home, c),
        KeyBinding::new("end", End, c),
        KeyBinding::new("enter", SplitBlock, c),
        KeyBinding::new("shift-enter", LineBreak, c),
        KeyBinding::new("secondary-a", SelectAll, c),
        KeyBinding::new("secondary-shift-m", ToggleNote, c),
        KeyBinding::new("secondary-z", Undo, c),
        KeyBinding::new("secondary-shift-z", Redo, c),
        KeyBinding::new("ctrl-y", Redo, c),
        KeyBinding::new("secondary-c", Copy, c),
        KeyBinding::new("secondary-x", Cut, c),
        KeyBinding::new("secondary-v", Paste, c),
    ]);
    // Word movement: Option on macOS, Ctrl elsewhere.
    #[cfg(target_os = "macos")]
    cx.bind_keys([
        KeyBinding::new("alt-left", WordLeft, c),
        KeyBinding::new("alt-right", WordRight, c),
        KeyBinding::new("alt-shift-left", SelectWordLeft, c),
        KeyBinding::new("alt-shift-right", SelectWordRight, c),
        KeyBinding::new("cmd-left", Home, c),
        KeyBinding::new("cmd-right", End, c),
    ]);
    #[cfg(not(target_os = "macos"))]
    cx.bind_keys([
        KeyBinding::new("ctrl-left", WordLeft, c),
        KeyBinding::new("ctrl-right", WordRight, c),
        KeyBinding::new("ctrl-shift-left", SelectWordLeft, c),
        KeyBinding::new("ctrl-shift-right", SelectWordRight, c),
    ]);
}

/// Kind styles, hard-coded for the prototype (the real app resolves them
/// from the Library's styles).
struct KindStyle {
    size: f32,
    color: Hsla,
    weight: FontWeight,
    italic: bool,
}

fn accent() -> Hsla {
    rgb(0xa3201b).into()
}

fn base_color() -> Hsla {
    rgb(0x1f1f1f).into()
}

fn kind_style(kind: &str) -> KindStyle {
    match kind {
        "heading" => KindStyle {
            size: 22.,
            color: accent(),
            weight: FontWeight::SEMIBOLD,
            italic: false,
        },
        "subheading" => KindStyle {
            size: 18.,
            color: accent(),
            weight: FontWeight::NORMAL,
            italic: false,
        },
        "annotation" => KindStyle {
            size: 15.,
            color: accent(),
            weight: FontWeight::NORMAL,
            italic: true,
        },
        _ => KindStyle {
            size: 17.,
            color: base_color(),
            weight: FontWeight::NORMAL,
            italic: false,
        },
    }
}

#[derive(Clone)]
struct Snapshot {
    blocks: Vec<Block>,
    active: usize,
    selection: Range<usize>,
}

/// Layout of one Block from the last paint.
#[derive(Clone)]
struct BlockLayout {
    /// One entry per hard line (text split on '\n'); each may soft-wrap.
    lines: Rc<Vec<WrappedLine>>,
    /// Byte offset where each hard line starts.
    line_starts: Vec<usize>,
    bounds: Bounds<Pixels>,
    line_height: Pixels,
}

impl BlockLayout {
    fn line_for_offset(&self, offset: usize) -> usize {
        self.line_starts
            .iter()
            .rposition(|&s| s <= offset)
            .unwrap_or(0)
    }

    fn line_top(&self, line: usize) -> Pixels {
        self.lines[..line]
            .iter()
            .map(|l| l.size(self.line_height).height)
            .fold(px(0.), |a, b| a + b)
    }

    /// Caret position relative to the block's origin.
    fn position_for_offset(&self, offset: usize) -> Point<Pixels> {
        if self.lines.is_empty() {
            return point(px(0.), px(0.));
        }
        let line = self.line_for_offset(offset);
        let local = offset - self.line_starts[line];
        let p = self.lines[line]
            .position_for_index(local, self.line_height)
            .unwrap_or(point(px(0.), px(0.)));
        point(p.x, p.y + self.line_top(line))
    }

    /// Offset closest to a point relative to the block's origin.
    fn offset_for_position(&self, position: Point<Pixels>) -> usize {
        if self.lines.is_empty() {
            return 0;
        }
        let mut top = px(0.);
        for (ix, line) in self.lines.iter().enumerate() {
            let height = line.size(self.line_height).height;
            if position.y < top + height || ix == self.lines.len() - 1 {
                let local = point(position.x.max(px(0.)), (position.y - top).max(px(0.)));
                let index = match line.closest_index_for_position(local, self.line_height) {
                    Ok(i) | Err(i) => i,
                };
                return self.line_starts[ix] + index.min(line.len());
            }
            top += height;
        }
        0
    }

    fn height(&self) -> Pixels {
        self.line_top(self.lines.len()).max(self.line_height)
    }
}

pub struct EditorProto {
    focus_handle: FocusHandle,
    pub blocks: Vec<Block>,
    pub active: usize,
    selection: Range<usize>,
    reversed: bool,
    marked: Option<Range<usize>>,
    history: History<Snapshot>,
    layouts: Vec<Option<BlockLayout>>,
    selecting: bool,
    /// Column kept while moving up/down, like text editors do.
    goal_x: Option<Pixels>,
}

impl EditorProto {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let blocks = sample_blocks();
        let layouts = vec![None; blocks.len()];
        Self {
            focus_handle: cx.focus_handle(),
            blocks,
            active: 0,
            selection: 0..0,
            reversed: false,
            marked: None,
            history: History::new(),
            layouts,
            selecting: false,
            goal_x: None,
        }
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus_handle
    }

    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    fn cell(&self) -> &Cell {
        &self.blocks[self.active].cell
    }

    fn cell_mut(&mut self) -> &mut Cell {
        &mut self.blocks[self.active].cell
    }

    fn cursor(&self) -> usize {
        if self.reversed {
            self.selection.start
        } else {
            self.selection.end
        }
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            blocks: self.blocks.clone(),
            active: self.active,
            selection: self.selection.clone(),
        }
    }

    fn restore(&mut self, s: Snapshot) {
        self.blocks = s.blocks;
        self.layouts.resize(self.blocks.len(), None);
        self.active = s.active.min(self.blocks.len() - 1);
        let len = self.cell().len();
        self.selection = s.selection.start.min(len)..s.selection.end.min(len);
        self.reversed = false;
        self.marked = None;
    }

    fn record(&mut self, kind: EditKind) {
        let s = self.snapshot();
        self.history.record(s, kind);
    }

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        self.selection = offset..offset;
        self.reversed = false;
        self.history.break_coalescing();
        cx.notify();
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        if self.reversed {
            self.selection.start = offset;
        } else {
            self.selection.end = offset;
        }
        if self.selection.end < self.selection.start {
            self.reversed = !self.reversed;
            self.selection = self.selection.end..self.selection.start;
        }
        self.history.break_coalescing();
        cx.notify();
    }

    fn focus_block(&mut self, ix: usize, offset: usize, cx: &mut Context<Self>) {
        self.active = ix;
        self.marked = None;
        self.move_to(offset, cx);
    }

    // ---- actions -------------------------------------------------------

    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        if !self.selection.is_empty() {
            return self.move_to(self.selection.start, cx);
        }
        let c = self.cursor();
        if c == 0 && self.active > 0 {
            let prev = self.active - 1;
            let end = self.blocks[prev].cell.len();
            return self.focus_block(prev, end, cx);
        }
        self.move_to(self.cell().prev_boundary(c), cx);
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        if !self.selection.is_empty() {
            return self.move_to(self.selection.end, cx);
        }
        let c = self.cursor();
        if c == self.cell().len() && self.active + 1 < self.blocks.len() {
            return self.focus_block(self.active + 1, 0, cx);
        }
        self.move_to(self.cell().next_boundary(c), cx);
    }

    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.cell().prev_boundary(self.cursor()), cx);
    }

    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.cell().next_boundary(self.cursor()), cx);
    }

    fn word_left(&mut self, _: &WordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.cell().prev_word_boundary(self.cursor()), cx);
    }

    fn word_right(&mut self, _: &WordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.move_to(self.cell().next_word_boundary(self.cursor()), cx);
    }

    fn select_word_left(&mut self, _: &SelectWordLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.cell().prev_word_boundary(self.cursor()), cx);
    }

    fn select_word_right(&mut self, _: &SelectWordRight, _: &mut Window, cx: &mut Context<Self>) {
        self.select_to(self.cell().next_word_boundary(self.cursor()), cx);
    }

    /// Vertical move inside the wrapped layout; past the first/last visual
    /// line it continues into the previous/next Block at the same x.
    fn vertical(&mut self, down: bool, select: bool, cx: &mut Context<Self>) {
        let Some(layout) = self.layouts.get(self.active).cloned().flatten() else {
            return;
        };
        let pos = layout.position_for_offset(self.cursor());
        let x = *self.goal_x.get_or_insert(pos.x);
        let target_y = if down {
            pos.y + layout.line_height * 1.5
        } else {
            pos.y - layout.line_height * 0.5
        };

        if target_y >= px(0.) && target_y < layout.height() {
            let offset = layout.offset_for_position(point(x, target_y));
            if select {
                self.select_to(offset, cx)
            } else {
                self.move_to(offset, cx)
            }
        } else if !select {
            let next = if down {
                self.active + 1
            } else {
                self.active.wrapping_sub(1)
            };
            if let Some(Some(next_layout)) = self.layouts.get(next).cloned() {
                let y = if down {
                    px(0.)
                } else {
                    next_layout.height() - next_layout.line_height * 0.5
                };
                let offset = next_layout.offset_for_position(point(x, y));
                let goal = self.goal_x;
                self.focus_block(next, offset, cx);
                self.goal_x = goal;
            }
        } else {
            let offset = if down { self.cell().len() } else { 0 };
            self.select_to(offset, cx);
        }
    }

    fn up(&mut self, _: &Up, _: &mut Window, cx: &mut Context<Self>) {
        self.vertical(false, false, cx);
    }

    fn down(&mut self, _: &Down, _: &mut Window, cx: &mut Context<Self>) {
        self.vertical(true, false, cx);
    }

    fn select_up(&mut self, _: &SelectUp, _: &mut Window, cx: &mut Context<Self>) {
        self.vertical(false, true, cx);
    }

    fn select_down(&mut self, _: &SelectDown, _: &mut Window, cx: &mut Context<Self>) {
        self.vertical(true, true, cx);
    }

    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        let start = self.layouts[self.active]
            .as_ref()
            .map(|l| l.line_starts[l.line_for_offset(self.cursor())])
            .unwrap_or(0);
        self.move_to(start, cx);
    }

    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        let c = self.cursor();
        let end = self.cell().text()[c..]
            .find('\n')
            .map(|i| c + i)
            .unwrap_or(self.cell().len());
        self.move_to(end, cx);
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.selection = 0..self.cell().len();
        self.reversed = false;
        cx.notify();
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        if self.selection.is_empty() {
            let c = self.cursor();
            if c == 0 {
                return self.backspace_at_start(window, cx);
            }
            self.selection = self.cell().prev_boundary(c)..c;
        }
        self.record(EditKind::Deleting);
        let range = self.selection.clone();
        self.cell_mut().replace(range.clone(), "");
        self.move_to(range.start, cx);
    }

    /// At the start of a Block: an empty Block is removed (as today);
    /// a non-empty one is merged into the previous Block (new behaviour,
    /// the Electron editor does nothing here).
    fn backspace_at_start(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if self.active == 0 {
            return;
        }
        self.record(EditKind::Other);
        let current = self.blocks.remove(self.active);
        self.layouts.remove(self.active);
        let prev = self.active - 1;
        let join = self.blocks[prev].cell.len();
        self.blocks[prev].cell.append(current.cell);
        self.focus_block(prev, join, cx);
    }

    fn delete(&mut self, _: &Delete, _: &mut Window, cx: &mut Context<Self>) {
        if self.selection.is_empty() {
            let c = self.cursor();
            if c == self.cell().len() {
                return;
            }
            self.selection = c..self.cell().next_boundary(c);
        }
        self.record(EditKind::Deleting);
        let range = self.selection.clone();
        self.cell_mut().replace(range.clone(), "");
        self.move_to(range.start, cx);
    }

    /// Enter: split the Block at the caret; the new Block keeps the Kind.
    fn split_block(&mut self, _: &SplitBlock, _: &mut Window, cx: &mut Context<Self>) {
        self.record(EditKind::Other);
        let range = self.selection.clone();
        self.cell_mut().replace(range.clone(), "");
        let rest = self.cell_mut().split_off(range.start);
        let kind = self.blocks[self.active].kind.clone();
        self.blocks
            .insert(self.active + 1, Block { kind, cell: rest });
        self.layouts.insert(self.active + 1, None);
        self.focus_block(self.active + 1, 0, cx);
    }

    /// Shift+Enter: line break inside the Block.
    fn line_break(&mut self, _: &LineBreak, _: &mut Window, cx: &mut Context<Self>) {
        self.record(EditKind::Other);
        let range = self.selection.clone();
        let inserted = self.cell_mut().replace(range, "\n");
        self.move_to(inserted.end, cx);
    }

    fn toggle_note(&mut self, _: &ToggleNote, _: &mut Window, cx: &mut Context<Self>) {
        if self.selection.is_empty() {
            return;
        }
        self.record(EditKind::Other);
        let range = self.selection.clone();
        self.cell_mut().toggle_note(range);
        cx.notify();
    }

    fn undo(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        let current = self.snapshot();
        if let Some(s) = self.history.undo(current) {
            self.restore(s);
            cx.notify();
        }
    }

    fn redo(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        let current = self.snapshot();
        if let Some(s) = self.history.redo(current) {
            self.restore(s);
            cx.notify();
        }
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if !self.selection.is_empty() {
            let text = self.cell().text()[self.selection.clone()].to_string();
            cx.write_to_clipboard(ClipboardItem::new_string(text));
        }
    }

    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        if !self.selection.is_empty() {
            self.copy(&Copy, window, cx);
            self.record(EditKind::Other);
            let range = self.selection.clone();
            self.cell_mut().replace(range.clone(), "");
            self.move_to(range.start, cx);
        }
    }

    /// Plain text only, as in the Electron editor.
    fn paste(&mut self, _: &Paste, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            self.record(EditKind::Other);
            let text = text.replace("\r\n", "\n");
            let range = self.selection.clone();
            let inserted = self.cell_mut().replace(range, &text);
            self.move_to(inserted.end, cx);
        }
    }

    // ---- mouse ---------------------------------------------------------

    fn block_at(&self, position: Point<Pixels>) -> Option<(usize, usize)> {
        let mut nearest: Option<(usize, Pixels)> = None;
        for (ix, layout) in self.layouts.iter().enumerate() {
            let Some(layout) = layout else { continue };
            let b = layout.bounds;
            let dist = if position.y < b.top() {
                b.top() - position.y
            } else if position.y > b.bottom() {
                position.y - b.bottom()
            } else {
                px(0.)
            };
            if nearest.is_none_or(|(_, d)| dist < d) {
                nearest = Some((ix, dist));
            }
        }
        let (ix, _) = nearest?;
        let layout = self.layouts[ix].as_ref()?;
        let local = position - layout.bounds.origin;
        Some((ix, layout.offset_for_position(local)))
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        window.focus(&self.focus_handle, cx);
        self.goal_x = None;
        let Some((ix, offset)) = self.block_at(event.position) else {
            return;
        };
        if event.modifiers.shift && ix == self.active {
            self.select_to(offset, cx);
        } else if event.click_count >= 2 && ix == self.active {
            let cell = self.cell();
            let start = cell.prev_word_boundary(cell.next_boundary(offset).min(cell.len()));
            let end = cell.next_word_boundary(start);
            self.selection = start..end;
            self.reversed = false;
            cx.notify();
            return;
        } else {
            self.focus_block(ix, offset, cx);
        }
        self.selecting = true;
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.selecting {
            return;
        }
        // Selection stays inside the focused Block, as in the Electron editor.
        if let Some(layout) = self.layouts[self.active].as_ref() {
            let offset = layout.offset_for_position(event.position - layout.bounds.origin);
            self.select_to(offset, cx);
        }
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.selecting = false;
    }

    // ---- UTF-16 helpers for the platform input handler -----------------

    fn offset_to_utf16(&self, offset: usize) -> usize {
        self.cell().text()[..offset.min(self.cell().len())]
            .encode_utf16()
            .count()
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        let mut utf16 = 0;
        for (i, ch) in self.cell().text().char_indices() {
            if utf16 >= offset {
                return i;
            }
            utf16 += ch.len_utf16();
        }
        self.cell().len()
    }

    fn range_to_utf16(&self, r: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(r.start)..self.offset_to_utf16(r.end)
    }

    fn range_from_utf16(&self, r: &Range<usize>) -> Range<usize> {
        self.offset_from_utf16(r.start)..self.offset_from_utf16(r.end)
    }

    pub fn active_runs(&self) -> Vec<(RunKind, String)> {
        self.cell().to_runs()
    }
}

impl EntityInputHandler for EditorProto {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.range_from_utf16(&range);
        actual.replace(self.range_to_utf16(&range));
        Some(self.cell().text()[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.range_to_utf16(&self.selection),
            reversed: self.reversed,
        })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked.as_ref().map(|r| self.range_to_utf16(r))
    }

    fn unmark_text(&mut self, _: &mut Window, _: &mut Context<Self>) {
        self.marked = None;
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range
            .map(|r| self.range_from_utf16(&r))
            .or(self.marked.clone())
            .unwrap_or(self.selection.clone());
        // Committing IME composition replaces the marked text; that is one
        // typing step with whatever was typed before it.
        self.record(EditKind::Typing);
        let inserted = self.cell_mut().replace(range, text);
        self.marked = None;
        self.goal_x = None;
        self.selection = inserted.end..inserted.end;
        self.reversed = false;
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        new_selected: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let range = range
            .map(|r| self.range_from_utf16(&r))
            .or(self.marked.clone())
            .unwrap_or(self.selection.clone());
        self.record(EditKind::Typing);
        let inserted = self.cell_mut().replace(range, text);
        self.marked = (!text.is_empty()).then_some(inserted.clone());
        self.selection = match new_selected {
            Some(sel) => {
                // `sel` is relative to the inserted text, in UTF-16.
                let base16 = self.offset_to_utf16(inserted.start);
                let s = self.offset_from_utf16(base16 + sel.start);
                let e = self.offset_from_utf16(base16 + sel.end);
                s..e
            }
            None => inserted.end..inserted.end,
        };
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        _element_bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let layout = self.layouts.get(self.active)?.as_ref()?;
        let range = self.range_from_utf16(&range);
        let start = layout.position_for_offset(range.start);
        let end = layout.position_for_offset(range.end);
        let origin = layout.bounds.origin;
        Some(Bounds::from_corners(
            origin + start,
            origin + point(end.x.max(start.x + px(1.)), end.y + layout.line_height),
        ))
    }

    fn character_index_for_point(
        &mut self,
        position: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        let layout = self.layouts.get(self.active)?.as_ref()?;
        let offset = layout.offset_for_position(position - layout.bounds.origin);
        Some(self.offset_to_utf16(offset))
    }
}

impl Focusable for EditorProto {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for EditorProto {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let editor = cx.entity();
        div()
            .key_context(CONTEXT)
            .track_focus(&self.focus_handle)
            .cursor(CursorStyle::IBeam)
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::up))
            .on_action(cx.listener(Self::down))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_up))
            .on_action(cx.listener(Self::select_down))
            .on_action(cx.listener(Self::word_left))
            .on_action(cx.listener(Self::word_right))
            .on_action(cx.listener(Self::select_word_left))
            .on_action(cx.listener(Self::select_word_right))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::split_block))
            .on_action(cx.listener(Self::line_break))
            .on_action(cx.listener(Self::toggle_note))
            .on_action(cx.listener(Self::undo))
            .on_action(cx.listener(Self::redo))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::paste))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .flex()
            .flex_col()
            .gap_3()
            .children((0..self.blocks.len()).map(|ix| {
                let active = ix == self.active;
                div()
                    .pl_3()
                    .border_l_2()
                    .border_color(if active { rgb(0xd9b8b6) } else { rgb(0xffffff) })
                    .child(BlockElement {
                        editor: editor.clone(),
                        ix,
                    })
            }))
    }
}

fn sample_blocks() -> Vec<Block> {
    use RunKind::{Note, Text};
    vec![
        Block {
            kind: "heading".into(),
            cell: Cell::from_runs(&[(Text, "Troparion to Saint Prokopios")]),
        },
        Block {
            kind: "annotation".into(),
            cell: Cell::from_runs(&[(Text, "Tone 4")]),
        },
        Block {
            kind: "verse".into(),
            cell: Cell::from_runs(&[
                (
                    Text,
                    "Thy martyr, O Lord, in his struggle received the crown of incorruption from Thee, our God; ",
                ),
                (Note, "(here the priest censes) "),
                (
                    Text,
                    "for having Thy strength, he laid low his adversaries.",
                ),
            ]),
        },
        Block {
            kind: "verse".into(),
            cell: Cell::from_runs(&[
                (
                    Text,
                    "Мученикъ Твой, Господи, во страданіихъ своихъ вѣнецъ пріятъ нетлѣнный",
                ),
                (Note, " (дважды)"),
            ]),
        },
        Block {
            kind: "verse".into(),
            cell: Cell::from_runs(&[(
                Text,
                "Ὁ μάρτυς σου, Κύριε, ἐν τῇ ἀθλήσει αὐτοῦ τὸ στέφος ἐκομίσατο.",
            )]),
        },
    ]
}

// ---- element -----------------------------------------------------------

struct BlockElement {
    editor: Entity<EditorProto>,
    ix: usize,
}

struct Prepaint {
    lines: Rc<Vec<WrappedLine>>,
    line_starts: Vec<usize>,
    line_height: Pixels,
    selection: Vec<PaintQuad>,
    cursor: Option<PaintQuad>,
}

type Shaped = Rc<RefCell<Option<(Vec<WrappedLine>, Vec<usize>, Pixels)>>>;

impl IntoElement for BlockElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for BlockElement {
    type RequestLayoutState = Shaped;
    type PrepaintState = Prepaint;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Shaped) {
        let editor = self.editor.read(cx);
        let block = &editor.blocks[self.ix];
        let style = kind_style(&block.kind);
        let text: SharedString = block.cell.text().to_string().into();
        let marked = (self.ix == editor.active)
            .then(|| editor.marked.clone())
            .flatten();

        let base = window.text_style();
        let mut font = base.font();
        font.weight = style.weight;
        font.style = if style.italic {
            FontStyle::Italic
        } else {
            FontStyle::Normal
        };

        let mut runs: Vec<TextRun> = Vec::new();
        for (range, kind) in block.cell.styled_ranges() {
            let color = match kind {
                RunKind::Text => style.color,
                RunKind::Note => accent(),
            };
            // Split around the IME marked range so it can be underlined.
            let mut cuts = vec![range.start, range.end];
            if let Some(m) = &marked {
                for p in [m.start, m.end] {
                    if p > range.start && p < range.end {
                        cuts.push(p);
                    }
                }
            }
            cuts.sort_unstable();
            for w in cuts.windows(2) {
                let underlined = marked
                    .as_ref()
                    .is_some_and(|m| w[0] >= m.start && w[1] <= m.end);
                runs.push(TextRun {
                    len: w[1] - w[0],
                    font: font.clone(),
                    color,
                    background_color: None,
                    underline: underlined.then(|| UnderlineStyle {
                        color: Some(color),
                        thickness: px(1.),
                        wavy: false,
                    }),
                    strikethrough: None,
                });
            }
        }

        let font_size = px(style.size);
        let line_height = px((style.size * 1.5).round());
        let mut line_starts = vec![0];
        for (i, _) in block.cell.text().match_indices('\n') {
            line_starts.push(i + 1);
        }

        let shaped: Shaped = Rc::new(RefCell::new(None));
        let out = shaped.clone();
        let layout_style = Style {
            size: Size {
                width: relative(1.).into(),
                height: Length::Auto,
            },
            ..Style::default()
        };
        let id =
            window.request_measured_layout(layout_style, move |known, available, window, _| {
                let wrap = known.width.or(match available.width {
                    AvailableSpace::Definite(w) => Some(w),
                    _ => None,
                });
                let lines: Vec<WrappedLine> = window
                    .text_system()
                    .shape_text(text.clone(), font_size, &runs, wrap, None)
                    .map(|l| l.into_iter().collect())
                    .unwrap_or_default();
                let height = lines
                    .iter()
                    .map(|l| l.size(line_height).height)
                    .fold(px(0.), |a, b| a + b)
                    .max(line_height);
                *out.borrow_mut() = Some((lines, line_starts.clone(), line_height));
                size(wrap.unwrap_or(px(600.)), height)
            });
        (id, shaped)
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        shaped: &mut Shaped,
        _: &mut Window,
        cx: &mut App,
    ) -> Prepaint {
        let (lines, line_starts, line_height) = shaped.borrow_mut().take().unwrap_or_default();
        let lines = Rc::new(lines);
        let layout = BlockLayout {
            lines: lines.clone(),
            line_starts: line_starts.clone(),
            bounds,
            line_height,
        };
        let editor = self.editor.read(cx);
        let mut selection = Vec::new();
        let mut cursor = None;
        if self.ix == editor.active {
            let sel = editor.selection.clone();
            if sel.is_empty() {
                let p = layout.position_for_offset(editor.cursor());
                cursor = Some(fill(
                    Bounds::new(bounds.origin + p, size(px(1.5), line_height)),
                    rgb(0x1f1f1f),
                ));
            } else {
                // One quad per visual line the selection touches.
                let a = layout.position_for_offset(sel.start);
                let b = layout.position_for_offset(sel.end);
                let mut y = a.y;
                while y <= b.y {
                    let x0 = if y == a.y { a.x } else { px(0.) };
                    let x1 = if y == b.y { b.x } else { bounds.size.width };
                    selection.push(fill(
                        Bounds::from_corners(
                            bounds.origin + point(x0, y),
                            bounds.origin + point(x1.max(x0 + px(4.)), y + line_height),
                        ),
                        rgba(0x3b82f640),
                    ));
                    y += line_height;
                }
            }
        }
        let ix = self.ix;
        self.editor.update(cx, |e, _| {
            if let Some(slot) = e.layouts.get_mut(ix) {
                *slot = Some(layout);
            }
        });
        Prepaint {
            lines,
            line_starts,
            line_height,
            selection,
            cursor,
        }
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Shaped,
        prepaint: &mut Prepaint,
        window: &mut Window,
        cx: &mut App,
    ) {
        let (focus, active) = {
            let e = self.editor.read(cx);
            (e.focus_handle.clone(), e.active == self.ix)
        };
        if active {
            window.handle_input(
                &focus,
                ElementInputHandler::new(bounds, self.editor.clone()),
                cx,
            );
        }
        for quad in prepaint.selection.drain(..) {
            window.paint_quad(quad);
        }
        let mut y = px(0.);
        for line in prepaint.lines.iter() {
            line.paint(
                bounds.origin + point(px(0.), y),
                prepaint.line_height,
                TextAlign::Left,
                Some(bounds),
                window,
                cx,
            )
            .ok();
            y += line.size(prepaint.line_height).height;
        }
        let _ = &prepaint.line_starts;
        if active
            && focus.is_focused(window)
            && let Some(cursor) = prepaint.cursor.take()
        {
            window.paint_quad(cursor);
        }
    }
}
