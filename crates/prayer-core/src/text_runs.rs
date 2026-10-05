//! Editing helpers for inline content (text and note runs).
//!
//! Offsets are byte offsets into the plain text (all run texts joined),
//! always on char boundaries.

use crate::model::{RunRole, TextRun};

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
}
