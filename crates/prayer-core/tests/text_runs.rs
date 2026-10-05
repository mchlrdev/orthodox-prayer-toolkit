//! Checks the inline-content editing helpers against the golden cases the
//! TypeScript core produced (`scripts/core-golden/text_runs.mjs`).

use std::fs;
use std::ops::Range;
use std::path::PathBuf;

use prayer_core::model::{InlineContent, TextRun};
use prayer_core::text_runs::{
    mark_range_as_note, pack_inline, replace_range_in_inline, split_inline, toggle_note_range,
    unmark_note_at, unmark_range,
};
use serde::Deserialize;
use serde_json::{Value, json};

fn load<T: for<'de> Deserialize<'de>>(op: &str) -> Vec<T> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden/text_runs")
        .join(format!("{op}.json"));
    let raw = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// Byte offset of a UTF-16 offset, clamped to the text like the TS core does.
fn byte_offset(text: &str, utf16: usize) -> usize {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units >= utf16 {
            return byte;
        }
        units += ch.len_utf16();
    }
    text.len()
}

#[derive(Deserialize)]
struct RangeCase {
    name: String,
    content: InlineContent,
    start_utf16: usize,
    end_utf16: usize,
    #[serde(default)]
    replacement: String,
    expected: Value,
}

impl RangeCase {
    fn range(&self) -> Range<usize> {
        let plain = self.content.plain_text();
        byte_offset(&plain, self.start_utf16)..byte_offset(&plain, self.end_utf16)
    }
}

fn check_range_op(op: &str, run: impl Fn(&RangeCase) -> Value) {
    let cases: Vec<RangeCase> = load(op);
    assert!(!cases.is_empty());
    for case in &cases {
        assert_eq!(run(case), case.expected, "{op}: {}", case.name);
    }
}

fn to_json(content: &InlineContent) -> Value {
    serde_json::to_value(content).unwrap()
}

#[test]
fn mark_range_as_note_matches_golden() {
    check_range_op("mark_range_as_note", |c| {
        to_json(&mark_range_as_note(&c.content, c.range()))
    });
}

#[test]
fn unmark_range_matches_golden() {
    check_range_op("unmark_range", |c| {
        to_json(&unmark_range(&c.content, c.range()))
    });
}

#[test]
fn toggle_note_range_matches_golden() {
    check_range_op("toggle_note_range", |c| {
        to_json(&toggle_note_range(&c.content, c.range()))
    });
}

#[test]
fn split_inline_matches_golden() {
    check_range_op("split_inline", |c| {
        let split = split_inline(&c.content, c.range());
        json!({ "before": split.before, "after": split.after })
    });
}

#[test]
fn replace_range_in_inline_matches_golden() {
    check_range_op("replace_range_in_inline", |c| {
        to_json(&replace_range_in_inline(
            &c.content,
            c.range(),
            &c.replacement,
        ))
    });
}

#[test]
fn unmark_note_at_matches_golden() {
    #[derive(Deserialize)]
    struct Case {
        name: String,
        content: InlineContent,
        run_index: usize,
        expected: Value,
    }
    let cases: Vec<Case> = load("unmark_note_at");
    assert!(!cases.is_empty());
    for case in &cases {
        let got = to_json(&unmark_note_at(&case.content, case.run_index));
        assert_eq!(got, case.expected, "{}", case.name);
    }
}

#[test]
fn pack_inline_matches_golden() {
    #[derive(Deserialize)]
    struct Case {
        name: String,
        runs: Vec<TextRun>,
        expected: Value,
    }
    let cases: Vec<Case> = load("pack_inline");
    assert!(!cases.is_empty());
    for case in &cases {
        let got = serde_json::to_value(pack_inline(&case.runs)).unwrap();
        assert_eq!(got, case.expected, "{}", case.name);
    }
}
