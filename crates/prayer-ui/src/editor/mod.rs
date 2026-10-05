//! The prayer editor: Blocks as rows, visible Variants as columns, each cell
//! edited in place in its formatted text.
//!
//! The focused cell keeps a [`Cell`] buffer. Every edit commits the buffer
//! into the Session draft right away (one undo history per prayer, typing
//! coalesced). The buffer is re-derived from the prayer only when the stored
//! text differs from what the editor last committed (undo, reload, replace),
//! so states the prayer never stores (an empty verse line being typed) live
//! on in the buffer.

mod buffer;
mod element;
mod layout;
pub mod style;

use std::collections::HashMap;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::menu::{ContextMenuExt, DropdownMenu, PopupMenu, PopupMenuItem};
use gpui_kit::component::{Disableable, IconName, Sizable};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use prayer_app::draft::SessionDraft;
use prayer_app::edit::{
    self, EditorContent, VariantRef, block_editor_content, editor_content, uses_lines,
};
use prayer_app::history::EditKind;
use prayer_core::resolve_styles::FALLBACK_KIND_STYLE;
use prayer_core::{Prayer, StyleMap, kind_display_label};

pub use buffer::Cell;
use element::CellElement;
use layout::CellLayout;
use style::CellStyle;

use crate::theme::{Palette, palette};

actions!(
    prayer_editor,
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
        DeleteWordLeft,
        DeleteWordRight,
        Home,
        End,
        SelectHome,
        SelectEnd,
        SelectAll,
        SplitBlock,
        LineBreak,
        ToggleNote,
        Copy,
        Cut,
        Paste,
    ]
);

pub const CONTEXT: &str = "PrayerEditor";

pub fn bind_keys(cx: &mut App) {
    let c = Some(CONTEXT);
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, c),
        KeyBinding::new("shift-backspace", Backspace, c),
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
        KeyBinding::new("shift-home", SelectHome, c),
        KeyBinding::new("shift-end", SelectEnd, c),
        KeyBinding::new("enter", SplitBlock, c),
        KeyBinding::new("shift-enter", LineBreak, c),
        KeyBinding::new("secondary-a", SelectAll, c),
        KeyBinding::new("secondary-shift-m", ToggleNote, c),
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
        KeyBinding::new("alt-backspace", DeleteWordLeft, c),
        KeyBinding::new("alt-delete", DeleteWordRight, c),
        KeyBinding::new("cmd-left", Home, c),
        KeyBinding::new("cmd-right", End, c),
        KeyBinding::new("cmd-shift-left", SelectHome, c),
        KeyBinding::new("cmd-shift-right", SelectEnd, c),
    ]);
    #[cfg(not(target_os = "macos"))]
    cx.bind_keys([
        KeyBinding::new("ctrl-left", WordLeft, c),
        KeyBinding::new("ctrl-right", WordRight, c),
        KeyBinding::new("ctrl-shift-left", SelectWordLeft, c),
        KeyBinding::new("ctrl-shift-right", SelectWordRight, c),
        KeyBinding::new("ctrl-backspace", DeleteWordLeft, c),
        KeyBinding::new("ctrl-delete", DeleteWordRight, c),
    ]);
}

/// Where the editor reads and writes the prayer it shows.
pub trait DraftHost: 'static {
    fn draft<'a>(&self, cx: &'a App) -> Option<&'a SessionDraft>;
    /// Runs `f` on the draft and tells everyone watching it that it changed.
    fn update_draft(&self, cx: &mut App, f: &mut dyn FnMut(&mut SessionDraft));
    /// The visible Variant columns, in reading order.
    fn columns(&self, cx: &App) -> Vec<VariantRef>;
    /// Resolved Kind styles.
    fn styles<'a>(&self, cx: &'a App) -> &'a StyleMap;
    /// Kinds offered besides those the prayer uses (Library, styles).
    fn extra_kinds(&self, cx: &App) -> Vec<String>;
}

/// What the editor asks its host to do.
#[derive(Clone, Debug)]
pub enum EditorEvent {
    /// "Edit kind…": rename the Kind or change its style.
    EditKind(String),
    /// "New kind…" for a Block.
    NewKind { block_id: String },
    /// The Block at the top of the viewport changed (outline scrollspy).
    Scrolled,
}

impl EventEmitter<EditorEvent> for PrayerEditor {}

/// A highlighted find match.
#[derive(Clone, Debug)]
pub struct Highlight {
    pub block_id: String,
    pub variant: VariantRef,
    pub range: Range<usize>,
    pub current: bool,
}

/// How [`PrayerEditor::reveal_block`] scrolls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RevealScroll {
    /// Scroll as little as needed to show the Block.
    Nearest,
    /// Put the Block at the top.
    Start,
}

/// Where a cell's layout was painted in the last frame.
#[derive(Clone)]
struct Placed {
    layout: Rc<CellLayout>,
    bounds: Bounds<Pixels>,
}

/// (Block id, column index).
type CellKey = (SharedString, usize);

/// The focused cell.
struct Active {
    block_id: SharedString,
    variant: VariantRef,
    buffer: Cell,
    /// What the editor last committed (or read): the stored form.
    committed: EditorContent,
    line_mode: bool,
    selection: Range<usize>,
    reversed: bool,
    marked: Option<Range<usize>>,
    /// Row index when last synced, to land nearby if the Block disappears.
    row: usize,
}

impl Active {
    fn cursor(&self) -> usize {
        if self.reversed {
            self.selection.start
        } else {
            self.selection.end
        }
    }
}

const FLASH: Duration = Duration::from_millis(900);

pub struct PrayerEditor {
    host: Rc<dyn DraftHost>,
    focus_handle: FocusHandle,
    list: ListState,
    rows: Vec<SharedString>,
    columns: Vec<VariantRef>,
    active: Option<Active>,
    layouts: HashMap<CellKey, Placed>,
    selecting: bool,
    word_anchor: Option<Range<usize>>,
    goal_x: Option<Pixels>,
    hover_row: Option<SharedString>,
    hover_chrome: Option<SharedString>,
    menu_row: Option<SharedString>,
    flash: Option<SharedString>,
    flash_task: Option<Task<()>>,
    last_added_kind: String,
    /// `top_block` as of the last render, to report scrolling.
    reported_top: Option<SharedString>,
    highlights: Vec<Highlight>,
}

impl PrayerEditor {
    /// The host may be mid-update while the editor is created, so nothing
    /// is read from it here; the first render syncs.
    pub fn new(host: Rc<dyn DraftHost>, cx: &mut Context<Self>) -> Self {
        let rows = Vec::new();
        let list = ListState::new(1, ListAlignment::Top, px(600.));
        let last_added_kind = String::new();
        Self {
            host,
            focus_handle: cx.focus_handle(),
            list,
            rows,
            columns: Vec::new(),
            active: None,
            layouts: HashMap::new(),
            selecting: false,
            word_anchor: None,
            goal_x: None,
            hover_row: None,
            hover_chrome: None,
            menu_row: None,
            flash: None,
            flash_task: None,
            last_added_kind,
            reported_top: None,
            highlights: Vec::new(),
        }
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus_handle
    }

