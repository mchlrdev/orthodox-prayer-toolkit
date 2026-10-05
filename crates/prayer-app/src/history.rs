//! Snapshot-based undo/redo, generic over the state it snapshots.
//!
//! The Session draft keeps one `History<Prayer>` per prayer. Consecutive
//! typing (or consecutive deleting) coalesces into one undo step; everything
//! else is a step of its own. The history is capped, and a new edit clears
//! the redo stack.

use std::collections::VecDeque;

/// Most undo steps kept; the oldest are dropped first.
pub const HISTORY_CAP: usize = 500;

/// What an edit did, used to coalesce consecutive typing into one undo step.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditKind {
    /// Inserting text. Consecutive `Typing` edits coalesce.
    Typing,
    /// Deleting text. Consecutive `Deleting` edits coalesce.
    Deleting,
    /// Anything else (split, merge, kind change, settings, replace...). Never
    /// coalesces and breaks a running `Typing`/`Deleting` run.
    Other,
}

/// One undo or redo step: the state to go back to, and what the edit was
/// called (for "Undo split block" in the UI).
#[derive(Clone, Debug)]
struct Entry<T> {
    state: T,
    label: Option<&'static str>,
}

/// Undo/redo over any cloneable state.
#[derive(Clone, Debug)]
pub struct History<T: Clone> {
    undo: VecDeque<Entry<T>>,
    redo: Vec<Entry<T>>,
    last: Option<EditKind>,
}

impl<T: Clone> Default for History<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: Clone> History<T> {
    pub fn new() -> Self {
        Self {
            undo: VecDeque::new(),
            redo: Vec::new(),
            last: None,
        }
    }

    /// Records an edit. Call with the state **as it was before** the edit.
    ///
    /// A `Typing` (or `Deleting`) edit right after another of the same kind
    /// is coalesced: only the first of the run pushes a step. `Other` always
    /// pushes. Any record clears redo.
    pub fn record(&mut self, before: T, kind: EditKind) {
        self.record_with(before, kind, None);
    }

    /// [`record`](Self::record) with a label naming the edit. When the edit
    /// coalesces into the previous step, the step keeps its first label.
    pub fn record_labeled(&mut self, before: T, kind: EditKind, label: &'static str) {
        self.record_with(before, kind, Some(label));
    }

    fn record_with(&mut self, before: T, kind: EditKind, label: Option<&'static str>) {
        self.redo.clear();
        let coalesce = kind != EditKind::Other && self.last == Some(kind);
        if !coalesce {
            self.undo.push_back(Entry {
                state: before,
                label,
            });
            self.trim();
        }
        self.last = Some(kind);
    }

    /// Ends a typing/deleting run, so the next edit starts a new step (e.g.
    /// after the caret moved by mouse or arrow keys).
    pub fn break_coalescing(&mut self) {
        self.last = None;
    }

    /// Steps back: returns the state to restore and keeps `current` for redo.
    pub fn undo(&mut self, current: T) -> Option<T> {
        let entry = self.undo.pop_back()?;
        self.redo.push(Entry {
            state: current,
            label: entry.label,
        });
        self.last = None;
        Some(entry.state)
    }

    /// Steps forward again: returns the state to restore and keeps `current`
    /// for undo.
    pub fn redo(&mut self, current: T) -> Option<T> {
        let entry = self.redo.pop()?;
        self.undo.push_back(Entry {
            state: current,
            label: entry.label,
        });
        self.trim();
        self.last = None;
        Some(entry.state)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Label of the edit `undo` would take back, when it has one.
    pub fn undo_label(&self) -> Option<&'static str> {
        self.undo.back().and_then(|e| e.label)
    }

