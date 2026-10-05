//! PROTOTYPE — pure document model for the inline editor prototype.

use std::collections::VecDeque;
use std::ops::Range;

use unicode_segmentation::UnicodeSegmentation;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunKind {
    Text,
    Note,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub len: usize,
    pub kind: RunKind,
}

/// Text of one Block plus its run styling.
/// Invariants (enforced after every mutation by `normalize`):
/// sum of span lens == text.len(); no zero-length spans; adjacent spans of the same kind are merged.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Cell {
    text: String,
    spans: Vec<Span>,
}

impl Cell {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_runs(runs: &[(RunKind, &str)]) -> Self {
        let mut cell = Cell::new();
        for (kind, s) in runs {
            cell.text.push_str(s);
            cell.spans.push(Span {
                len: s.len(),
                kind: *kind,
            });
        }
        cell.normalize();
        cell
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn spans(&self) -> &[Span] {
        &self.spans
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }

    pub fn len(&self) -> usize {
        self.text.len()
    }

    /// Kind that text typed at `offset` should get: the kind of the char just before `offset`;
    /// at offset 0, the kind of the first char; Text if the cell is empty.
    pub fn kind_at(&self, offset: usize) -> RunKind {
        debug_assert!(offset <= self.text.len());
        if self.spans.is_empty() {
            return RunKind::Text;
        }
        if offset == 0 {
            return self.spans[0].kind;
        }
        let target = offset - 1;
        let mut pos = 0;
        for span in &self.spans {
            if target < pos + span.len {
                return span.kind;
            }
            pos += span.len;
        }
        self.spans.last().map_or(RunKind::Text, |s| s.kind)
    }

    /// Replace `range` with `new_text`, which takes `kind_at(range.start)`.
    /// Returns the byte range of the inserted text.
    pub fn replace(&mut self, range: Range<usize>, new_text: &str) -> Range<usize> {
        let kind = self.kind_at(range.start);
        self.replace_with_kind(range, new_text, kind)
    }

    /// Same but with an explicit kind for the inserted text.
    pub fn replace_with_kind(
        &mut self,
        range: Range<usize>,
        new_text: &str,
        kind: RunKind,
    ) -> Range<usize> {
        self.check_range(&range);
        let mut spans = self.spans_in(0..range.start);
        spans.push(Span {
            len: new_text.len(),
            kind,
        });
        spans.extend(self.spans_in(range.end..self.text.len()));
        self.text.replace_range(range.clone(), new_text);
        self.spans = spans;
        self.normalize();
        range.start..range.start + new_text.len()
    }

    pub fn set_kind(&mut self, range: Range<usize>, kind: RunKind) {
        self.check_range(&range);
        let mut spans = self.spans_in(0..range.start);
        spans.push(Span {
            len: range.end - range.start,
            kind,
        });
        spans.extend(self.spans_in(range.end..self.text.len()));
        self.spans = spans;
        self.normalize();
    }

    /// If every byte in a non-empty `range` is Note, make it Text; otherwise make it all Note.
    /// Returns the new kind. Empty range: no-op, returns kind_at(range.start).
    pub fn toggle_note(&mut self, range: Range<usize>) -> RunKind {
        self.check_range(&range);
        if range.is_empty() {
            return self.kind_at(range.start);
        }
        let all_note = self
            .spans_in(range.clone())
            .iter()
            .all(|s| s.kind == RunKind::Note);
        let kind = if all_note {
            RunKind::Text
        } else {
            RunKind::Note
        };
        self.set_kind(range, kind);
        kind
    }

    /// Split at `at`: self keeps [0, at), returns [at, len) with its styling.
    pub fn split_off(&mut self, at: usize) -> Cell {
        debug_assert!(at <= self.text.len() && self.text.is_char_boundary(at));
        let tail_spans = self.spans_in(at..self.text.len());
        let head_spans = self.spans_in(0..at);
        let tail_text = self.text.split_off(at);
        self.spans = head_spans;
        self.normalize();
        let mut tail = Cell {
            text: tail_text,
            spans: tail_spans,
        };
        tail.normalize();
        tail
    }