    /// The selected text of the focused cell (to pre-fill Find).
    pub fn selected_text(&self) -> Option<String> {
        let a = self.active.as_ref()?;
        (!a.selection.is_empty()).then(|| a.buffer.text()[a.selection.clone()].to_owned())
    }

    /// The first Block at the top of the viewport (for the outline).
    pub fn top_block(&self) -> Option<SharedString> {
        let top = self.list.logical_scroll_top();
        self.rows.get(top.item_ix).cloned()
    }

    /// Ids of the rows painted in the last frame with their top, relative to
    /// the viewport top (for the outline's scrollspy).
    pub fn row_tops(&self) -> Vec<(SharedString, Pixels)> {
        let viewport = self.list.viewport_bounds();
        self.rows
            .iter()
            .enumerate()
            .filter_map(|(ix, id)| {
                self.list
                    .bounds_for_item(ix)
                    .map(|b| (id.clone(), b.top() - viewport.top()))
            })
            .collect()
    }

    pub fn set_highlights(&mut self, highlights: Vec<Highlight>, cx: &mut Context<Self>) {
        self.highlights = highlights;
        cx.notify();
    }

    fn draft<'a>(&self, cx: &'a App) -> Option<&'a SessionDraft> {
        self.host.draft(cx)
    }

    fn prayer<'a>(&self, cx: &'a App) -> Option<&'a Prayer> {
        self.draft(cx).map(SessionDraft::prayer)
    }

    // -- syncing with the draft -------------------------------------------

    /// Brings rows and the focused cell up to date with the draft.
    fn sync(&mut self, cx: &mut Context<Self>) {
        let columns = self.host.columns(cx);
        if columns != self.columns {
            self.layouts.clear();
            self.columns = columns;
        }
        let Some(prayer) = self.prayer(cx) else {
            self.active = None;
            if !self.rows.is_empty() {
                self.list.reset(1);
                self.rows.clear();
            }
            return;
        };
        let rows: Vec<SharedString> = prayer
            .structure
            .iter()
            .map(|b| SharedString::from(b.id.clone()))
            .collect();
        if rows != self.rows {
            let prefix = rows
                .iter()
                .zip(&self.rows)
                .take_while(|(a, b)| a == b)
                .count();
            let max_suffix = rows.len().min(self.rows.len()) - prefix;
            let suffix = rows
                .iter()
                .rev()
                .zip(self.rows.iter().rev())
                .take(max_suffix)
                .take_while(|(a, b)| a == b)
                .count();
            self.list.splice(
                prefix..self.rows.len() - suffix,
                rows.len() - prefix - suffix,
            );
            self.rows = rows;
        }
        if self.last_added_kind.is_empty() {
            self.last_added_kind = prayer
                .structure
                .last()
                .map_or_else(|| "verse".to_owned(), |b| b.kind.clone());
        }

        let Some(active) = self.active.as_mut() else {
            return;
        };
        if !self.columns.contains(&active.variant) {
            self.active = None;
            return;
        }
        let found = prayer
            .structure
            .iter()
            .position(|b| b.id == active.block_id.as_ref());
        let Some(row) = found else {
            // The Block went away (undo of a split, reload): land on the row
            // before where it was, at its end.
            let variant = active.variant.clone();
            let row = active.row.min(prayer.structure.len()).saturating_sub(1);
            self.active = None;
            if let Some(block) = prayer.structure.get(row) {
                let id = SharedString::from(block.id.clone());
                self.focus_cell(id, variant, usize::MAX, cx);
            }
            return;
        };
        active.row = row;
        let block = &prayer.structure[row];
        let stored = editor_content(&block.kind, block.translation(active.variant.key()));
        let line_mode = uses_lines(&block.kind);
        if stored != active.committed || line_mode != active.line_mode {
            let old = active.buffer.text().to_owned();
            active.buffer = Cell::from_content(&stored);
            active.committed = stored;
            active.line_mode = line_mode;
            active.marked = None;
            let caret = end_of_change(&old, active.buffer.text());
            active.selection = caret..caret;
            active.reversed = false;
        }
    }

    /// Focuses a cell; `offset` is clamped (`usize::MAX`: the end).
    fn focus_cell(
        &mut self,
        block_id: SharedString,
        variant: VariantRef,
        offset: usize,
        cx: &mut Context<Self>,
    ) {
        let Some(prayer) = self.prayer(cx) else {
            return;
        };
        let Some(row) = prayer
            .structure
            .iter()
            .position(|b| b.id == block_id.as_ref())
        else {
            return;
        };
        let block = &prayer.structure[row];
        let content = editor_content(&block.kind, block.translation(variant.key()));
        let line_mode = uses_lines(&block.kind);
        let same = self
            .active
            .as_ref()
            .is_some_and(|a| a.block_id == block_id && a.variant == variant);
        if !same {
            let buffer = Cell::from_content(&content);
            self.active = Some(Active {
                block_id,
                variant,
                buffer,
                committed: content,
                line_mode,
                selection: 0..0,
                reversed: false,
                marked: None,
                row,
            });
            self.break_coalescing(cx);
        }
        let active = self.active.as_mut().expect("just set");
        let offset = clamp_to_boundary(active.buffer.text(), offset);
        active.selection = offset..offset;
        active.reversed = false;
        cx.notify();
    }

    fn break_coalescing(&self, cx: &mut Context<Self>) {
        self.host.update_draft(cx, &mut |d| d.break_coalescing());
    }

    /// Commits the focused buffer into the draft.
    fn commit(&mut self, kind: EditKind, cx: &mut Context<Self>) {
        let Some(active) = self.active.as_mut() else {
            return;
        };
        let content = active.buffer.to_content(active.line_mode);
        let id = active.block_id.to_string();
        let variant = active.variant.clone();
        let mut stored = None;
        self.host.update_draft(cx, &mut |d| {
            d.edit(kind, |p| {
                edit::set_block_content(p, &id, variant.key(), &content);
            });
            stored = block_editor_content(d.prayer(), &id, variant.key());
        });
        if let (Some(active), Some(stored)) = (self.active.as_mut(), stored) {
            active.committed = stored;
        }
        cx.notify();
    }

    /// A structural edit on the prayer, as one labelled undo step.
    fn edit_prayer<R: Default>(
        &mut self,
        label: &'static str,
        cx: &mut Context<Self>,
        mut f: impl FnMut(&mut Prayer) -> R,
    ) -> R {
        let mut result = None;
        self.host.update_draft(cx, &mut |d| {
            result = Some(d.edit_labeled(EditKind::Other, label, &mut f));
        });
        cx.notify();
        result.unwrap_or_default()
    }

    fn row_of(&self, block_id: &str) -> Option<usize> {
        self.rows.iter().position(|r| r.as_ref() == block_id)
    }

    // -- caret movement -----------------------------------------------------

    fn move_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        if let Some(a) = self.active.as_mut() {
            a.selection = offset..offset;
            a.reversed = false;
        }
        self.break_coalescing(cx);
        cx.notify();
    }

    fn select_to(&mut self, offset: usize, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_mut() else {
            return;
        };
        if a.reversed {
            a.selection.start = offset;
        } else {
            a.selection.end = offset;
        }
        if a.selection.end < a.selection.start {
            a.reversed = !a.reversed;
            a.selection = a.selection.end..a.selection.start;
        }
        self.break_coalescing(cx);
        cx.notify();
    }

    fn active_layout(&self) -> Option<Placed> {
        let a = self.active.as_ref()?;
        let col = self.columns.iter().position(|c| c == &a.variant)?;
        self.layouts.get(&(a.block_id.clone(), col)).cloned()
    }

    /// The neighbouring row's Block in the same column.
    fn neighbour(&self, delta: isize) -> Option<SharedString> {
        let a = self.active.as_ref()?;
        let row = self.row_of(&a.block_id)?;
        let target = row.checked_add_signed(delta)?;
        self.rows.get(target).cloned()
    }

    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        let Some(a) = self.active.as_ref() else {
            return;
        };
        if !a.selection.is_empty() {
            return self.move_to(a.selection.start, cx);
        }
        let c = a.cursor();
        if c == 0 {
            if let Some(prev) = self.neighbour(-1) {
                let variant = a.variant.clone();
                self.focus_cell(prev, variant, usize::MAX, cx);
            }
            return;
        }
        let to = a.buffer.prev_boundary(c);
        self.move_to(to, cx);
    }

    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        self.goal_x = None;
        let Some(a) = self.active.as_ref() else {
            return;
        };
        if !a.selection.is_empty() {
            return self.move_to(a.selection.end, cx);
        }
        let c = a.cursor();
        if c == a.buffer.len() {
            if let Some(next) = self.neighbour(1) {
                let variant = a.variant.clone();
                self.focus_cell(next, variant, 0, cx);
            }
            return;
        }
        let to = a.buffer.next_boundary(c);
        self.move_to(to, cx);
    }

    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(a) = self.active.as_ref() {
            let to = a.buffer.prev_boundary(a.cursor());
            self.select_to(to, cx);
        }
    }

    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(a) = self.active.as_ref() {
            let to = a.buffer.next_boundary(a.cursor());
            self.select_to(to, cx);
        }
    }

    fn word_left(&mut self, _: &WordLeft, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(a) = self.active.as_ref() {
            let to = a.buffer.prev_word_boundary(a.cursor());
            self.move_to(to, cx);
        }
    }

    fn word_right(&mut self, _: &WordRight, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(a) = self.active.as_ref() {
            let to = a.buffer.next_word_boundary(a.cursor());
            self.move_to(to, cx);
        }
    }

    fn select_word_left(&mut self, _: &SelectWordLeft, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(a) = self.active.as_ref() {
            let to = a.buffer.prev_word_boundary(a.cursor());
            self.select_to(to, cx);
        }
    }

    fn select_word_right(&mut self, _: &SelectWordRight, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(a) = self.active.as_ref() {
            let to = a.buffer.next_word_boundary(a.cursor());
            self.select_to(to, cx);
        }
    }

    /// Start of the visual line the caret is on.
    fn line_start(&self) -> Option<usize> {
        let a = self.active.as_ref()?;
        let placed = self.active_layout()?;
        let line = placed.layout.line_for_offset(a.cursor());
        Some(placed.layout.lines[line].range.start)
    }

    fn line_end(&self) -> Option<usize> {
        let a = self.active.as_ref()?;
        match self.active_layout() {
            Some(placed) => {
                let line = placed.layout.line_for_offset(a.cursor());
                Some(placed.layout.lines[line].range.end)
            }
            None => Some(a.buffer.len()),
        }
    }

    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        let to = self.line_start().unwrap_or(0);
        self.move_to(to, cx);
    }

    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(to) = self.line_end() {
            self.move_to(to, cx);
        }
    }

    fn select_home(&mut self, _: &SelectHome, _: &mut Window, cx: &mut Context<Self>) {
        let to = self.line_start().unwrap_or(0);
        self.select_to(to, cx);
    }

    fn select_end(&mut self, _: &SelectEnd, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(to) = self.line_end() {
            self.select_to(to, cx);
        }
    }

    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(a) = self.active.as_mut() {
            a.selection = 0..a.buffer.len();
            a.reversed = false;
            cx.notify();
        }
    }

    /// Up/down inside the wrapped layout; past the first/last visual line it
    /// continues into the Block above/below in the same column at the same x.
    fn vertical(&mut self, down: bool, select: bool, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let Some(placed) = self.active_layout() else {
            return;
        };
        let layout = &placed.layout;
        let pos = layout.position_for_offset(a.cursor());
        let x = *self.goal_x.get_or_insert(pos.x);
        let line = layout.line_for_offset(a.cursor());
        let target = if down {
            line.checked_add(1).filter(|l| *l < layout.lines.len())
        } else {
            line.checked_sub(1)
        };
        if let Some(target) = target {
            let y = layout.lines[target].top + layout.line_height / 2.;
            let offset = layout.offset_for_position(point(x, y));
            return if select {
                self.select_to(offset, cx)
            } else {
                self.move_to(offset, cx)
            };
        }
        if select {
            let offset = if down { a.buffer.len() } else { 0 };
            return self.select_to(offset, cx);
        }
        let Some(next) = self.neighbour(if down { 1 } else { -1 }) else {
            let offset = if down { a.buffer.len() } else { 0 };
            return self.move_to(offset, cx);
        };
        let variant = a.variant.clone();
        let col = self.columns.iter().position(|c| c == &variant);
        let offset = col
            .and_then(|col| self.layouts.get(&(next.clone(), col)))
            .map(|p| {
                let y = if down {
                    p.layout.line_height / 2.
                } else {
                    p.layout.height() - p.layout.line_height / 2.
                };
                p.layout.offset_for_position(point(x, y))
            })
            .unwrap_or(if down { 0 } else { usize::MAX });
        let goal = self.goal_x;
        if let Some(row) = self.row_of(&next) {
            self.list.scroll_to_reveal_item(row);
        }
        self.focus_cell(next, variant, offset, cx);
        self.goal_x = goal;
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

    // -- editing ------------------------------------------------------------

    /// Replaces `range` of the buffer and commits.
    fn replace(&mut self, range: Range<usize>, text: &str, kind: EditKind, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_mut() else {
            return;
        };
        let inserted = a.buffer.replace(range, text);
        a.selection = inserted.end..inserted.end;
        a.reversed = false;
        a.marked = None;
        self.goal_x = None;
        self.commit(kind, cx);
    }

    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let range = if a.selection.is_empty() {
            let c = a.cursor();
            if c == 0 {
                return self.merge_into_previous(window, cx);
            }
            a.buffer.prev_boundary(c)..c
        } else {
            a.selection.clone()
        };
        self.replace(range, "", EditKind::Deleting, cx);
    }

    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let range = if a.selection.is_empty() {
            let c = a.cursor();
            if c == a.buffer.len() {
                return self.merge_next(window, cx);
            }
            c..a.buffer.next_boundary(c)
        } else {
            a.selection.clone()
        };
        self.replace(range, "", EditKind::Deleting, cx);
    }

    fn delete_word_left(&mut self, _: &DeleteWordLeft, _: &mut Window, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let range = if a.selection.is_empty() {
            a.buffer.prev_word_boundary(a.cursor())..a.cursor()
        } else {
            a.selection.clone()
        };
        self.replace(range, "", EditKind::Deleting, cx);
    }

    fn delete_word_right(&mut self, _: &DeleteWordRight, _: &mut Window, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let range = if a.selection.is_empty() {
            a.cursor()..a.buffer.next_word_boundary(a.cursor())
        } else {
            a.selection.clone()
        };
        self.replace(range, "", EditKind::Deleting, cx);
    }

    /// Backspace at the start of a Block: merge it into the Block before it,
    /// in every Variant.
    fn merge_into_previous(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let Some(row) = self.row_of(&a.block_id) else {
            return;
        };
        if row == 0 {
            return;
        }
        let variant = a.variant.clone();
        let outcome = self.edit_prayer("Merge blocks", cx, |p| {
            edit::merge_block_into_previous(p, row)
        });
        let Some(outcome) = outcome else { return };
        let offset = outcome
            .join_points
            .iter()
            .find(|j| j.variant == variant)
            .map_or(usize::MAX, |j| j.offset);
        self.active = None;
        self.focus_cell(outcome.block_id.into(), variant, offset, cx);
    }

    /// Delete at the end of a Block: merge the next Block into this one.
    fn merge_next(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let Some(row) = self.row_of(&a.block_id) else {
            return;
        };
        if row + 1 >= self.rows.len() {
            return;
        }
        let caret = a.cursor();
        let variant = a.variant.clone();
        let block_id = a.block_id.clone();
        let merged = self.edit_prayer("Merge blocks", cx, |p| {
            edit::merge_block_into_previous(p, row + 1)
        });
        if merged.is_some() {
            self.active = None;
            self.focus_cell(block_id, variant, caret, cx);
        }
    }

    /// Enter: split the Block at the caret in this Variant only; the text
    /// after the caret moves to a new Block of the same Kind.
    fn split_block(&mut self, _: &SplitBlock, _: &mut Window, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let Some(row) = self.row_of(&a.block_id) else {
            return;
        };
        let content = a.buffer.to_content(a.line_mode);
        let split = edit::split_editor_content(&content, a.selection.clone(), a.line_mode);
        let variant = a.variant.clone();
        let block_id = a.block_id.to_string();
        let line_mode = a.line_mode;
        let new_id = self.edit_prayer("Split block", cx, |p| {
            let Some(kind) = p.structure.get(row).map(|b| b.kind.clone()) else {
                return String::new();
            };
            let before = split
                .before
                .clone()
                .unwrap_or_else(|| EditorContent::empty(line_mode));
            edit::set_block_content(p, &block_id, variant.key(), &before);
            let id = edit::fresh_block_id(p);
            edit::insert_block_with_id(p, row + 1, &kind, &id);
            if let Some(after) = &split.after {
                edit::set_block_content(p, &id, variant.key(), after);
            }
            id
        });
        if new_id.is_empty() {
            return;
        }
        self.active = None;
        self.sync(cx);
        self.list.scroll_to_reveal_item(row + 1);
        self.focus_cell(new_id.into(), variant, 0, cx);
    }

    /// Shift+Enter: a line break (a new line in verse).
    fn line_break(&mut self, _: &LineBreak, _: &mut Window, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let range = a.selection.clone();
        self.replace(range, "\n", EditKind::Other, cx);
    }

    fn toggle_note(&mut self, _: &ToggleNote, _: &mut Window, cx: &mut Context<Self>) {
        self.toggle_note_in_selection(cx);
    }

    /// For the block menu: `Some(all_note)` when Block `block_id` has a
    /// selection.
    fn note_selection(&self, block_id: &str) -> Option<bool> {
        let a = self.active.as_ref()?;
        (a.block_id.as_ref() == block_id && !a.selection.is_empty())
            .then(|| a.buffer.is_all_note(a.selection.clone()))
    }

    fn toggle_note_in_selection(&mut self, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_mut() else {
            return;
        };
        if a.selection.is_empty() {
            return;
        }
        let content = a.buffer.to_content(a.line_mode);
        let toggled = edit::toggle_note_in_content(&content, a.selection.clone());
        a.buffer = Cell::from_content(&toggled);
        self.commit(EditKind::Other, cx);
    }

    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = self.selected_text() {
            cx.write_to_clipboard(ClipboardItem::new_string(text));
        }
    }

    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        if a.selection.is_empty() {
            return;
        }
        let range = a.selection.clone();
        self.copy(&Copy, window, cx);
        self.replace(range, "", EditKind::Other, cx);
    }

    /// Plain text only, as in the Electron editor.
    fn paste(&mut self, _: &Paste, _: &mut Window, cx: &mut Context<Self>) {
        let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) else {
            return;
        };
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let text = text.replace("\r\n", "\n").replace('\r', "\n");
        let range = a.selection.clone();
        self.replace(range, &text, EditKind::Other, cx);
    }

    // -- Block chrome -------------------------------------------------------

    fn move_block(&mut self, block_id: &str, delta: isize, cx: &mut Context<Self>) {
        let Some(row) = self.row_of(block_id) else {
            return;
        };
        let label = if delta < 0 {
            "Move block up"
        } else {
            "Move block down"
        };
        let moved = self.edit_prayer(label, cx, |p| edit::move_block(p, row, delta));
        if let Some(to) = moved {
            self.sync(cx);
            self.list.scroll_to_reveal_item(to);
        }
    }

    fn delete_block(&mut self, block_id: &str, cx: &mut Context<Self>) {
        let Some(row) = self.row_of(block_id) else {
            return;
        };
        self.edit_prayer("Delete block", cx, |p| edit::delete_block(p, row).is_some());
        self.hover_row = None;
        self.hover_chrome = None;
    }

    fn set_kind(&mut self, block_id: &str, kind: &str, cx: &mut Context<Self>) {
        let Some(row) = self.row_of(block_id) else {
            return;
        };
        self.edit_prayer("Change kind", cx, |p| edit::set_block_kind(p, row, kind));
    }

    /// Appends a Block of `kind` and focuses it in the first column.
    pub fn add_block(&mut self, kind: &str, cx: &mut Context<Self>) {
        self.last_added_kind = kind.to_owned();
        let id = self.edit_prayer("Add block", cx, |p| edit::add_block(p, kind));
        self.sync(cx);
        if let Some(col) = self.columns.first().cloned() {
            self.focus_cell(id.into(), col, 0, cx);
        }
        self.list
            .scroll_to_reveal_item(self.rows.len().saturating_sub(1));
    }

    /// Kinds for pickers: the prayer's, then the Library's.
    fn kind_options(&self, cx: &App) -> Vec<String> {
        let extra = self.host.extra_kinds(cx);
        let extra: Vec<&str> = extra.iter().map(String::as_str).collect();
        self.prayer(cx)
            .map(|p| edit::kind_options(p, &extra))
            .unwrap_or_default()
    }

    // -- revealing ----------------------------------------------------------

    /// Scrolls to a Block, optionally focusing a column and flashing it.
    pub fn reveal_block(
        &mut self,
        block_id: &str,
        scroll: RevealScroll,
        focus: Option<VariantRef>,
        flash: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.sync(cx);
        let Some(row) = self.row_of(block_id) else {
            return;
        };
        match scroll {
            RevealScroll::Nearest => self.list.scroll_to_reveal_item(row),
            RevealScroll::Start => self.list.scroll_to(ListOffset {
                item_ix: row,
                offset_in_item: px(0.),
            }),
        }
        if let Some(variant) = focus {
            window.focus(&self.focus_handle, cx);
            self.focus_cell(block_id.to_owned().into(), variant, usize::MAX, cx);
        }
        if flash {
            self.flash = Some(block_id.to_owned().into());
            self.flash_task = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(FLASH).await;
                this.update(cx, |this, cx| {
                    this.flash = None;
                    cx.notify();
                })
                .ok();
            }));
        }
        cx.notify();
    }

    /// Selects `range` of a cell and scrolls it into view (find).
    pub fn select_range(
        &mut self,
        block_id: &str,
        variant: VariantRef,
        range: Range<usize>,
        cx: &mut Context<Self>,
    ) {
        self.sync(cx);
        let Some(row) = self.row_of(block_id) else {
            return;
        };
        self.list.scroll_to_reveal_item(row);
        self.focus_cell(block_id.to_owned().into(), variant, range.start, cx);
        if let Some(a) = self.active.as_mut() {
            let end = clamp_to_boundary(a.buffer.text(), range.end);
            a.selection = a.selection.start..end.max(a.selection.start);
        }
        cx.notify();
    }

    /// Jumps to the next Block without text in `variant` (after the focused
    /// one, wrapping around).
    fn jump_to_next_empty(
        &mut self,
        variant: VariantRef,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(prayer) = self.prayer(cx) else {
            return;
        };
        let start = self
            .active
            .as_ref()
            .and_then(|a| self.row_of(&a.block_id))
            .map_or(0, |r| r + 1);
        let n = prayer.structure.len();
        let target = (0..n)
            .map(|i| (start + i) % n)
            .find(|&i| !edit::is_translation_filled(prayer, &prayer.structure[i].id, variant.key()))
            .map(|i| prayer.structure[i].id.clone());
        if let Some(id) = target {
            self.reveal_block(&id, RevealScroll::Nearest, Some(variant), true, window, cx);
        }
    }

    // -- mouse --------------------------------------------------------------

    /// The cell under (or nearest to) a window position, and the offset.
    fn cell_at(&self, position: Point<Pixels>) -> Option<(SharedString, usize, usize)> {
        let mut best: Option<(&CellKey, &Placed, Pixels)> = None;
        for (key, placed) in &self.layouts {
            let b = placed.bounds;
            let dx = if position.x < b.left() {
                b.left() - position.x
            } else if position.x > b.right() {
                position.x - b.right()
            } else {
                px(0.)
            };
            let dy = if position.y < b.top() {
                b.top() - position.y
            } else if position.y > b.bottom() {
                position.y - b.bottom()
            } else {
                px(0.)
            };
            // Columns first: a click in a column's margin goes to that column.
            let d = dx * 4. + dy;
            if best.is_none_or(|(_, _, bd)| d < bd) {
                best = Some((key, placed, d));
            }
        }
        let (key, placed, _) = best?;
        let offset = placed
            .layout
            .offset_for_position(position - placed.bounds.origin);
        Some((key.0.clone(), key.1, offset))
    }

    fn word_at(&self, offset: usize) -> Range<usize> {
        let Some(a) = self.active.as_ref() else {
            return offset..offset;
        };
        let cell = &a.buffer;
        let start = cell.prev_word_boundary(cell.next_boundary(offset).min(cell.len()));
        start..cell.next_word_boundary(start)
    }

    fn on_mouse_down(
        &mut self,
        event: &MouseDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        window.focus(&self.focus_handle, cx);
        self.goal_x = None;
        let Some((block_id, col, offset)) = self.cell_at(event.position) else {
            return;
        };
        let Some(variant) = self.columns.get(col).cloned() else {
            return;
        };
        let same = self
            .active
            .as_ref()
            .is_some_and(|a| a.block_id == block_id && a.variant == variant);
        if event.modifiers.shift && same {
            self.select_to(offset, cx);
        } else if event.click_count >= 3 && same {
            if let Some(a) = self.active.as_mut() {
                a.selection = 0..a.buffer.len();
                a.reversed = false;
            }
            self.word_anchor = None;
            self.selecting = false;
            cx.notify();
            return;
        } else if event.click_count == 2 && same {
            let word = self.word_at(offset);
            if let Some(a) = self.active.as_mut() {
                a.selection = word.clone();
                a.reversed = false;
            }
            self.word_anchor = Some(word);
            self.selecting = true;
            cx.notify();
            return;
        } else {
            self.focus_cell(block_id, variant, offset, cx);
        }
        self.word_anchor = None;
        self.selecting = true;
    }

    fn on_mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.selecting || !event.dragging() {
            return;
        }
        // The selection stays inside the focused cell, as in the Electron editor.
        let Some(placed) = self.active_layout() else {
            return;
        };
        let offset = placed
            .layout
            .offset_for_position(event.position - placed.bounds.origin);
        if let Some(anchor) = self.word_anchor.clone() {
            // After a double-click, grow the selection in whole words.
            let word = self.word_at(offset);
            if let Some(a) = self.active.as_mut() {
                a.reversed = word.start < anchor.start;
                a.selection = anchor.start.min(word.start)..anchor.end.max(word.end);
            }
            cx.notify();
        } else {
            self.select_to(offset, cx);
        }
    }

    fn on_mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.selecting = false;
        self.word_anchor = None;
    }

    // -- UTF-16 for the platform input handler -------------------------------

    fn text(&self) -> &str {
        self.active.as_ref().map_or("", |a| a.buffer.text())
    }

    fn offset_to_utf16(&self, offset: usize) -> usize {
        let text = self.text();
        text[..offset.min(text.len())].encode_utf16().count()
    }

    fn offset_from_utf16(&self, offset: usize) -> usize {
        let mut utf16 = 0;
        for (i, ch) in self.text().char_indices() {
            if utf16 >= offset {
                return i;
            }
            utf16 += ch.len_utf16();
        }
        self.text().len()
    }

    fn range_to_utf16(&self, r: &Range<usize>) -> Range<usize> {
        self.offset_to_utf16(r.start)..self.offset_to_utf16(r.end)
    }

    fn range_from_utf16(&self, r: &Range<usize>) -> Range<usize> {
        self.offset_from_utf16(r.start)..self.offset_from_utf16(r.end)
    }

    // -- rendering ------------------------------------------------------------

    fn render_column_labels(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = palette(cx).clone();
        let fills: Vec<edit::Fill> = self
            .prayer(cx)
            .map(|prayer| {
                self.columns
                    .iter()
                    .map(|c| edit::fill(prayer, c.key()))
                    .collect()
            })
            .unwrap_or_default();
        div()
            .flex()
            .flex_row()
            .px(px(28.))
            .border_b_1()
            .border_color(p.border)
            .bg(p.glass)
            .children(
                self.columns
                    .iter()
                    .zip(fills)
                    .enumerate()
                    .map(|(ix, (col, fill))| {
                        let complete = fill.total > 0 && fill.filled == fill.total;
                        let variant = col.clone();
                        let title = if complete {
                            "All blocks filled".to_string()
                        } else {
                            format!(
                                "{} of {} blocks filled — click to jump to next empty",
                                fill.filled, fill.total
                            )
                        };
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .py_1()
                            .px_3()
                            .text_size(px(11.))
                            .text_color(p.text_secondary)
                            .child(
                                div()
                                    .font_weight(FontWeight(650.))
                                    .child(col.lang.to_uppercase()),
                            )
                            .child(div().opacity(0.75).truncate().child(col.variant.clone()))
                            .child(div().flex_1())
                            .child(
                                div()
                                    .id(("fill", ix))
                                    .px(px(7.))
                                    .py(px(3.))
                                    .rounded_full()
                                    .bg(p.hover)
                                    .font_weight(FontWeight(650.))
                                    .text_color(if complete { p.text_secondary } else { p.accent })
                                    .when(complete || fill.total == 0, |d| d.opacity(0.7))
                                    .when(!complete && fill.total > 0, |d| {
                                        d.cursor_pointer()
                                            .hover(|d| d.bg(p.hover_strong))
                                            .on_mouse_down(MouseButton::Left, |_, _, cx| {
                                                cx.stop_propagation()
                                            })
                                            .on_click(cx.listener(move |this, _, window, cx| {
                                                this.jump_to_next_empty(variant.clone(), window, cx)
                                            }))
                                    })
                                    .tooltip(move |window, cx| {
                                        gpui_kit::component::tooltip::Tooltip::new(title.clone())
                                            .build(window, cx)
                                    })
                                    .child(format!("{}%", fill.percent())),
                            )
                    }),
            )
    }

    fn render_row(&mut self, ix: usize, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        if ix >= self.rows.len() {
            return self.render_add_block(cx).into_any_element();
        }
        let p = palette(cx).clone();
        let Some(prayer) = self.prayer(cx) else {
            return div().into_any_element();
        };
        let Some(block) = prayer.structure.get(ix) else {
            return div().into_any_element();
        };
        let block_id: SharedString = block.id.clone().into();
        let kind = block.kind.clone();
        let styles = self.host.styles(cx);
        let kind_style = styles.get(&kind).unwrap_or(&FALLBACK_KIND_STYLE);
        let note_color = styles
            .get("annotation")
            .map_or(FALLBACK_KIND_STYLE.color.as_str(), |s| s.color.as_str());
        let cell_style = CellStyle::new(kind_style, note_color, &p);
        let placeholder: SharedString = kind_display_label(&kind).to_owned().into();
        let focused = self.focus_handle.is_focused(window);
        let editor = cx.entity();

        let cells: Vec<CellElement> = self
            .columns
            .iter()
            .enumerate()
            .map(|(col, variant)| {
                let active = self
                    .active
                    .as_ref()
                    .filter(|a| a.block_id == block_id && &a.variant == variant);
                let cell = match active {
                    Some(a) => a.buffer.clone(),
                    None => {
                        Cell::from_content(&editor_content(&kind, block.translation(variant.key())))
                    }
                };
                let highlights = self
                    .highlights
                    .iter()
                    .filter(|h| h.block_id == block_id.as_ref() && &h.variant == variant)
                    .map(|h| {
                        (
                            h.range.clone(),
                            if h.current {
                                p.find_current
                            } else {
                                p.find_match
                            },
                        )
                    })
                    .collect();
                CellElement {
                    editor: editor.clone(),
                    key: (block_id.clone(), col),
                    cell,
                    style: cell_style.clone(),
                    placeholder: placeholder.clone(),
                    caret: active.map(|a| element::Caret {
                        selection: a.selection.clone(),
                        cursor: a.cursor(),
                        marked: a.marked.clone(),
                        focused,
                    }),
                    highlights,
                    selection_color: p.selection,
                    caret_color: p.text,
                    accent: p.accent,
                    placeholder_color: Palette::fade(p.text_secondary, 0.7),
                }
            })
            .collect();

        let hovered = self.hover_row.as_ref() == Some(&block_id)
            || self.hover_chrome.as_ref() == Some(&block_id)
            || self.menu_row.as_ref() == Some(&block_id);
        let flashing = self.flash.as_ref() == Some(&block_id);
        let has_focus_within =
            self.active.as_ref().is_some_and(|a| a.block_id == block_id) && focused;
        let last = ix + 1 == self.rows.len();
        let split = self.columns.len() > 1;
        let indicate = cell_style.indicate;
        let problems = block_errors(self.draft(cx).map_or(&[], |d| d.errors()), ix);
        let danger = <App as gpui_kit::component::ActiveTheme>::theme(cx).danger;

        let row_id = block_id.clone();
        let chrome = self.render_chrome(&block_id, &kind, ix == 0, last, &p, cx);

        div()
            .id(("row", ix))
            .px(px(20.))
            .pt(if ix == 0 { px(36.) } else { px(0.) })
            .child(
                div()
                    .id(SharedString::from(format!("block-{block_id}")))
                    .relative()
                    .rounded(px(10.))
                    .when(hovered || has_focus_within, |d| d.bg(p.hover))
                    .when(flashing, |d| d.bg(Palette::fade(p.accent, 0.07)))
                    .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                        if *hovered {
                            this.hover_row = Some(row_id.clone());
                        } else if this.hover_row.as_ref() == Some(&row_id) {
                            this.hover_row = None;
                        }
                        cx.notify();
                    }))
                    .context_menu({
                        let editor = editor.clone();
                        let block_id = block_id.clone();
                        let kinds = self.kind_options(cx);
                        let kind = kind.clone();
                        let note = self.note_selection(&block_id);
                        move |menu, _, _| {
                            let menu =
                                match note {
                                    Some(all_note) => {
                                        let editor = editor.clone();
                                        menu.item(
                                            PopupMenuItem::new(if all_note {
                                                "Remove inline note"
                                            } else {
                                                "Mark as inline note"
                                            })
                                            .on_click(move |_, _, cx| {
                                                editor.update(cx, |this, cx| {
                                                    this.toggle_note_in_selection(cx)
                                                })
                                            }),
                                        )
                                        .separator()
                                    }
                                    None => menu,
                                };
                            block_menu(menu, &editor, &block_id, &kind, &kinds, ix == 0, last)
                        }
                    })
                    .when(!problems.is_empty(), |d| {
                        d.border_1().border_color(Palette::fade(danger, 0.6)).child(
                            div()
                                .id("problems")
                                .absolute()
                                .top(px(12.))
                                .left(px(-17.))
                                .size(px(14.))
                                .rounded_full()
                                .bg(danger)
                                .text_color(p.on_accent)
                                .text_size(px(10.))
                                .font_weight(FontWeight::BOLD)
                                .flex()
                                .items_center()
                                .justify_center()
                                .child("!")
                                .tooltip(move |window, cx| {
                                    gpui_kit::component::tooltip::Tooltip::new(problems.join("\n"))
                                        .build(window, cx)
                                }),
                        )
                    })
                    .when(indicate, |d| {
                        d.child(
                            div()
                                .absolute()
                                .top(px(18.))
                                .left(px(-12.))
                                .size(px(8.))
                                .rounded_full()
                                .bg(Palette::fade(p.accent, 0.5)),
                        )
                    })
                    .child(
                        div()
                            .flex()
                            .flex_row()
                            .children(cells.into_iter().enumerate().map(|(col, cell)| {
                                let first = col == 0;
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .py_2()
                                    .px_3()
                                    .when(split && first, |d| d.pr(px(32.)))
                                    .when(split && !first, |d| {
                                        d.pl(px(32.)).border_l_1().border_color(p.border_strong)
                                    })
                                    .cursor(CursorStyle::IBeam)
                                    .child(cell)
                            })),
                    )
                    .when(hovered, |d| d.child(chrome)),
            )
            .into_any_element()
    }

    fn render_chrome(
        &self,
        block_id: &SharedString,
        kind: &str,
        first: bool,
        last: bool,
        p: &Palette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let editor = cx.entity();
        let kinds = self.kind_options(cx);
        let id_up = block_id.to_string();
        let id_down = block_id.to_string();
        let id_delete = block_id.to_string();
        let chrome_id = block_id.clone();
        let menu_id = block_id.clone();
        let kind_owned = kind.to_owned();
        let editor_for_menu = editor.clone();
        let block_for_menu = block_id.clone();
        div()
            .id("chrome")
            .absolute()
            .top(px(-30.))
            .right(px(6.))
            .flex()
            .items_center()
            .gap_1()
            .p(px(3.))
            .rounded(px(8.))
            .bg(p.glass)
            .border_1()
            .border_color(p.border)
            .shadow_sm()
            .occlude()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_hover(cx.listener(move |this, hovered: &bool, _, cx| {
                if *hovered {
                    this.hover_chrome = Some(chrome_id.clone());
                } else if this.hover_chrome.as_ref() == Some(&chrome_id) {
                    this.hover_chrome = None;
                }
                cx.notify();
            }))
            .child(
                Button::new("kind")
                    .ghost()
                    .xsmall()
                    .label(kind_display_label(kind).to_owned())
                    .dropdown_caret(true)
                    .dropdown_menu(move |menu, _, _| {
                        kind_menu(menu, &editor_for_menu, &block_for_menu, &kind_owned, &kinds)
                    })
                    .on_open_change(cx.listener(move |this, open: &bool, _, cx| {
                        this.menu_row = open.then(|| menu_id.clone());
                        cx.notify();
                    })),
            )
            .child(
                Button::new("up")
                    .ghost()
                    .xsmall()
                    .icon(IconName::ArrowUp)
                    .tooltip("Move up")
                    .disabled(first)
                    .on_click(cx.listener(move |this, _, _, cx| this.move_block(&id_up, -1, cx))),
            )
            .child(
                Button::new("down")
                    .ghost()
                    .xsmall()
                    .icon(IconName::ArrowDown)
                    .tooltip("Move down")
                    .disabled(last)
                    .on_click(cx.listener(move |this, _, _, cx| this.move_block(&id_down, 1, cx))),
            )
            .child(
                Button::new("delete")
                    .ghost()
                    .xsmall()
                    .icon(IconName::Delete)
                    .tooltip("Delete block")
                    .on_click(cx.listener(move |this, _, _, cx| this.delete_block(&id_delete, cx))),
            )
            .into_any_element()
    }

    fn render_add_block(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let kind = self.last_added_kind.clone();
        let kinds = self.kind_options(cx);
        let editor = cx.entity();
        let add_kind = kind.clone();
        div()
            .px(px(28.))
            .pt_3()
            .pb(px(48.))
            .flex()
            .items_center()
            .gap_1()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(
                Button::new("add-block")
                    .ghost()
                    .small()
                    .icon(IconName::Plus)
                    .label(format!("Add {}", kind_display_label(&kind)))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        window.focus(&this.focus_handle, cx);
                        this.add_block(&add_kind, cx)
                    })),
            )
            .child(
                Button::new("add-block-kind")
                    .ghost()
                    .small()
                    .icon(IconName::ChevronDown)
                    .tooltip("Choose block kind")
                    .dropdown_menu(move |mut menu, _, _| {
                        for k in &kinds {
                            let editor = editor.clone();
                            let k2 = k.clone();
                            menu = menu.item(
                                PopupMenuItem::new(kind_display_label(k).to_owned())
                                    .disabled(*k == kind)
                                    .on_click(move |_, window, cx| {
                                        editor.update(cx, |this, cx| {
                                            window.focus(&this.focus_handle, cx);
                                            this.add_block(&k2, cx)
                                        })
                                    }),
                            );
                        }
                        menu
                    }),
            )
    }
}

