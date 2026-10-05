//! Editing helpers for inline content (text and note runs).
//!
//! Offsets are byte offsets into the plain text (all run texts joined),
//! always on char boundaries.

use std::ops::Range;

use crate::model::{InlineContent, RunRole, TextRun};

/// Whitespace as JavaScript's `\s` defines it, so normalization matches the
/// files the TypeScript core wrote.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn is_zero_width(c: char) -> bool {
    matches!(c, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}')
}

/// Canonical run list: zero-width characters removed, whitespace at the
/// edges of notes moved into the neighbouring text, empty runs dropped,
/// neighbours with the same role merged, and notes separated only by
/// whitespace joined into one note (keeping the spaces inside).
pub fn normalize_runs(runs: &[TextRun]) -> Vec<TextRun> {
    let mut merged: Vec<TextRun> = Vec::new();
    let mut push = |role: RunRole, text: &str| {
        if text.is_empty() {
            return;
        }
        match merged.last_mut() {
            Some(prev) if prev.role == role => prev.text.push_str(text),
            _ => merged.push(TextRun {
                role,
                text: text.to_owned(),
            }),
        }
    };

    for run in runs {
        let text: String = run.text.chars().filter(|&c| !is_zero_width(c)).collect();
        match run.role {
            RunRole::Text => push(RunRole::Text, &text),
            RunRole::Note => {
                let core = text.trim_matches(is_js_whitespace);
                if core.is_empty() {
                    // All whitespace: JS peels it as leading and trailing,
                    // which both become text.
                    push(RunRole::Text, &text);
                    continue;
                }
                let start = text.len() - text.trim_start_matches(is_js_whitespace).len();
                let end = text.trim_end_matches(is_js_whitespace).len();
                push(RunRole::Text, &text[..start]);
                push(RunRole::Note, core);
                push(RunRole::Text, &text[end..]);
            }
        }
    }

    let mut coalesced: Vec<TextRun> = Vec::with_capacity(merged.len());
    let mut iter = merged.into_iter().peekable();
    while let Some(run) = iter.next() {
        if run.role != RunRole::Note {
            coalesced.push(run);
            continue;
        }
        let mut note = run;
        loop {
            let gap_is_space = iter.peek().is_some_and(|gap| {
                gap.role == RunRole::Text && gap.text.chars().all(is_js_whitespace)
            });
            if !gap_is_space {
                break;
            }
            let gap = iter.next().expect("peeked");
            match iter.next_if(|next| next.role == RunRole::Note) {
                Some(next) => {
                    note.text.push_str(&gap.text);
                    note.text.push_str(&next.text);
                }
                None => {
                    coalesced.push(note);
                    note = gap;
                    break;
                }
            }
        }
        coalesced.push(note);
    }
    coalesced
}

/// Compact for storage: a plain string when there are no notes, otherwise
/// the normalized run list. Nothing left packs to `None`.
pub fn pack_inline(runs: &[TextRun]) -> Option<InlineContent> {
    let normalized = normalize_runs(runs);
    if normalized.is_empty() {
        None
    } else if normalized.iter().all(|r| r.role == RunRole::Text) {
        Some(InlineContent::Plain(concat_text(&normalized)))
    } else {
        Some(InlineContent::Runs(normalized))
    }
}

/// Content before and after a split point (either side may be empty).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Split {
    pub before: Option<InlineContent>,
    pub after: Option<InlineContent>,
}

/// Mark `range` as note. Leading and trailing whitespace of the selection
/// stays text; an empty or whitespace-only selection changes nothing.
pub fn mark_range_as_note(content: &InlineContent, range: Range<usize>) -> InlineContent {
    retag_range(content, range, RunRole::Note)
}

/// Turn the note characters in `range` back into text. Whitespace trimming
/// matches [`mark_range_as_note`].
pub fn unmark_range(content: &InlineContent, range: Range<usize>) -> InlineContent {
    retag_range(content, range, RunRole::Text)
}