    /// Label of the edit `redo` would re-apply, when it has one.
    pub fn redo_label(&self) -> Option<&'static str> {
        self.redo.last().and_then(|e| e.label)
    }

    /// Number of undo steps available.
    pub fn undo_len(&self) -> usize {
        self.undo.len()
    }

    /// Number of redo steps available.
    pub fn redo_len(&self) -> usize {
        self.redo.len()
    }

    fn trim(&mut self) {
        while self.undo.len() > HISTORY_CAP {
            self.undo.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Applies `edit` to `state` through the history, like a caller would.
    fn apply(h: &mut History<i32>, state: &mut i32, next: i32, kind: EditKind) {
        h.record(*state, kind);
        *state = next;
    }

    #[test]
    fn typing_run_is_one_step() {
        let mut h = History::new();
        let mut s = 0;
        for i in 1..=3 {
            apply(&mut h, &mut s, i, EditKind::Typing);
        }
        assert_eq!(h.undo_len(), 1);
        assert_eq!(h.undo(s), Some(0));
        assert!(!h.can_undo());
    }

    #[test]
    fn other_breaks_and_never_coalesces() {
        let mut h = History::new();
        let mut s = 0;
        apply(&mut h, &mut s, 1, EditKind::Typing);
        apply(&mut h, &mut s, 2, EditKind::Other);
        apply(&mut h, &mut s, 3, EditKind::Typing);
        apply(&mut h, &mut s, 4, EditKind::Typing);
        apply(&mut h, &mut s, 5, EditKind::Other);
        apply(&mut h, &mut s, 6, EditKind::Other);
        // typing(0), other(1), typing(2..4 as one), other(4), other(5)
        assert_eq!(h.undo_len(), 5);
    }

    #[test]
    fn typing_and_deleting_do_not_coalesce_with_each_other() {
        let mut h = History::new();
        let mut s = 0;
        apply(&mut h, &mut s, 1, EditKind::Typing);
        apply(&mut h, &mut s, 2, EditKind::Deleting);
        apply(&mut h, &mut s, 3, EditKind::Deleting);
        apply(&mut h, &mut s, 4, EditKind::Typing);
        assert_eq!(h.undo_len(), 3);
    }

    #[test]
    fn break_coalescing_starts_a_new_step() {
        let mut h = History::new();
        let mut s = 0;
        apply(&mut h, &mut s, 1, EditKind::Typing);
        h.break_coalescing();
        apply(&mut h, &mut s, 2, EditKind::Typing);
        assert_eq!(h.undo_len(), 2);
    }

    #[test]
    fn undo_and_redo_round_trip() {
        let mut h = History::new();
        let mut s = 0;
        apply(&mut h, &mut s, 1, EditKind::Other);
        apply(&mut h, &mut s, 2, EditKind::Other);
        s = h.undo(s).unwrap();
        assert_eq!(s, 1);
        s = h.undo(s).unwrap();
        assert_eq!(s, 0);
        assert_eq!(h.undo(s), None);
        s = h.redo(s).unwrap();
        s = h.redo(s).unwrap();
        assert_eq!(s, 2);
        assert_eq!(h.redo(s), None);
        assert_eq!(h.undo_len(), 2);
    }

    #[test]
    fn undo_ends_a_typing_run() {
        let mut h = History::new();
        let mut s = 0;
        apply(&mut h, &mut s, 1, EditKind::Typing);
        s = h.undo(s).unwrap();
        apply(&mut h, &mut s, 5, EditKind::Typing);
        assert_eq!(h.undo_len(), 1);
        assert_eq!(h.undo(s), Some(0));
    }

    #[test]
    fn new_record_clears_redo() {
        let mut h = History::new();
        let mut s = 0;
        apply(&mut h, &mut s, 1, EditKind::Other);
        s = h.undo(s).unwrap();
        assert!(h.can_redo());
        apply(&mut h, &mut s, 9, EditKind::Other);
        assert!(!h.can_redo());
    }

    #[test]
    fn capped_at_history_cap_dropping_oldest() {
        let mut h = History::new();
        let mut s = 0;
        for i in 1..=(HISTORY_CAP as i32 + 10) {
            apply(&mut h, &mut s, i, EditKind::Other);
        }
        assert_eq!(h.undo_len(), HISTORY_CAP);
        let mut state = s;
        while let Some(prev) = h.undo(state) {
            state = prev;
        }
        assert_eq!(state, 10, "the 10 oldest steps were dropped");
    }

    #[test]
    fn redo_respects_cap() {
        let mut h = History::new();
        let mut s = 0;
        for i in 1..=HISTORY_CAP as i32 {
            apply(&mut h, &mut s, i, EditKind::Other);
        }
        s = h.undo(s).unwrap();
        s = h.redo(s).unwrap();
        assert_eq!(h.undo_len(), HISTORY_CAP);
        assert_eq!(s, HISTORY_CAP as i32);
    }

    #[test]
    fn labels_follow_the_step_through_undo_and_redo() {
        let mut h = History::new();
        let mut s = 0;
        h.record_labeled(s, EditKind::Other, "Split block");
        s = 1;
        h.record(s, EditKind::Other);
        s = 2;
        assert_eq!(h.undo_label(), None);
        s = h.undo(s).unwrap();
        assert_eq!(h.undo_label(), Some("Split block"));
        assert_eq!(h.redo_label(), None);
        s = h.undo(s).unwrap();
        assert_eq!(h.redo_label(), Some("Split block"));
        s = h.redo(s).unwrap();
        assert_eq!(s, 1);
        assert_eq!(h.undo_label(), Some("Split block"));
    }

    #[test]
    fn coalesced_step_keeps_first_label() {
        let mut h = History::new();
        h.record_labeled(0, EditKind::Typing, "Typing");
        h.record_labeled(1, EditKind::Typing, "Other label");
        assert_eq!(h.undo_len(), 1);
        assert_eq!(h.undo_label(), Some("Typing"));
    }
}