/// The Kind picker: every Kind (current one checked), then new/edit.
fn kind_menu(
    mut menu: PopupMenu,
    editor: &Entity<PrayerEditor>,
    block_id: &SharedString,
    current: &str,
    kinds: &[String],
) -> PopupMenu {
    for kind in kinds {
        let editor = editor.clone();
        let id = block_id.to_string();
        let k = kind.clone();
        menu = menu.item(
            PopupMenuItem::new(kind_display_label(kind).to_owned())
                .checked(kind == current)
                .on_click(move |_, _, cx| editor.update(cx, |this, cx| this.set_kind(&id, &k, cx))),
        );
    }
    let edit_editor = editor.clone();
    let new_editor = editor.clone();
    let kind = current.to_owned();
    let id = block_id.to_string();
    menu.separator()
        .item(PopupMenuItem::new("New kind…").on_click(move |_, _, cx| {
            new_editor.update(cx, |_, cx| {
                cx.emit(EditorEvent::NewKind {
                    block_id: id.clone(),
                })
            })
        }))
        .item(
            PopupMenuItem::new(format!("Edit “{}”…", kind_display_label(current))).on_click(
                move |_, _, cx| {
                    edit_editor.update(cx, |_, cx| cx.emit(EditorEvent::EditKind(kind.clone())))
                },
            ),
        )
}