/// When `range` touches a note, turn those whole notes back into text;
/// otherwise mark the range as note.
pub fn toggle_note_range(content: &InlineContent, range: Range<usize>) -> InlineContent {
    let runs = normalize_runs(&content.to_runs());
    let plain = concat_text(&runs);
    let Some(range) = trim_range(&plain, range) else {
        return packed(&runs);
    };

    let mut touches_note = false;
    let retagged: Vec<TextRun> = runs_with_offsets(&runs)
        .map(|(run, span)| {
            if run.role == RunRole::Note && overlaps(&span, &range) {
                touches_note = true;
                TextRun::text(run.text.as_str())
            } else {
                run.clone()
            }
        })
        .collect();

    if touches_note {
        packed(&retagged)
    } else {
        retag_normalized(&runs, range, RunRole::Note)
    }
}

/// Split at a caret (`pos..pos`), or drop the text in `range`. Offsets
/// are clamped to the content and may be given in either order.
pub fn split_inline(content: &InlineContent, range: Range<usize>) -> Split {
    let runs = content.to_runs();
    split_runs(&runs, range)
}

/// Replace `range` with `replacement`, keeping run roles outside it. The
/// replacement takes the role of the run containing the whole range, and is
/// text when the range spans runs.
pub fn replace_range_in_inline(
    content: &InlineContent,
    range: Range<usize>,
    replacement: &str,
) -> InlineContent {
    let runs = normalize_runs(&content.to_runs());
    let plain = concat_text(&runs);
    let range = clamp_range(&plain, range);
    if range.is_empty() && replacement.is_empty() {
        return packed(&runs);
    }

    let role = runs_with_offsets(&runs)
        .find(|(_, span)| range.start >= span.start && range.end <= span.end)
        .map_or(RunRole::Text, |(run, _)| run.role);

    let Split { before, after } = split_runs(&runs, range);
    let mut pieces = before.map(|c| c.to_runs()).unwrap_or_default();
    if !replacement.is_empty() {
        pieces.push(TextRun {
            role,
            text: replacement.to_owned(),
        });
    }
    pieces.extend(after.map(|c| c.to_runs()).unwrap_or_default());
    packed(&pieces)
}

/// Turn the note at `run_index` (an index into the normalized runs) into
/// text. Anything else changes nothing.
pub fn unmark_note_at(content: &InlineContent, run_index: usize) -> InlineContent {
    let mut runs = normalize_runs(&content.to_runs());
    if let Some(run) = runs.get_mut(run_index) {
        run.role = RunRole::Text;
    }
    packed(&runs)
}

fn concat_text(runs: &[TextRun]) -> String {
    runs.iter().map(|r| r.text.as_str()).collect()
}

/// [`pack_inline`], with empty content as an empty string.
fn packed(runs: &[TextRun]) -> InlineContent {
    pack_inline(runs).unwrap_or_default()
}

/// Each run with the byte span it covers in the plain text.
fn runs_with_offsets(runs: &[TextRun]) -> impl Iterator<Item = (&TextRun, Range<usize>)> {
    runs.iter().scan(0, |offset, run| {
        let start = *offset;
        *offset += run.text.len();
        Some((run, start..*offset))
    })
}

fn overlaps(a: &Range<usize>, b: &Range<usize>) -> bool {
    b.start < a.end && b.end > a.start
}

/// Order the range and clamp it into `plain`, snapping to char boundaries.
fn clamp_range(plain: &str, range: Range<usize>) -> Range<usize> {
    let clamp = |mut at: usize| {
        at = at.min(plain.len());
        while !plain.is_char_boundary(at) {
            at -= 1;
        }
        at
    };
    let (a, b) = (clamp(range.start), clamp(range.end));
    a.min(b)..a.max(b)
}