    /// Append another cell's text and styling.
    pub fn append(&mut self, other: Cell) {
        self.text.push_str(&other.text);
        self.spans.extend(other.spans);
        self.normalize();
    }

    /// Runs in order, merged, for display/serialization.
    pub fn to_runs(&self) -> Vec<(RunKind, String)> {
        self.styled_ranges()
            .into_iter()
            .map(|(r, k)| (k, self.text[r].to_string()))
            .collect()
    }

    /// Byte ranges with their kind, in order (for building styled text runs).
    pub fn styled_ranges(&self) -> Vec<(Range<usize>, RunKind)> {
        let mut pos = 0;
        self.spans
            .iter()
            .map(|s| {
                let r = pos..pos + s.len;
                pos += s.len;
                (r, s.kind)
            })
            .collect()
    }

    /// Start of the grapheme before `offset` (0 at the start).
    pub fn prev_boundary(&self, offset: usize) -> usize {
        debug_assert!(offset <= self.text.len() && self.text.is_char_boundary(offset));
        self.text
            .grapheme_indices(true)
            .map(|(i, _)| i)
            .take_while(|&i| i < offset)
            .last()
            .unwrap_or(0)
    }

    /// End of the grapheme at `offset` (len at the end).
    pub fn next_boundary(&self, offset: usize) -> usize {
        debug_assert!(offset <= self.text.len() && self.text.is_char_boundary(offset));
        self.text
            .grapheme_indices(true)
            .map(|(i, _)| i)
            .find(|&i| i > offset)
            .unwrap_or(self.text.len())
    }

    /// Word movement like typical text editors: skip whitespace backwards, then a word
    /// (alphanumerics) or a run of punctuation.
    pub fn prev_word_boundary(&self, offset: usize) -> usize {
        debug_assert!(offset <= self.text.len() && self.text.is_char_boundary(offset));
        let mut pos = offset;
        let before = &self.text[..offset];
        let mut chars = before.chars().rev().peekable();
        while let Some(&c) = chars.peek() {
            if !c.is_whitespace() {
                break;
            }
            pos -= c.len_utf8();
            chars.next();
        }
        if let Some(&first) = chars.peek() {
            let class = is_word_char(first);
            for c in chars {
                if c.is_whitespace() || is_word_char(c) != class {
                    break;
                }
                pos -= c.len_utf8();
            }
        }
        pos
    }

    /// Mirror of `prev_word_boundary`: skip whitespace forwards, then a word.
    pub fn next_word_boundary(&self, offset: usize) -> usize {
        debug_assert!(offset <= self.text.len() && self.text.is_char_boundary(offset));
        let mut pos = offset;
        let mut chars = self.text[offset..].chars().peekable();
        while let Some(&c) = chars.peek() {
            if !c.is_whitespace() {
                break;
            }
            pos += c.len_utf8();
            chars.next();
        }
        if let Some(&first) = chars.peek() {
            let class = is_word_char(first);
            for c in chars {
                if c.is_whitespace() || is_word_char(c) != class {
                    break;
                }
                pos += c.len_utf8();
            }
        }
        pos
    }

    fn check_range(&self, range: &Range<usize>) {
        debug_assert!(range.start <= range.end && range.end <= self.text.len());
        debug_assert!(self.text.is_char_boundary(range.start));
        debug_assert!(self.text.is_char_boundary(range.end));
    }

    /// Spans clipped to `range` (possibly unnormalized, never zero-length).
    fn spans_in(&self, range: Range<usize>) -> Vec<Span> {
        let mut out = Vec::new();
        let mut pos = 0;
        for span in &self.spans {
            let (s, e) = (pos, pos + span.len);
            pos = e;
            let lo = s.max(range.start);
            let hi = e.min(range.end);
            if lo < hi {
                out.push(Span {
                    len: hi - lo,
                    kind: span.kind,
                });
            }
        }
        out
    }

    fn normalize(&mut self) {
        let mut out: Vec<Span> = Vec::with_capacity(self.spans.len());
        for span in self.spans.drain(..) {
            if span.len == 0 {
                continue;
            }
            match out.last_mut() {
                Some(last) if last.kind == span.kind => last.len += span.len,
                _ => out.push(span),
            }
        }
        self.spans = out;
        debug_assert_eq!(
            self.spans.iter().map(|s| s.len).sum::<usize>(),
            self.text.len()
        );
    }
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub kind: String,
    pub cell: Cell,
}

/// What kind of edit was recorded, used to coalesce consecutive typing into one undo step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditKind {
    Typing,
    Deleting,
    Other,
}