/// Right-click menu of a Block.
fn block_menu(
    menu: PopupMenu,
    editor: &Entity<PrayerEditor>,
    block_id: &SharedString,
    kind: &str,
    kinds: &[String],
    first: bool,
    last: bool,
) -> PopupMenu {
    let kind_entity = cx_free_submenu_items(editor, block_id, kind, kinds);
    let (e1, e2, e3) = (editor.clone(), editor.clone(), editor.clone());
    let (i1, i2, i3) = (
        block_id.to_string(),
        block_id.to_string(),
        block_id.to_string(),
    );
    let mut menu = menu.label("Kind");
    for item in kind_entity {
        menu = menu.item(item);
    }
    menu.separator()
        .item(
            PopupMenuItem::new("Move up")
                .icon(IconName::ArrowUp)
                .disabled(first)
                .on_click(move |_, _, cx| e1.update(cx, |this, cx| this.move_block(&i1, -1, cx))),
        )
        .item(
            PopupMenuItem::new("Move down")
                .icon(IconName::ArrowDown)
                .disabled(last)
                .on_click(move |_, _, cx| e2.update(cx, |this, cx| this.move_block(&i2, 1, cx))),
        )
        .separator()
        .item(
            PopupMenuItem::new("Delete block")
                .icon(IconName::Delete)
                .on_click(move |_, _, cx| e3.update(cx, |this, cx| this.delete_block(&i3, cx))),
        )
}