/// Clamped range without edge whitespace; `None` when nothing is left.
fn trim_range(plain: &str, range: Range<usize>) -> Option<Range<usize>> {
    let range = clamp_range(plain, range);
    let selected = &plain[range.clone()];
    let start =
        range.start + (selected.len() - selected.trim_start_matches(is_js_whitespace).len());
    let end = range.start + selected.trim_end_matches(is_js_whitespace).len();
    (start < end).then_some(start..end)
}

/// Give the trimmed `range` the `role`, leaving the rest as it was.
fn retag_range(content: &InlineContent, range: Range<usize>, role: RunRole) -> InlineContent {
    let runs = normalize_runs(&content.to_runs());
    match trim_range(&concat_text(&runs), range) {
        Some(range) => retag_normalized(&runs, range, role),
        None => packed(&runs),
    }
}

fn retag_normalized(runs: &[TextRun], range: Range<usize>, role: RunRole) -> InlineContent {
    let mut pieces: Vec<TextRun> = Vec::with_capacity(runs.len() + 2);
    for (run, span) in runs_with_offsets(runs) {
        if !overlaps(&span, &range) {
            pieces.push(run.clone());
            continue;
        }
        let from = range.start.max(span.start) - span.start;
        let to = range.end.min(span.end) - span.start;
        for (part, part_role) in [
            (&run.text[..from], run.role),
            (&run.text[from..to], role),
            (&run.text[to..], run.role),
        ] {
            if !part.is_empty() {
                pieces.push(TextRun {
                    role: part_role,
                    text: part.to_owned(),
                });
            }
        }
    }
    packed(&pieces)
}