const HISTORY_CAP: usize = 500;

/// Snapshot-based undo/redo over any cloneable state (the view stores (blocks, focus, selection)).
pub struct History<T: Clone> {
    undo: VecDeque<T>,
    redo: Vec<T>,
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

    /// Call BEFORE applying an edit, with the state as it was. Consecutive Typing (or Deleting)
    /// records coalesce: only the first of a run is pushed. Other always pushes. Any record clears redo.
    pub fn record(&mut self, before: T, kind: EditKind) {
        self.redo.clear();
        let coalesce = kind != EditKind::Other && self.last == Some(kind);
        if !coalesce {
            self.undo.push_back(before);
            if self.undo.len() > HISTORY_CAP {
                self.undo.pop_front();
            }
        }
        self.last = Some(kind);
    }

    /// Break coalescing (e.g. after caret moves by mouse/arrows).
    pub fn break_coalescing(&mut self) {
        self.last = None;
    }

    /// Returns the state to restore; pushes `current` onto redo.
    pub fn undo(&mut self, current: T) -> Option<T> {
        let prev = self.undo.pop_back()?;
        self.redo.push(current);
        self.last = None;
        Some(prev)
    }

    pub fn redo(&mut self, current: T) -> Option<T> {
        let next = self.redo.pop()?;
        self.undo.push_back(current);
        if self.undo.len() > HISTORY_CAP {
            self.undo.pop_front();
        }
        self.last = None;
        Some(next)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::RunKind::{Note, Text};
    use super::*;

    fn check_invariants(c: &Cell) {
        assert_eq!(c.spans().iter().map(|s| s.len).sum::<usize>(), c.len());
        assert!(c.spans().iter().all(|s| s.len > 0));
        assert!(c.spans().windows(2).all(|w| w[0].kind != w[1].kind));
        for (r, _) in c.styled_ranges() {
            assert!(c.text().is_char_boundary(r.start) && c.text().is_char_boundary(r.end));
        }
    }

    fn runs(c: &Cell) -> Vec<(RunKind, String)> {
        c.to_runs()
    }

    fn r(kind: RunKind, s: &str) -> (RunKind, String) {
        (kind, s.to_string())
    }

    #[test]
    fn from_runs_merges_and_drops_empty() {
        let c = Cell::from_runs(&[
            (Text, "a"),
            (Text, "b"),
            (Note, ""),
            (Note, "c"),
            (Text, ""),
        ]);
        assert_eq!(c.text(), "abc");
        assert_eq!(runs(&c), vec![r(Text, "ab"), r(Note, "c")]);
        check_invariants(&c);
        assert!(Cell::new().is_empty());
        assert_eq!(Cell::new().kind_at(0), Text);
    }

    #[test]
    fn invariants_hold_over_pseudo_random_edits() {
        let mut seed: u64 = 0x1234_5678_9abc_def0;
        let mut next = move |n: usize| {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((seed >> 33) as usize) % n
        };
        let pieces = ["a", "bc", "Ѿ", "ά", "🙏", " ", "", "xyz"];
        let mut c = Cell::from_runs(&[(Text, "Lord "), (Note, "(thrice)"), (Text, " Amen")]);
        for _ in 0..2000 {
            let boundaries: Vec<usize> = (0..=c.len())
                .filter(|&i| c.text().is_char_boundary(i))
                .collect();
            let a = boundaries[next(boundaries.len())];
            let b = boundaries[next(boundaries.len())];
            let range = a.min(b)..a.max(b);
            match next(4) {
                0 => {
                    c.replace(range, pieces[next(pieces.len())]);
                }
                1 => c.set_kind(range, if next(2) == 0 { Text } else { Note }),
                2 => {
                    c.toggle_note(range);
                }
                _ => {
                    let kind = if next(2) == 0 { Text } else { Note };
                    c.replace_with_kind(range, pieces[next(pieces.len())], kind);
                }
            }
            check_invariants(&c);
        }
    }

    #[test]
    fn typing_inside_note_extends_note() {
        let mut c = Cell::from_runs(&[(Text, "ab "), (Note, "note"), (Text, " cd")]);
        let ins = c.replace(5..5, "ZZ");
        assert_eq!(ins, 5..7);
        assert_eq!(
            runs(&c),
            vec![r(Text, "ab "), r(Note, "noZZte"), r(Text, " cd")]
        );
        check_invariants(&c);
    }

    #[test]
    fn typing_after_note_end_continues_note() {
        let mut c = Cell::from_runs(&[(Text, "ab "), (Note, "note"), (Text, " cd")]);
        assert_eq!(c.kind_at(7), Note);
        c.replace(7..7, "!");
        assert_eq!(
            runs(&c),
            vec![r(Text, "ab "), r(Note, "note!"), r(Text, " cd")]
        );
        // At the start of the cell, takes the first char's kind.
        let mut n = Cell::from_runs(&[(Note, "x")]);
        assert_eq!(n.kind_at(0), Note);
        n.replace(0..0, "y");
        assert_eq!(runs(&n), vec![r(Note, "yx")]);
    }

    #[test]
    fn replace_across_boundary() {
        let mut c = Cell::from_runs(&[(Text, "hello "), (Note, "world")]);
        // Replace "lo wo" (3..8); new text takes kind_at(3) = Text.
        let ins = c.replace(3..8, "P");
        assert_eq!(ins, 3..4);
        assert_eq!(c.text(), "helPrld");
        assert_eq!(runs(&c), vec![r(Text, "helP"), r(Note, "rld")]);
        check_invariants(&c);

        let mut d = Cell::from_runs(&[(Text, "hello "), (Note, "world")]);
        d.replace_with_kind(3..8, "N", Note);
        assert_eq!(runs(&d), vec![r(Text, "hel"), r(Note, "Nrld")]);
        check_invariants(&d);
    }

    #[test]
    fn toggle_note_mixed_and_uniform() {
        let mut c = Cell::from_runs(&[(Text, "ab"), (Note, "cd"), (Text, "ef")]);
        assert_eq!(c.toggle_note(1..5), Note);
        assert_eq!(runs(&c), vec![r(Text, "a"), r(Note, "bcde"), r(Text, "f")]);
        assert_eq!(c.toggle_note(1..5), Text);
        assert_eq!(runs(&c), vec![r(Text, "abcdef")]);
        assert_eq!(c.toggle_note(2..2), Text);
        let mut n = Cell::from_runs(&[(Text, "a"), (Note, "b")]);
        assert_eq!(n.toggle_note(2..2), Note);
        assert_eq!(n, Cell::from_runs(&[(Text, "a"), (Note, "b")]));
        check_invariants(&c);
    }

    #[test]
    fn split_off_and_append_round_trip() {
        let original = Cell::from_runs(&[(Text, "ab"), (Note, "Ѿcd"), (Text, "🙏ef")]);
        for at in (0..=original.len()).filter(|&i| original.text().is_char_boundary(i)) {
            let mut head = original.clone();
            let tail = head.split_off(at);
            check_invariants(&head);
            check_invariants(&tail);
            assert_eq!(head.len(), at);
            head.append(tail);
            assert_eq!(head.to_runs(), original.to_runs());
            assert_eq!(head, original);
        }
    }

    #[test]
    fn multibyte_and_grapheme_boundaries() {
        let c = Cell::from_runs(&[(Text, "Ѿ"), (Note, "ά🙏"), (Text, "e\u{301}x")]);
        check_invariants(&c);
        // Ѿ = 2 bytes, ά = 2 bytes, 🙏 = 4 bytes, e+combining = 1+2 bytes, x = 1.
        assert_eq!(c.len(), 2 + 2 + 4 + 3 + 1);
        assert_eq!(c.next_boundary(0), 2);
        assert_eq!(c.next_boundary(2), 4);
        assert_eq!(c.next_boundary(4), 8);
        assert_eq!(c.next_boundary(8), 11);
        assert_eq!(c.next_boundary(11), 12);
        assert_eq!(c.next_boundary(12), 12);
        assert_eq!(c.prev_boundary(12), 11);
        assert_eq!(c.prev_boundary(11), 8);
        assert_eq!(c.prev_boundary(8), 4);
        assert_eq!(c.prev_boundary(4), 2);
        assert_eq!(c.prev_boundary(2), 0);
        assert_eq!(c.prev_boundary(0), 0);
        assert_eq!(c.kind_at(1 + 1), Text);
        assert_eq!(c.kind_at(4), Note);
        assert_eq!(c.kind_at(8), Note);
        assert_eq!(c.kind_at(9), Text);
    }

    #[test]
    fn word_boundaries() {
        let c = Cell::from_runs(&[(Text, "Lord,  have mercy. Ѿ ά")]);
        let t = c.text();
        assert_eq!(c.next_word_boundary(0), 4);
        assert_eq!(c.next_word_boundary(4), 5);
        assert_eq!(c.next_word_boundary(5), 11);
        assert_eq!(c.next_word_boundary(11), 17);
        assert_eq!(&t[..c.next_word_boundary(17)], "Lord,  have mercy.");
        assert_eq!(c.next_word_boundary(c.len()), c.len());
        let end = c.len();
        assert_eq!(&t[c.prev_word_boundary(end)..], "ά");
        assert_eq!(c.prev_word_boundary(18), 17);
        assert_eq!(c.prev_word_boundary(17), 12);
        assert_eq!(c.prev_word_boundary(12), 7);
        assert_eq!(c.prev_word_boundary(7), 4);
        assert_eq!(c.prev_word_boundary(5), 4);
        assert_eq!(c.prev_word_boundary(4), 0);
        assert_eq!(c.prev_word_boundary(0), 0);
        assert_eq!(c.prev_word_boundary(2), 0);
    }

    #[test]
    fn history_coalesces_typing() {
        let mut h: History<i32> = History::new();
        h.record(0, EditKind::Typing);
        h.record(1, EditKind::Typing);
        h.record(2, EditKind::Typing);
        assert_eq!(h.undo(3), Some(0));
        assert!(!h.can_undo());
        assert!(h.can_redo());
        assert_eq!(h.undo(0), None);
    }

    #[test]
    fn history_other_and_break_split_steps() {
        let mut h: History<i32> = History::new();
        h.record(0, EditKind::Typing);
        h.record(1, EditKind::Other);
        h.record(2, EditKind::Typing);
        h.record(3, EditKind::Typing);
        h.break_coalescing();
        h.record(4, EditKind::Typing);
        h.record(5, EditKind::Deleting);
        h.record(6, EditKind::Deleting);
        assert_eq!(h.undo(7), Some(5));
        assert_eq!(h.undo(5), Some(4));
        assert_eq!(h.undo(4), Some(2));
        assert_eq!(h.undo(2), Some(1));
        assert_eq!(h.undo(1), Some(0));
        assert_eq!(h.undo(0), None);
    }

    #[test]
    fn history_undo_redo_round_trip_and_redo_cleared() {
        let mut h: History<String> = History::default();
        h.record("a".into(), EditKind::Other);
        h.record("ab".into(), EditKind::Other);
        let back = h.undo("abc".into()).unwrap();
        assert_eq!(back, "ab");
        let back = h.undo(back).unwrap();
        assert_eq!(back, "a");
        let fwd = h.redo(back).unwrap();
        assert_eq!(fwd, "ab");
        let fwd = h.redo(fwd).unwrap();
        assert_eq!(fwd, "abc");
        assert!(!h.can_redo());
        assert_eq!(h.redo(fwd), None);

        let back = h.undo("abc".into()).unwrap();
        assert!(h.can_redo());
        h.record(back, EditKind::Typing);
        assert!(!h.can_redo());
    }

    #[test]
    fn history_is_capped() {
        let mut h: History<usize> = History::new();
        for i in 0..600 {
            h.record(i, EditKind::Other);
        }
        let mut cur = 600;
        let mut steps = 0;
        while let Some(prev) = h.undo(cur) {
            cur = prev;
            steps += 1;
        }
        assert_eq!(steps, 500);
        assert_eq!(cur, 100);
    }
}