fn cx_free_submenu_items(
    editor: &Entity<PrayerEditor>,
    block_id: &SharedString,
    current: &str,
    kinds: &[String],
) -> Vec<PopupMenuItem> {
    kinds
        .iter()
        .map(|kind| {
            let editor = editor.clone();
            let id = block_id.to_string();
            let k = kind.clone();
            PopupMenuItem::new(kind_display_label(kind).to_owned())
                .checked(kind == current)
                .on_click(move |_, _, cx| editor.update(cx, |this, cx| this.set_kind(&id, &k, cx)))
        })
        .collect()
}

/// Where the caret goes after the text changed under it from `old` to
/// `new`: the end of the changed region in `new`.
fn end_of_change(old: &str, new: &str) -> usize {
    let prefix = old
        .char_indices()
        .zip(new.chars())
        .take_while(|((_, a), b)| a == b)
        .last()
        .map_or(0, |((i, a), _)| i + a.len_utf8());
    let suffix = old[prefix..]
        .chars()
        .rev()
        .zip(new[prefix..].chars().rev())
        .take_while(|(a, b)| a == b)
        .map(|(a, _)| a.len_utf8())
        .sum::<usize>();
    clamp_to_boundary(new, new.len() - suffix.min(new.len() - prefix))
}

fn clamp_to_boundary(text: &str, offset: usize) -> usize {
    let mut offset = offset.min(text.len());
    while !text.is_char_boundary(offset) {
        offset -= 1;
    }
    offset
}

