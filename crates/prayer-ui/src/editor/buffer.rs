//! The text of the focused cell while it is edited: flat text (`\n` between
//! verse lines and for line breaks) plus note spans, with caret helpers.
//!
//! The buffer is converted to and from [`EditorContent`] for committing into
//! the Session draft. It may hold states the prayer never stores (empty verse
//! lines, trailing spaces); those stay in the buffer until it is re-derived.

use std::ops::Range;

use prayer_app::edit::EditorContent;
use prayer_core::{InlineContent, RunRole, TextRun};
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

/// Text of one cell plus its run styling.
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

    #[cfg(test)]
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

    #[cfg(test)]
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

    /// Every character in `range` is inside a note.
    pub fn is_all_note(&self, range: Range<usize>) -> bool {
        self.check_range(&range);
        !range.is_empty() && self.spans_in(range).iter().all(|s| s.kind == RunKind::Note)
    }

    /// Runs in order, merged (tests compare these).
    #[cfg(test)]
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

// ---------------------------------------------------------------------------
// Conversion to and from editor content
// ---------------------------------------------------------------------------

impl Cell {
    fn push_inline(&mut self, content: &InlineContent) {
        for run in content.to_runs() {
            let kind = match run.role {
                RunRole::Text => RunKind::Text,
                RunRole::Note => RunKind::Note,
            };
            self.text.push_str(&run.text);
            self.spans.push(Span {
                len: run.text.len(),
                kind,
            });
        }
    }

    /// The buffer for stored content: lines joined by `\n`.
    pub fn from_content(content: &EditorContent) -> Self {
        let mut cell = Cell::new();
        match content {
            EditorContent::Text(text) => cell.push_inline(text),
            EditorContent::Lines(lines) => {
                for (i, line) in lines.iter().enumerate() {
                    if i > 0 {
                        cell.text.push('\n');
                        cell.spans.push(Span {
                            len: 1,
                            kind: RunKind::Text,
                        });
                    }
                    cell.push_inline(line);
                }
            }
        }
        cell.normalize();
        cell
    }

    fn inline_of(&self, range: Range<usize>) -> InlineContent {
        let runs: Vec<TextRun> = self
            .styled_ranges()
            .into_iter()
            .filter_map(|(r, kind)| {
                let lo = r.start.max(range.start);
                let hi = r.end.min(range.end);
                (lo < hi).then(|| TextRun {
                    role: match kind {
                        RunKind::Text => RunRole::Text,
                        RunKind::Note => RunRole::Note,
                    },
                    text: self.text[lo..hi].to_owned(),
                })
            })
            .collect();
        match runs.as_slice() {
            [] => InlineContent::default(),
            [only] if only.role == RunRole::Text => InlineContent::Plain(only.text.clone()),
            _ => InlineContent::Runs(runs),
        }
    }

    /// The buffer as editor content, offsets unchanged: in line mode one
    /// entry per `\n`-separated line, empty lines included.
    pub fn to_content(&self, line_mode: bool) -> EditorContent {
        if !line_mode {
            return EditorContent::Text(self.inline_of(0..self.text.len()));
        }
        if self.text.is_empty() {
            return EditorContent::Lines(Vec::new());
        }
        let mut lines = Vec::new();
        let mut start = 0;
        for (i, _) in self.text.match_indices('\n') {
            lines.push(self.inline_of(start..i));
            start = i + 1;
        }
        lines.push(self.inline_of(start..self.text.len()));
        EditorContent::Lines(lines)
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
            match next(2) {
                0 => {
                    c.replace(range, pieces[next(pieces.len())]);
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
    fn content_round_trip_keeps_offsets() {
        let lines = EditorContent::Lines(vec![
            InlineContent::from("Lord"),
            InlineContent::Runs(vec![
                TextRun::text("have "),
                TextRun {
                    role: RunRole::Note,
                    text: "(x3)".into(),
                },
            ]),
        ]);
        let cell = Cell::from_content(&lines);
        assert_eq!(cell.text(), "Lord\nhave (x3)");
        assert_eq!(cell.to_content(true), lines);
        // Empty lines survive in the buffer's content form.
        let mut c = cell.clone();
        c.replace(4..4, "\n");
        let EditorContent::Lines(l) = c.to_content(true) else {
            panic!("line mode gives lines")
        };
        assert_eq!(l.len(), 3);
        assert_eq!(l[1], InlineContent::default());
        assert_eq!(Cell::new().to_content(true), EditorContent::Lines(vec![]));
        assert_eq!(
            Cell::new().to_content(false),
            EditorContent::Text(InlineContent::default())
        );
        let text = EditorContent::Text(InlineContent::from("a\nb"));
        assert_eq!(Cell::from_content(&text).to_content(false), text);
    }
}