fn split_runs(runs: &[TextRun], range: Range<usize>) -> Split {
    let range = clamp_range(&concat_text(runs), range);
    let mut before = Vec::new();
    let mut after = Vec::new();
    for (run, span) in runs_with_offsets(runs) {
        if span.start < range.start {
            let cut = range.start.min(span.end) - span.start;
            before.push(TextRun {
                role: run.role,
                text: run.text[..cut].to_owned(),
            });
        }
        if span.end > range.end {
            let cut = range.end.max(span.start) - span.start;
            after.push(TextRun {
                role: run.role,
                text: run.text[cut..].to_owned(),
            });
        }
    }
    Split {
        before: pack_inline(&before),
        after: pack_inline(&after),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peels_merges_and_coalesces() {
        let runs = vec![
            TextRun::text("A"),
            TextRun::note(" (x) "),
            TextRun::text(" "),
            TextRun::note("(y)"),
            TextRun::text("\u{200B}"),
            TextRun::text("B"),
        ];
        assert_eq!(
            normalize_runs(&runs),
            vec![
                TextRun::text("A "),
                TextRun::note("(x)  (y)"),
                TextRun::text("B"),
            ]
        );
    }

    #[test]
    fn whitespace_only_note_becomes_text() {
        let runs = vec![TextRun::text("A"), TextRun::note("  "), TextRun::text("B")];
        assert_eq!(normalize_runs(&runs), vec![TextRun::text("A  B")]);
    }

    #[test]
    fn trailing_space_after_note_stays_text() {
        let runs = vec![TextRun::note("(x)"), TextRun::text(" ")];
        assert_eq!(
            normalize_runs(&runs),
            vec![TextRun::note("(x)"), TextRun::text(" ")]
        );
    }

    fn plain(text: &str) -> InlineContent {
        InlineContent::from(text)
    }

    fn runs(runs: Vec<TextRun>) -> InlineContent {
        InlineContent::Runs(runs)
    }

    /// Byte span of the first `needle` in `haystack`.
    fn span(haystack: &str, needle: &str) -> Range<usize> {
        let start = haystack.find(needle).expect("needle present");
        start..start + needle.len()
    }

    #[test]
    fn normalize_peels_whitespace_out_of_notes() {
        let input = [
            TextRun::text("Amen"),
            TextRun::note(" (zwölfmal) "),
            TextRun::text("."),
        ];
        assert_eq!(
            normalize_runs(&input),
            vec![
                TextRun::text("Amen "),
                TextRun::note("(zwölfmal)"),
                TextRun::text(" ."),
            ]
        );
    }

    #[test]
    fn normalize_merges_same_role_and_drops_empties() {
        let input = [
            TextRun::text("a"),
            TextRun::text("b"),
            TextRun::note(""),
            TextRun::note("(NN)"),
        ];
        assert_eq!(
            normalize_runs(&input),
            vec![TextRun::text("ab"), TextRun::note("(NN)")]
        );
    }

    #[test]
    fn normalize_coalesces_notes_separated_by_whitespace() {
        let input = [
            TextRun::note("(NN)"),
            TextRun::text(" "),
            TextRun::note("(zwölfmal)"),
        ];
        assert_eq!(
            normalize_runs(&input),
            vec![TextRun::note("(NN) (zwölfmal)")]
        );
    }

    #[test]
    fn pack_to_plain_without_notes() {
        let input = [TextRun::text("Hello"), TextRun::text("!")];
        assert_eq!(pack_inline(&input), Some(plain("Hello!")));
    }

    #[test]
    fn pack_to_runs_with_note() {
        let input = [TextRun::text("Gedenke "), TextRun::note("(NN)")];
        assert_eq!(pack_inline(&input), Some(runs(input.to_vec())));
    }

    #[test]
    fn pack_empty_is_none() {
        assert_eq!(pack_inline(&[]), None);
        assert_eq!(pack_inline(&[TextRun::text("\u{200B}")]), None);
    }

    #[test]
    fn marks_mid_line_placeholder() {
        let content = "Gedenke, Herr, Deines Dieners (NN) und erbarme Dich.";
        assert_eq!(
            mark_range_as_note(&plain(content), span(content, "(NN)")),
            runs(vec![
                TextRun::text("Gedenke, Herr, Deines Dieners "),
                TextRun::note("(NN)"),
                TextRun::text(" und erbarme Dich."),
            ])
        );
    }

    #[test]
    fn mark_leaves_selected_edge_spaces_as_text() {
        let content = "Amen (zwölfmal).";
        let start = content.find(" (").unwrap();
        let end = content.find(')').unwrap() + 1;
        assert_eq!(
            mark_range_as_note(&plain(content), start..end),
            runs(vec![
                TextRun::text("Amen "),
                TextRun::note("(zwölfmal)"),
                TextRun::text("."),
            ])
        );
    }

    #[test]
    fn mark_ignores_whitespace_only_selection() {
        assert_eq!(mark_range_as_note(&plain("a  b"), 1..3), plain("a  b"));
    }

    #[test]
    fn mark_clamps_and_orders_offsets() {
        let (start, end) = (99, 1);
        assert_eq!(
            mark_range_as_note(&plain("ab"), start..end),
            runs(vec![TextRun::text("a"), TextRun::note("b")])
        );
    }

    #[test]
    fn mark_cyrillic_and_combining_marks() {
        // "Го́споди": the accent is a separate char (2 bytes) after "о".
        let content = "Го\u{301}споди помилуй";
        let range = span(content, "помилуй");
        assert_eq!(
            mark_range_as_note(&plain(content), range),
            runs(vec![
                TextRun::text("Го\u{301}споди "),
                TextRun::note("помилуй"),
            ])
        );
    }

    #[test]
    fn unmark_note_at_index() {
        let rich = runs(vec![
            TextRun::text("Amen "),
            TextRun::note("(zwölfmal)"),
            TextRun::text("."),
        ]);
        assert_eq!(unmark_note_at(&rich, 1), plain("Amen (zwölfmal)."));
        // Not a note / out of range: unchanged.
        assert_eq!(unmark_note_at(&rich, 0), rich);
        assert_eq!(unmark_note_at(&rich, 9), rich);
    }

    #[test]
    fn unmark_character_range() {
        let rich = mark_range_as_note(&plain("x (NN) y"), 2..6);
        assert!(matches!(rich, InlineContent::Runs(_)));
        assert_eq!(unmark_range(&rich, 2..6), plain("x (NN) y"));
    }

    #[test]
    fn toggle_on_then_off() {
        let text = "Herr (NN) erbarme Dich";
        let range = span(text, "(NN)");
        let marked = toggle_note_range(&plain(text), range.clone());
        assert_eq!(marked.plain_text(), text);
        assert!(marked.to_runs().iter().any(|r| r.role == RunRole::Note));
        assert_eq!(toggle_note_range(&marked, range), plain(text));
    }

    #[test]
    fn toggle_partial_selection_removes_whole_note() {
        let marked = mark_range_as_note(
            &plain("Amen (zwölfmal)."),
            "Amen ".len().."Amen (zwölfmal)".len(),
        );
        assert!(matches!(marked, InlineContent::Runs(_)));
        let start = "Amen (".len();
        assert_eq!(
            toggle_note_range(&marked, start..start + "zwölf".len()),
            plain("Amen (zwölfmal).")
        );
    }

    #[test]
    fn sequential_marks_merge_into_one_note() {
        let content = mark_range_as_note(&plain("aaabbb"), 0..3);
        let content = mark_range_as_note(&content, 3..6);
        assert_eq!(content, runs(vec![TextRun::note("aaabbb")]));
    }

    #[test]
    fn split_plain_at_caret() {
        let split = split_inline(&plain("Herr, erbarme dich."), 6..6);
        assert_eq!(split.before, Some(plain("Herr, ")));
        assert_eq!(split.after, Some(plain("erbarme dich.")));
    }

    #[test]
    fn split_at_ends_leaves_one_side_empty() {
        let end = split_inline(&plain("Amen"), 4..4);
        assert_eq!((end.before, end.after), (Some(plain("Amen")), None));
        let start = split_inline(&plain("Amen"), 0..0);
        assert_eq!((start.before, start.after), (None, Some(plain("Amen"))));
    }

    #[test]
    fn split_drops_selected_range() {
        let split = split_inline(&plain("aaXXXbb"), 2..5);
        assert_eq!(split.before, Some(plain("aa")));
        assert_eq!(split.after, Some(plain("bb")));
    }

    #[test]
    fn split_inside_note_keeps_both_sides_notes() {
        let content = runs(vec![
            TextRun::text("Dann "),
            TextRun::note("vierzigmal"),
            TextRun::text(":"),
        ]);
        let split = split_inline(&content, 9..9);
        assert_eq!(
            split.before,
            Some(runs(vec![TextRun::text("Dann "), TextRun::note("vier")]))
        );
        assert_eq!(
            split.after,
            Some(runs(vec![TextRun::note("zigmal"), TextRun::text(":")]))
        );
    }

    #[test]
    fn replace_plain_text() {
        assert_eq!(
            replace_range_in_inline(&plain("Hello world"), 6..11, "there"),
            plain("Hello there")
        );
    }

    #[test]
    fn replace_inside_note_keeps_note_role() {
        let content = runs(vec![TextRun::text("Kyrie "), TextRun::note("eleison")]);
        assert_eq!(
            replace_range_in_inline(&content, 6..13, "Lord"),
            runs(vec![TextRun::text("Kyrie "), TextRun::note("Lord")])
        );
    }

    #[test]
    fn replace_inserts_at_empty_range() {
        assert_eq!(
            replace_range_in_inline(&plain("Amen"), 4..4, "!"),
            plain("Amen!")
        );
        assert_eq!(
            replace_range_in_inline(&plain("Amen"), 2..2, ""),
            plain("Amen")
        );
    }

    #[test]
    fn replace_across_runs_inserts_text() {
        let content = runs(vec![TextRun::text("ab"), TextRun::note("cd")]);
        assert_eq!(
            replace_range_in_inline(&content, 1..3, "X"),
            runs(vec![TextRun::text("aX"), TextRun::note("d"),])
        );
    }
}