impl EntityInputHandler for PrayerEditor {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        self.active.as_ref()?;
        let range = self.range_from_utf16(&range);
        actual.replace(self.range_to_utf16(&range));
        Some(self.text()[range].to_string())
    }

    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let a = self.active.as_ref()?;
        Some(UTF16Selection {
            range: self.range_to_utf16(&a.selection),
            reversed: a.reversed,
        })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        let marked = self.active.as_ref()?.marked.clone()?;
        Some(self.range_to_utf16(&marked))
    }

    fn unmark_text(&mut self, _: &mut Window, _: &mut Context<Self>) {
        if let Some(a) = self.active.as_mut() {
            a.marked = None;
        }
    }

    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let range = range
            .map(|r| self.range_from_utf16(&r))
            .or(a.marked.clone())
            .unwrap_or(a.selection.clone());
        // Text from the platform never splits a Block; a newline from the
        // IME is a line break.
        self.replace(range, text, EditKind::Typing, cx);
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        new_selected: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(a) = self.active.as_ref() else {
            return;
        };
        let range = range
            .map(|r| self.range_from_utf16(&r))
            .or(a.marked.clone())
            .unwrap_or(a.selection.clone());
        let base16 = self.offset_to_utf16(range.start);
        let Some(a) = self.active.as_mut() else {
            return;
        };
        let inserted = a.buffer.replace(range, text);
        a.marked = (!text.is_empty()).then_some(inserted.clone());
        a.selection = inserted.end..inserted.end;
        a.reversed = false;
        if let Some(sel) = new_selected {
            let s = self.offset_from_utf16(base16 + sel.start);
            let e = self.offset_from_utf16(base16 + sel.end);
            if let Some(a) = self.active.as_mut() {
                a.selection = s..e;
            }
        }
        self.commit(EditKind::Typing, cx);
    }

    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        _element_bounds: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let placed = self.active_layout()?;
        let range = self.range_from_utf16(&range);
        let start = placed.layout.position_for_offset(range.start);
        let end = placed.layout.position_for_offset(range.end);
        let origin = placed.bounds.origin;
        Some(Bounds::from_corners(
            origin + start,
            origin
                + point(
                    end.x.max(start.x + px(1.)),
                    end.y + placed.layout.line_height,
                ),
        ))
    }

    fn character_index_for_point(
        &mut self,
        position: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        let placed = self.active_layout()?;
        let offset = placed
            .layout
            .offset_for_position(position - placed.bounds.origin);
        Some(self.offset_to_utf16(offset))
    }
}

impl Focusable for PrayerEditor {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for PrayerEditor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync(cx);
        self.layouts.clear();
        let top = self.top_block();
        if top != self.reported_top {
            self.reported_top = top;
            cx.emit(EditorEvent::Scrolled);
        }
        let split = self.columns.len() > 1;
        let rows = list(
            self.list.clone(),
            cx.processor(|this, ix, window, cx| this.render_row(ix, window, cx)),
        )
        .flex_1()
        .size_full();
        let _ = window;

        div()
            .key_context(CONTEXT)
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::delete_word_left))
            .on_action(cx.listener(Self::delete_word_right))
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
            .on_action(cx.listener(Self::select_home))
            .on_action(cx.listener(Self::select_end))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::split_block))
            .on_action(cx.listener(Self::line_break))
            .on_action(cx.listener(Self::toggle_note))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::cut))
            .on_action(cx.listener(Self::paste))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_mouse_down))
            .on_mouse_move(cx.listener(Self::on_mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_mouse_up))
            .size_full()
            .flex()
            .flex_col()
            .when(split, |d| d.child(self.render_column_labels(cx)))
            .child(rows)
    }
}

/// Validation messages for the Block at `ix` (live, from the draft), with
/// the part of the path below the Block so the field is named.
fn block_errors(errors: &[prayer_core::ValidationError], ix: usize) -> Vec<String> {
    let prefix = format!("/structure/{ix}");
    errors
        .iter()
        .filter_map(|e| {
            let rest = e.path.strip_prefix(&prefix)?;
            if rest.is_empty() {
                Some(e.message.clone())
            } else {
                let field = rest.strip_prefix('/')?;
                Some(format!("{field}: {}", e.message))
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::end_of_change;

    #[test]
    fn caret_after_change() {
        assert_eq!(end_of_change("abc", "abXc"), 3);
        assert_eq!(end_of_change("abc", "ac"), 1);
        assert_eq!(end_of_change("abc", "abc"), 3);
        assert_eq!(end_of_change("", "hello"), 5);
        assert_eq!(end_of_change("aaa", "aaaa"), 4);
        assert_eq!(end_of_change("Ѿx", "Ѿyx"), 3);
    }
}
