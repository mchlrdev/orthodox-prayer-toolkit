//! Prayer-level edit operations: what the editor UI does to a [`Prayer`],
//! as pure functions on `&mut Prayer` with no I/O.
//!
//! They run inside [`SessionDraft::edit`](crate::draft::SessionDraft::edit),
//! which records undo history and notices when an operation changed nothing.
//! Operations that can be a no-op return `bool`/`Option` so the caller can
//! tell, but the draft does not rely on it (it compares snapshots).
//!
//! Text positions are **byte offsets** into the plain text of a Block in one
//! Variant, like [`prayer_core::text_runs`]. For Kinds that use `lines`
//! (verse) the plain text is the lines joined by `\n`, so a position can be
//! turned into a line plus an offset inside it.
//!
//! Content rules (schema: no empty translation keys): committing empty
//! content removes the translation instead of writing `""`; run arrays are
//! stored normalized, as a plain string when there are no notes.

use std::ops::Range;
use std::time::{SystemTime, UNIX_EPOCH};

use prayer_core::model::{
    Block, InlineContent, Meta, Prayer, RunRole, Translation, VariantKey, VariantMeta,
    is_kind_preset,
};
use prayer_core::text_runs::{
    is_js_whitespace, mark_range_as_note, normalize_runs, pack_inline, replace_range_in_inline,
    split_inline, toggle_note_range,
};
use prayer_core::validate_styles::is_valid_kind_id;

pub use prayer_core::kinds::{DEFAULT_DELETE_FALLBACK, delete_kind, rename_kind};
use prayer_core::model::KIND_PRESETS;

// ---------------------------------------------------------------------------
// Variant references
// ---------------------------------------------------------------------------

/// Owned `lang` + `variant` pair: a visible column, a find match target.
/// ([`VariantKey`] is the borrowed form.)
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct VariantRef {
    pub lang: String,
    pub variant: String,
}

impl VariantRef {
    pub fn new(lang: impl Into<String>, variant: impl Into<String>) -> Self {
        Self {
            lang: lang.into(),
            variant: variant.into(),
        }
    }

    pub fn key(&self) -> VariantKey<'_> {
        VariantKey {
            lang: &self.lang,
            variant: &self.variant,
        }
    }
}

impl From<&VariantMeta> for VariantRef {
    fn from(meta: &VariantMeta) -> Self {
        Self::new(meta.lang.as_str(), meta.variant.as_str())
    }
}

impl From<VariantKey<'_>> for VariantRef {
    fn from(key: VariantKey<'_>) -> Self {
        Self::new(key.lang, key.variant)
    }
}

// ---------------------------------------------------------------------------
// Editor content
// ---------------------------------------------------------------------------

/// Whether a Kind stores its text as `lines` (verse) rather than `text`.
pub fn uses_lines(kind: &str) -> bool {
    kind == "verse"
}

/// What the editor shows and commits for one Block in one Variant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EditorContent {
    /// A Block of a text Kind.
    Text(InlineContent),
    /// A Block of a line Kind (verse), one entry per line.
    Lines(Vec<InlineContent>),
}

impl EditorContent {
    /// Nothing in the shape the Kind uses.
    pub fn empty(line_mode: bool) -> Self {
        if line_mode {
            Self::Lines(Vec::new())
        } else {
            Self::Text(InlineContent::default())
        }
    }

    /// The text as the editor shows it (lines joined by `\n`).
    pub fn plain_text(&self) -> String {
        match self {
            Self::Text(text) => text.plain_text(),
            Self::Lines(lines) => join_lines_plain(lines),
        }
    }
}

fn join_lines_plain(lines: &[InlineContent]) -> String {
    lines
        .iter()
        .map(InlineContent::plain_text)
        .collect::<Vec<_>>()
        .join("\n")
}

/// What the editor shows for a translation. Verse reads `lines`; a verse
/// that only has `text` shows it as one line. Text Kinds read `text` and fall
/// back to leftover `lines` (e.g. after a Kind change saved without
/// reshaping): one line as it is, several joined by `\n`.
pub fn editor_content(kind: &str, translation: Option<&Translation>) -> EditorContent {
    if uses_lines(kind) {
        return EditorContent::Lines(match translation {
            Some(Translation {
                lines: Some(lines), ..
            }) if !lines.is_empty() => lines.clone(),
            Some(Translation {
                text: Some(text), ..
            }) => vec![text.clone()],
            _ => Vec::new(),
        });
    }
    EditorContent::Text(match translation {
        Some(Translation {
            text: Some(text), ..
        }) => text.clone(),
        Some(Translation {
            lines: Some(lines), ..
        }) if !lines.is_empty() => lines_as_text(lines),
        _ => InlineContent::default(),
    })
}

fn lines_as_text(lines: &[InlineContent]) -> InlineContent {
    match lines {
        [one] => one.clone(),
        many => InlineContent::Plain(join_lines_plain(many)),
    }
}

/// The editor content of a Block in a Variant (`None`: no such Block).
pub fn block_editor_content(
    prayer: &Prayer,
    block_id: &str,
    key: VariantKey<'_>,
) -> Option<EditorContent> {
    let block = prayer.structure.iter().find(|b| b.id == block_id)?;
    Some(editor_content(&block.kind, block.translation(key)))
}

// ---------------------------------------------------------------------------
// Committing content into a translation
// ---------------------------------------------------------------------------

/// The stored shape of a translation, comparable regardless of how the runs
/// were chunked.
#[derive(Debug, PartialEq)]
struct Payload {
    text: Option<InlineContent>,
    lines: Option<Vec<InlineContent>>,
}

fn is_blank(text: &str) -> bool {
    text.chars().all(is_js_whitespace)
}

/// Canonical, non-empty form of one inline value.
fn canonical_inline(content: &InlineContent) -> Option<InlineContent> {
    pack_inline(&content.to_runs())
}

/// Text commit rule: a plain string that is only whitespace is empty; runs
/// are empty when they have no characters.
fn committed_text(content: &InlineContent) -> Option<InlineContent> {
    match content {
        InlineContent::Plain(text) if is_blank(text) => None,
        other => canonical_inline(other),
    }
}

/// Line commit rule: lines without characters are dropped.
fn committed_lines(lines: &[InlineContent]) -> Vec<InlineContent> {
    lines
        .iter()
        .filter(|line| !line.plain_text().is_empty())
        .filter_map(canonical_inline)
        .collect()
}

/// The payload that committing `content` into a Block of `kind` stores
/// (`None`: no translation).
fn payload_for(kind: &str, content: &EditorContent) -> Option<Payload> {
    if uses_lines(kind) {
        let lines = match content {
            EditorContent::Lines(lines) => committed_lines(lines),
            EditorContent::Text(text) => committed_lines(std::slice::from_ref(text)),
        };
        return (!lines.is_empty()).then_some(Payload {
            text: None,
            lines: Some(lines),
        });
    }
    let text = match content {
        EditorContent::Text(text) => committed_text(text),
        EditorContent::Lines(lines) => {
            let lines = committed_lines(lines);
            committed_text(&lines_as_text(&lines))
        }
    };
    text.map(|text| Payload {
        text: Some(text),
        lines: None,
    })
}

/// The payload of an existing translation in canonical form.
fn stored_payload(translation: Option<&Translation>) -> Option<Payload> {
    let translation = translation?;
    let text = translation.text.as_ref().and_then(canonical_inline);
    let lines = translation
        .lines
        .as_deref()
        .map(|lines| {
            lines
                .iter()
                .filter_map(canonical_inline)
                .collect::<Vec<_>>()
        })
        .filter(|lines| !lines.is_empty());
    (text.is_some() || lines.is_some()).then_some(Payload { text, lines })
}

/// Commits `content` as the text of Block `block_id` in the Variant `key`.
///
/// Empty content removes the translation. Returns `true` when the prayer
/// changed (`false`: unknown Block, or the stored text already is this
/// content). Existing translations are updated in place; a new one is
/// appended.
pub fn set_block_content(
    prayer: &mut Prayer,
    block_id: &str,
    key: VariantKey<'_>,
    content: &EditorContent,
) -> bool {
    let Some(block) = prayer.structure.iter_mut().find(|b| b.id == block_id) else {
        return false;
    };
    commit_into_block(block, key, content)
}

fn commit_into_block(block: &mut Block, key: VariantKey<'_>, content: &EditorContent) -> bool {
    let position = block.translations.iter().position(|t| t.key() == key);
    let existing = position.map(|i| &block.translations[i]);
    let next = payload_for(&block.kind, content);
    if stored_payload(existing) == next {
        return false;
    }
    match (position, next) {
        (Some(i), None) => {
            block.translations.remove(i);
        }
        (None, None) => return false,
        (position, Some(payload)) => {
            let translation = Translation {
                lang: key.lang.to_owned(),
                variant: key.variant.to_owned(),
                text: payload.text,
                lines: payload.lines,
            };
            match position {
                Some(i) => block.translations[i] = translation,
                None => block.translations.push(translation),
            }
        }
    }
    true
}

// ---------------------------------------------------------------------------
// Positions in line content
// ---------------------------------------------------------------------------

/// Maps a byte offset in the `\n`-joined text of `lines` to a line index and
/// an offset inside that line. Offsets past the end land at the end of the
/// last line.
fn map_offset_to_line(lines: &[InlineContent], offset: usize) -> (usize, usize) {
    let mut remaining = offset;
    for (i, line) in lines.iter().enumerate() {
        let len = line.plain_text().len();
        if remaining <= len {
            return (i, remaining);
        }
        remaining -= len;
        if i + 1 < lines.len() {
            // Past the end of this line: the `\n` counts one.
            remaining -= 1;
        }
    }
    let last = lines.len().saturating_sub(1);
    (last, lines.get(last).map_or(0, |l| l.plain_text().len()))
}

/// Floors `at` to a char boundary of `text` (and to its length).
fn floor_boundary(text: &str, at: usize) -> usize {
    let mut at = at.min(text.len());
    while !text.is_char_boundary(at) {
        at -= 1;
    }
    at
}

fn ordered(range: Range<usize>) -> Range<usize> {
    range.start.min(range.end)..range.start.max(range.end)
}

/// Content on both sides of a split; an empty side is `None`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EditorSplit {
    pub before: Option<EditorContent>,
    pub after: Option<EditorContent>,
}

/// Splits editor content at a caret (`pos..pos`), or drops the selected text
/// (`range`). In line mode the lines before the caret stay on the left, the
/// rest go right, and a line the caret is inside is cut in two.
pub fn split_editor_content(
    content: &EditorContent,
    range: Range<usize>,
    line_mode: bool,
) -> EditorSplit {
    let range = ordered(range);
    if !line_mode {
        let inline = match content {
            EditorContent::Text(text) => text.clone(),
            EditorContent::Lines(lines) => InlineContent::Plain(join_lines_plain(lines)),
        };
        let split = split_inline(&inline, range);
        return EditorSplit {
            before: split.before.map(EditorContent::Text),
            after: split.after.map(EditorContent::Text),
        };
    }

    let lines: Vec<InlineContent> = match content {
        EditorContent::Lines(lines) => lines.clone(),
        EditorContent::Text(text) => vec![text.clone()],
    };
    if lines.is_empty() {
        return EditorSplit {
            before: None,
            after: None,
        };
    }
    let (start_line, start_local) = map_offset_to_line(&lines, range.start);
    let (end_line, end_local) = map_offset_to_line(&lines, range.end);
    let mut before: Vec<InlineContent> = lines[..start_line].to_vec();
    let mut after: Vec<InlineContent> = Vec::new();

    if start_line == end_line {
        let split = split_inline(&lines[start_line], start_local..end_local);
        before.extend(split.before);
        after.extend(split.after);
    } else {
        before.extend(split_inline(&lines[start_line], start_local..start_local).before);
        after.extend(split_inline(&lines[end_line], end_local..end_local).after);
    }
    after.extend(lines[end_line + 1..].iter().cloned());

    let wrap =
        |lines: Vec<InlineContent>| (!lines.is_empty()).then_some(EditorContent::Lines(lines));
    EditorSplit {
        before: wrap(before),
        after: wrap(after),
    }
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

fn to_base36(mut n: u128) -> String {
    const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).expect("ascii digits")
}

/// Block id in the format the Electron editor writes: `b{count+1}-{time in
/// base 36}`, e.g. `b4-mfz3k9x1`.
pub fn create_block_id(structure_len: usize, now_ms: u128) -> String {
    format!("b{}-{}", structure_len + 1, to_base36(now_ms))
}

/// A Block id that no Block of `prayer` has yet, in the format of
/// [`create_block_id`] (the counter is bumped on a clash).
pub fn fresh_block_id(prayer: &Prayer) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    fresh_block_id_at(prayer, now)
}

fn fresh_block_id_at(prayer: &Prayer, now_ms: u128) -> String {
    let mut len = prayer.structure.len();
    loop {
        let id = create_block_id(len, now_ms);
        if !has_block_id(prayer, &id) {
            return id;
        }
        len += 1;
    }
}

fn has_block_id(prayer: &Prayer, id: &str) -> bool {
    prayer.structure.iter().any(|b| b.id == id)
}

fn empty_block(id: String, kind: &str) -> Block {
    Block {
        id,
        kind: kind.to_owned(),
        translations: Vec::new(),
    }
}

/// Appends an empty Block of `kind`; returns its id.
pub fn add_block(prayer: &mut Prayer, kind: &str) -> String {
    insert_block(prayer, prayer.structure.len(), kind)
}

/// Inserts an empty Block of `kind` at `index` (clamped to the end); returns
/// its id.
pub fn insert_block(prayer: &mut Prayer, index: usize, kind: &str) -> String {
    let id = fresh_block_id(prayer);
    let index = index.min(prayer.structure.len());
    prayer
        .structure
        .insert(index, empty_block(id.clone(), kind));
    id
}

/// [`insert_block`] with a given id. `None` (nothing inserted) when a Block
/// already has that id.
pub fn insert_block_with_id(prayer: &mut Prayer, index: usize, kind: &str, id: &str) -> Option<()> {
    if has_block_id(prayer, id) {
        return None;
    }
    let index = index.min(prayer.structure.len());
    prayer
        .structure
        .insert(index, empty_block(id.to_owned(), kind));
    Some(())
}

/// Inserts an empty Block after `index` with the same Kind (what Enter at
/// the end of a Block does). Returns the new id, `None` for a bad index.
pub fn insert_block_after(prayer: &mut Prayer, index: usize) -> Option<String> {
    let kind = prayer.structure.get(index)?.kind.clone();
    Some(insert_block(prayer, index + 1, &kind))
}

/// Where a split put the new Block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SplitOutcome {
    pub new_block_id: String,
    pub new_index: usize,
}

/// Splits Block `index` at `range` in Variant `key` (a caret is `p..p`; a
/// selection is dropped). The text before stays, the text after moves to a
/// new Block after it that keeps the Kind. Other Variants of the Block are
/// not touched. `None` for a bad index.
pub fn split_block(
    prayer: &mut Prayer,
    index: usize,
    key: VariantKey<'_>,
    range: Range<usize>,
) -> Option<SplitOutcome> {
    let id = fresh_block_id(prayer);
    split_block_with_id(prayer, index, key, range, &id)
}

/// [`split_block`] with a given id for the new Block (`None` when a Block
/// already has it).
pub fn split_block_with_id(
    prayer: &mut Prayer,
    index: usize,
    key: VariantKey<'_>,
    range: Range<usize>,
    new_id: &str,
) -> Option<SplitOutcome> {
    let block = prayer.structure.get(index)?;
    if has_block_id(prayer, new_id) {
        return None;
    }
    let line_mode = uses_lines(&block.kind);
    let kind = block.kind.clone();
    let content = editor_content(&kind, block.translation(key));
    let split = split_editor_content(&content, range, line_mode);

    let before = split
        .before
        .unwrap_or_else(|| EditorContent::empty(line_mode));
    commit_into_block(&mut prayer.structure[index], key, &before);

    let mut new_block = empty_block(new_id.to_owned(), &kind);
    if let Some(after) = split.after {
        commit_into_block(&mut new_block, key, &after);
    }
    prayer.structure.insert(index + 1, new_block);
    Some(SplitOutcome {
        new_block_id: new_id.to_owned(),
        new_index: index + 1,
    })
}

/// Where the text of the merged Block begins in one Variant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JoinPoint {
    pub variant: VariantRef,
    /// Byte offset in the plain text of the surviving Block (the length of
    /// what was there before): where the caret goes.
    pub offset: usize,
}

/// Result of [`merge_block_into_previous`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MergeOutcome {
    /// The surviving (previous) Block.
    pub block_id: String,
    pub block_index: usize,
    /// One entry per Variant that has text in either Block.
    pub join_points: Vec<JoinPoint>,
}

/// Merges Block `index` into the Block before it (Backspace at the start of
/// a Block): in **each** Variant the texts are joined without a separator,
/// notes kept. The previous Block keeps its Kind; text moving between a text
/// Kind and verse is reshaped like a Kind change. `None` when `index` is the
/// first Block or out of range.
pub fn merge_block_into_previous(prayer: &mut Prayer, index: usize) -> Option<MergeOutcome> {
    if index == 0 || index >= prayer.structure.len() {
        return None;
    }
    let current = prayer.structure.remove(index);
    let previous = &mut prayer.structure[index - 1];
    let line_mode = uses_lines(&previous.kind);

    let mut keys: Vec<VariantRef> = Vec::new();
    for t in previous.translations.iter().chain(&current.translations) {
        let key = VariantRef::new(t.lang.as_str(), t.variant.as_str());
        if !keys.contains(&key) {
            keys.push(key);
        }
    }

    let mut join_points = Vec::with_capacity(keys.len());
    for variant in keys {
        let key = variant.key();
        let head = editor_content(&previous.kind, previous.translation(key));
        let tail = editor_content(&current.kind, current.translation(key));
        let offset = head.plain_text().len();
        let joined = join_content(head, tail, line_mode);
        commit_into_block(previous, key, &joined);
        join_points.push(JoinPoint { variant, offset });
    }
    Some(MergeOutcome {
        block_id: previous.id.clone(),
        block_index: index - 1,
        join_points,
    })
}

fn join_inline(head: &InlineContent, tail: &InlineContent) -> InlineContent {
    let mut runs = head.to_runs();
    runs.extend(tail.to_runs());
    pack_inline(&runs).unwrap_or_default()
}

/// Joins `tail` onto `head` in the shape of the surviving Block.
fn join_content(head: EditorContent, tail: EditorContent, line_mode: bool) -> EditorContent {
    if line_mode {
        let mut lines = match head {
            EditorContent::Lines(lines) => lines,
            EditorContent::Text(text) => vec![text],
        };
        let mut tail_lines = match tail {
            EditorContent::Lines(lines) => lines,
            EditorContent::Text(text) => vec![text],
        };
        lines.retain(|l| !l.plain_text().is_empty());
        tail_lines.retain(|l| !l.plain_text().is_empty());
        if tail_lines.is_empty() {
            return EditorContent::Lines(lines);
        }
        if lines.is_empty() {
            return EditorContent::Lines(tail_lines);
        }
        let first = tail_lines.remove(0);
        let last = lines.len() - 1;
        lines[last] = join_inline(&lines[last], &first);
        lines.extend(tail_lines);
        return EditorContent::Lines(lines);
    }
    let as_text = |content: EditorContent| match content {
        EditorContent::Text(text) => text,
        EditorContent::Lines(lines) => lines_as_text(&lines),
    };
    EditorContent::Text(join_inline(&as_text(head), &as_text(tail)))
}

/// Removes Block `index` and returns it (no confirmation: undo covers it).
pub fn delete_block(prayer: &mut Prayer, index: usize) -> Option<Block> {
    (index < prayer.structure.len()).then(|| prayer.structure.remove(index))
}

/// Moves Block `index` by `delta` places (`-1` up, `1` down); returns its
/// new index, or `None` when that would leave the structure (or `delta` is 0).
pub fn move_block(prayer: &mut Prayer, index: usize, delta: isize) -> Option<usize> {
    let target = index.checked_add_signed(delta)?;
    if delta == 0 || index >= prayer.structure.len() || target >= prayer.structure.len() {
        return None;
    }
    prayer.structure.swap(index, target);
    Some(target)
}

/// Changes the Kind of Block `index`. When the text changes shape (`lines`
/// for verse, `text` otherwise) every translation is converted: lines to
/// text joined by `\n` (one line as it is), text to one line. Returns whether
/// anything changed.
pub fn set_block_kind(prayer: &mut Prayer, index: usize, kind: &str) -> bool {
    let Some(block) = prayer.structure.get_mut(index) else {
        return false;
    };
    if block.kind == kind {
        return false;
    }
    let old_kind = std::mem::replace(&mut block.kind, kind.to_owned());
    if uses_lines(&old_kind) != uses_lines(kind) {
        let old_translations = block.translations.clone();
        for translation in &old_translations {
            let content = editor_content(&old_kind, Some(translation));
            commit_into_block(block, translation.key(), &content);
        }
    }
    true
}

/// Toggles note on `range` (byte offsets in the editor plain text) of a
/// Block in a Variant: when the range touches a note those notes become text,
/// otherwise the range (without edge whitespace) becomes a note. In line
/// mode the decision is made for the whole range and applied per line.
/// Returns whether the prayer changed.
pub fn toggle_note(
    prayer: &mut Prayer,
    block_id: &str,
    key: VariantKey<'_>,
    range: Range<usize>,
) -> bool {
    let Some(block) = prayer.structure.iter_mut().find(|b| b.id == block_id) else {
        return false;
    };
    let content = editor_content(&block.kind, block.translation(key));
    let toggled = toggle_note_in_content(&content, range);
    if toggled == content {
        return false;
    }
    commit_into_block(block, key, &toggled)
}

/// [`toggle_note`] on editor content that is not stored yet (the editor's
/// buffer): same rule, offsets in its `\n`-joined plain text.
pub fn toggle_note_in_content(content: &EditorContent, range: Range<usize>) -> EditorContent {
    let range = ordered(range);
    match content {
        EditorContent::Text(text) => {
            let plain = text.plain_text();
            let range = floor_boundary(&plain, range.start)..floor_boundary(&plain, range.end);
            EditorContent::Text(toggle_note_range(text, range))
        }
        EditorContent::Lines(lines) => EditorContent::Lines(toggle_note_in_lines(lines, range)),
    }
}

fn toggle_note_in_lines(lines: &[InlineContent], range: Range<usize>) -> Vec<InlineContent> {
    // Per line: the part of `range` inside it, in line-local offsets.
    let mut parts: Vec<Option<Range<usize>>> = Vec::with_capacity(lines.len());
    let mut line_start = 0;
    for line in lines {
        let plain = line.plain_text();
        let end = line_start + plain.len();
        let start = range.start.max(line_start);
        let stop = range.end.min(end);
        parts.push((start < stop).then(|| {
            floor_boundary(&plain, start - line_start)..floor_boundary(&plain, stop - line_start)
        }));
        line_start = end + 1;
    }

    let touches_note = |line: &InlineContent, part: &Range<usize>| {
        let mut offset = 0;
        normalize_runs(&line.to_runs()).iter().any(|run| {
            let span = offset..offset + run.text.len();
            offset = span.end;
            run.role == RunRole::Note && part.start < span.end && part.end > span.start
        })
    };
    let any_note = lines
        .iter()
        .zip(&parts)
        .any(|(line, part)| part.as_ref().is_some_and(|p| touches_note(line, p)));

    lines
        .iter()
        .zip(parts)
        .map(|(line, part)| match part {
            None => line.clone(),
            Some(part) if any_note => {
                if touches_note(line, &part) {
                    toggle_note_range(line, part)
                } else {
                    line.clone()
                }
            }
            Some(part) => mark_range_as_note(line, part),
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Prayer metadata
// ---------------------------------------------------------------------------

/// `Some(text)` unless `text` is empty (the form fields clear to "absent").
fn non_empty(text: &str) -> Option<String> {
    (!text.is_empty()).then(|| text.to_owned())
}

/// Sets the prayer id (the file name). Id collisions are the Library's
/// concern, not checked here.
pub fn set_id(prayer: &mut Prayer, id: &str) {
    prayer.id = id.to_owned();
}

pub fn set_type(prayer: &mut Prayer, prayer_type: &str) {
    prayer.prayer_type = prayer_type.to_owned();
}

/// Empty text removes the key.
pub fn set_description(prayer: &mut Prayer, description: &str) {
    prayer.description = non_empty(description);
}

/// Empty text removes the key.
pub fn set_book(prayer: &mut Prayer, book: &str) {
    prayer.book = non_empty(book);
}

/// Empty text removes the key.
pub fn set_occasion(prayer: &mut Prayer, occasion: &str) {
    prayer.occasion = non_empty(occasion);
}

/// Sets the tone. Clearing it writes an explicit `null` like the Electron
/// editor, except that a prayer without a `tone` key keeps it absent.
pub fn set_tone(prayer: &mut Prayer, tone: Option<u8>) {
    prayer.tone = match (tone, prayer.tone) {
        (Some(tone), _) => Some(Some(tone)),
        (None, None) => None,
        (None, Some(_)) => Some(None),
    };
}

fn custom_mut(prayer: &mut Prayer) -> &mut serde_json::Map<String, serde_json::Value> {
    prayer
        .meta
        .get_or_insert_with(Meta::default)
        .custom
        .get_or_insert_with(Default::default)
}

/// Drops `meta` when it holds nothing any more.
fn tidy_meta(prayer: &mut Prayer) {
    if let Some(meta) = &mut prayer.meta {
        if meta.custom.as_ref().is_some_and(|c| c.is_empty()) {
            meta.custom = None;
        }
        if meta.custom.is_none() {
            prayer.meta = None;
        }
    }
}

/// Sets a custom `meta` field to a string; a blank value removes the field.
pub fn set_custom_field(prayer: &mut Prayer, key: &str, value: &str) {
    if value.trim().is_empty() {
        remove_custom_field(prayer, key);
    } else {
        custom_mut(prayer).insert(key.to_owned(), value.into());
    }
}

/// Renames a custom field, keeping its value. A blank or unchanged name, a
/// name already in use or an unknown field does nothing (`false`).
pub fn rename_custom_field(prayer: &mut Prayer, from: &str, to: &str) -> bool {
    let to = to.trim();
    if to.is_empty() || to == from {
        return false;
    }
    let Some(custom) = prayer.meta.as_mut().and_then(|m| m.custom.as_mut()) else {
        return false;
    };
    if custom.contains_key(to) {
        return false;
    }
    match custom.remove(from) {
        Some(value) => {
            custom.insert(to.to_owned(), value);
            true
        }
        None => false,
    }
}

/// Adds an empty custom field named `field_1`, `field_2`... (the first free
/// one); returns its name.
pub fn add_custom_field(prayer: &mut Prayer) -> String {
    let custom = custom_mut(prayer);
    let key = (1..)
        .map(|n| format!("field_{n}"))
        .find(|key| !custom.contains_key(key))
        .expect("unbounded range");
    custom.insert(key.clone(), "".into());
    key
}

/// Removes a custom field; `meta` goes away when it is left empty.
pub fn remove_custom_field(prayer: &mut Prayer, key: &str) -> bool {
    let removed = prayer
        .meta
        .as_mut()
        .and_then(|m| m.custom.as_mut())
        .is_some_and(|custom| custom.remove(key).is_some());
    if removed {
        tidy_meta(prayer);
    }
    removed
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

/// Fields of a Variant to change; `None` leaves a field as it is.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct VariantMetaPatch {
    pub lang: Option<String>,
    pub variant: Option<String>,
    pub title: Option<String>,
    pub license: Option<String>,
    pub source: Option<String>,
}

/// A Variant whose `lang` or `variant` changed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VariantRenamed {
    pub from: VariantRef,
    pub to: VariantRef,
}

/// Adds a Variant `en` / `draft-N` (N: the first number that is free,
/// starting at the Variant count + 1) titled like the first Variant, and
/// returns it. It starts without text in any Block.
pub fn add_variant(prayer: &mut Prayer) -> VariantRef {
    let variant = (prayer.variants.len() + 1..)
        .map(|n| format!("draft-{n}"))
        .find(|name| {
            !prayer
                .variants
                .iter()
                .any(|v| v.lang == "en" && &v.variant == name)
        })
        .expect("unbounded range");
    let title = prayer
        .variants
        .first()
        .map_or_else(|| "Untitled".to_owned(), |v| v.title.clone());
    let meta = VariantMeta {
        lang: "en".into(),
        variant,
        title,
        license: "unknown".into(),
        source: "draft".into(),
    };
    let created = VariantRef::from(&meta);
    prayer.variants.push(meta);
    created
}

/// Removes Variant `index`. The last Variant cannot be removed (`None`).
/// Translations of the removed Variant stay in the Blocks, as in the Electron
/// editor, so adding the same `lang`/`variant` back finds its text again.
pub fn remove_variant(prayer: &mut Prayer, index: usize) -> Option<VariantMeta> {
    if prayer.variants.len() <= 1 || index >= prayer.variants.len() {
        return None;
    }
    Some(prayer.variants.remove(index))
}

/// Edits the metadata of Variant `index`.
///
/// Changing `lang` or `variant` also moves the Variant's translations in every
/// Block to the new key (the Electron editor left them behind under the old
/// one), unless another Variant already has the new key. Returns the rename,
/// so the caller can keep its active column pointing at the same Variant.
pub fn update_variant_meta(
    prayer: &mut Prayer,
    index: usize,
    patch: &VariantMetaPatch,
) -> Option<VariantRenamed> {
    let meta = prayer.variants.get_mut(index)?;
    let from = VariantRef::from(&*meta);
    if let Some(lang) = &patch.lang {
        meta.lang.clone_from(lang);
    }
    if let Some(variant) = &patch.variant {
        meta.variant.clone_from(variant);
    }
    if let Some(title) = &patch.title {
        meta.title.clone_from(title);
    }
    if let Some(license) = &patch.license {
        meta.license.clone_from(license);
    }
    if let Some(source) = &patch.source {
        meta.source.clone_from(source);
    }
    let to = VariantRef::from(&*meta);
    if from == to {
        return None;
    }

    let taken = prayer
        .variants
        .iter()
        .enumerate()
        .any(|(i, v)| i != index && v.key() == to.key());
    if !taken {
        for block in &mut prayer.structure {
            let target_free = !block.translations.iter().any(|t| t.key() == to.key());
            if !target_free {
                continue;
            }
            for t in block
                .translations
                .iter_mut()
                .filter(|t| t.key() == from.key())
            {
                t.lang.clone_from(&to.lang);
                t.variant.clone_from(&to.variant);
            }
        }
    }
    Some(VariantRenamed { from, to })
}

/// Drops visible columns whose Variant no longer exists. When none is left:
/// `fallback` if the prayer has it, else the first Variant, else nothing.
pub fn reconcile_visible_variants(
    columns: &[VariantRef],
    prayer_variants: &[VariantMeta],
    fallback: Option<&VariantRef>,
) -> Vec<VariantRef> {
    let exists = |v: &VariantRef| prayer_variants.iter().any(|m| m.key() == v.key());
    let kept: Vec<VariantRef> = columns.iter().filter(|c| exists(c)).cloned().collect();
    if !kept.is_empty() {
        return kept;
    }
    if let Some(fallback) = fallback.filter(|f| exists(f)) {
        return vec![fallback.clone()];
    }
    prayer_variants
        .first()
        .map(|v| vec![VariantRef::from(v)])
        .unwrap_or_default()
}

/// The column to open a prayer with: the `preferred` Variant when the prayer
/// has it, else its first Variant.
pub fn pick_default_variant(prayer: &Prayer, preferred: Option<&VariantRef>) -> Vec<VariantRef> {
    let pick = preferred
        .and_then(|p| prayer.variants.iter().find(|v| v.key() == p.key()))
        .or_else(|| prayer.variants.first());
    pick.map(|v| vec![VariantRef::from(v)]).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Kinds and fill state
// ---------------------------------------------------------------------------

/// Presets first (fixed order), then custom Kinds sorted; duplicates dropped.
pub fn order_kinds<'a>(kinds: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut unique: Vec<&str> = Vec::new();
    for kind in kinds {
        if !unique.contains(&kind) {
            unique.push(kind);
        }
    }
    let mut ordered: Vec<String> = KIND_PRESETS
        .iter()
        .filter(|k| unique.contains(k))
        .map(|k| (*k).to_owned())
        .collect();
    let mut custom: Vec<&str> = unique.into_iter().filter(|k| !is_kind_preset(k)).collect();
    custom.sort_by(|a, b| prayer_core::kinds::compare_locale(a, b));
    ordered.extend(custom.into_iter().map(str::to_owned));
    ordered
}

/// Kinds to offer for a Block: the presets, those the prayer uses and
/// `extra` (e.g. the Library's custom Kinds).
pub fn kind_options(prayer: &Prayer, extra: &[&str]) -> Vec<String> {
    order_kinds(
        KIND_PRESETS
            .iter()
            .copied()
            .chain(prayer.structure.iter().map(|b| b.kind.as_str()))
            .chain(extra.iter().copied()),
    )
}

/// Why renaming Kind `from` to `to` is not possible (the message shown next
/// to the field), or `None` when it is.
pub fn kind_rename_issue<'a>(
    from: &str,
    to: &str,
    existing: impl IntoIterator<Item = &'a str>,
) -> Option<&'static str> {
    let next = to.trim();
    if next.is_empty() {
        return Some("Required");
    }
    if next == from {
        return None;
    }
    if is_kind_preset(from) {
        return Some("Built-in kinds cannot be renamed");
    }
    if !is_valid_kind_id(next) {
        return Some("Use a letter, then letters, digits, _ or -");
    }
    if is_kind_preset(next) {
        return Some("That name is reserved");
    }
    existing
        .into_iter()
        .any(|kind| kind == next)
        .then_some("Already exists")
}

/// Whether a Block has visible text in a Variant.
pub fn is_translation_filled(prayer: &Prayer, block_id: &str, key: VariantKey<'_>) -> bool {
    let Some(content) = block_editor_content(prayer, block_id, key) else {
        return false;
    };
    let Some(block) = prayer.structure.iter().find(|b| b.id == block_id) else {
        return false;
    };
    block.translation(key).is_some() && !content.plain_text().trim().is_empty()
}

/// Whether every Variant the prayer declares has no text in the Block
/// (an unknown Block counts as empty). `ignore` is treated as empty.
pub fn is_block_empty_across_variants(
    prayer: &Prayer,
    block_id: &str,
    ignore: Option<VariantKey<'_>>,
) -> bool {
    if !has_block_id(prayer, block_id) {
        return true;
    }
    prayer
        .variants
        .iter()
        .all(|v| ignore == Some(v.key()) || !is_translation_filled(prayer, block_id, v.key()))
}

/// How many Blocks have text in a Variant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fill {
    pub filled: usize,
    pub total: usize,
}

impl Fill {
    /// Rounded percentage; a prayer without Blocks counts as 100.
    pub fn percent(self) -> u32 {
        if self.total == 0 {
            100
        } else {
            ((self.filled * 100) as f64 / self.total as f64).round() as u32
        }
    }
}

pub fn fill(prayer: &Prayer, key: VariantKey<'_>) -> Fill {
    Fill {
        filled: prayer
            .structure
            .iter()
            .filter(|b| is_translation_filled(prayer, &b.id, key))
            .count(),
        total: prayer.structure.len(),
    }
}

// ---------------------------------------------------------------------------
// Outline
// ---------------------------------------------------------------------------

/// Kinds that appear in the Content outline.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutlineKind {
    Heading,
    Subheading,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutlineEntry {
    pub block_id: String,
    pub kind: OutlineKind,
    /// Trimmed plain text; empty means the UI shows "Untitled".
    pub label: String,
    /// Subheadings under a heading.
    pub children: Vec<OutlineEntry>,
}

/// Builds the Content outline from heading and subheading Blocks, labelled
/// with their text in the `primary` Variant. Subheadings nest under the last
/// heading; before any heading they stand at the root.
pub fn build_outline(prayer: &Prayer, primary: VariantKey<'_>) -> Vec<OutlineEntry> {
    let mut roots: Vec<OutlineEntry> = Vec::new();
    let mut under_heading = false;
    for block in &prayer.structure {
        let kind = match block.kind.as_str() {
            "heading" => OutlineKind::Heading,
            "subheading" => OutlineKind::Subheading,
            _ => continue,
        };
        let label = editor_content(&block.kind, block.translation(primary))
            .plain_text()
            .trim()
            .to_owned();
        let entry = OutlineEntry {
            block_id: block.id.clone(),
            kind,
            label,
            children: Vec::new(),
        };
        match (kind, under_heading, roots.last_mut()) {
            (OutlineKind::Subheading, true, Some(heading)) => heading.children.push(entry),
            (OutlineKind::Heading, ..) => {
                under_heading = true;
                roots.push(entry);
            }
            _ => roots.push(entry),
        }
    }
    roots
}

/// A Block of the outline with its position in the scrolled content.
#[derive(Clone, Debug, PartialEq)]
pub struct OutlineAnchor {
    pub block_id: String,
    pub kind: OutlineKind,
    /// Offset from the start of the scroll content.
    pub top: f32,
    /// A subheading before any heading.
    pub orphan: bool,
}

/// Outline entries in document order as `(block id, kind, orphan)`; the
/// caller fills in the `top` of each.
pub fn flatten_outline(entries: &[OutlineEntry]) -> Vec<(String, OutlineKind, bool)> {
    let mut out = Vec::new();
    for entry in entries {
        out.push((
            entry.block_id.clone(),
            entry.kind,
            entry.kind == OutlineKind::Subheading,
        ));
        out.extend(
            entry
                .children
                .iter()
                .map(|c| (c.block_id.clone(), c.kind, false)),
        );
    }
    out
}

/// Slack in pixels so a heading landed on the sticky reading line by an
/// outline jump still counts as active when it measures slightly below.
pub const OUTLINE_ACTIVE_THRESHOLD_SLACK: f32 = 1.0;

/// Scrollspy: the last heading (or orphan subheading) whose top is at or
/// above the top of the scrollport plus the sticky offset. Nested
/// subheadings never win.
pub fn active_outline_id(
    anchors: &[OutlineAnchor],
    scroll_top: f32,
    header_offset: f32,
) -> Option<&str> {
    let threshold = scroll_top + header_offset + OUTLINE_ACTIVE_THRESHOLD_SLACK;
    let mut active = None;
    for anchor in anchors {
        if anchor.top > threshold {
            break;
        }
        if anchor.kind == OutlineKind::Heading || anchor.orphan {
            active = Some(anchor.block_id.as_str());
        }
    }
    active
}

// ---------------------------------------------------------------------------
// Find and replace
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FindOptions {
    pub match_case: bool,
    pub whole_word: bool,
}

/// One hit: a byte range in the editor plain text of a Block in a Variant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FindMatch {
    pub block_id: String,
    pub variant: VariantRef,
    pub range: Range<usize>,
    pub line_mode: bool,
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '\''
}

/// Case folding that keeps byte offsets: one char to one char (final sigma
/// folds with sigma so Greek words match in any case).
fn fold(c: char) -> char {
    match c {
        '\u{3C2}' => '\u{3C3}',
        c => c.to_lowercase().next().unwrap_or(c),
    }
}

/// Byte ranges of `query` in `text`, left to right, not overlapping.
fn find_in_text(text: &str, query: &str, options: FindOptions) -> Vec<Range<usize>> {
    if query.is_empty() {
        return Vec::new();
    }
    let key = |c: char| if options.match_case { c } else { fold(c) };
    let needle: Vec<char> = query.chars().map(key).collect();
    let hay: Vec<(usize, char)> = text.char_indices().map(|(i, c)| (i, key(c))).collect();
    let end_of = |i: usize| hay.get(i).map_or(text.len(), |(b, _)| *b);

    let mut hits = Vec::new();
    let mut i = 0;
    while i + needle.len() <= hay.len() {
        let matches = hay[i..i + needle.len()]
            .iter()
            .map(|(_, c)| c)
            .eq(needle.iter());
        if matches {
            let range = hay[i].0..end_of(i + needle.len());
            let whole = !options.whole_word
                || (!text[..range.start]
                    .chars()
                    .next_back()
                    .is_some_and(is_word_char)
                    && !text[range.end..].chars().next().is_some_and(is_word_char));
            if whole {
                hits.push(range);
                i += needle.len();
                continue;
            }
        }
        i += 1;
    }
    hits
}

/// All matches of `query` in the visible Variants of a prayer, in Block
/// order and, within a Block, in the order of `visible`.
pub fn find_matches(
    prayer: &Prayer,
    visible: &[VariantRef],
    query: &str,
    options: FindOptions,
) -> Vec<FindMatch> {
    let mut matches = Vec::new();
    for block in &prayer.structure {
        let line_mode = uses_lines(&block.kind);
        for variant in visible {
            let text = editor_content(&block.kind, block.translation(variant.key())).plain_text();
            matches.extend(
                find_in_text(&text, query, options)
                    .into_iter()
                    .map(|range| FindMatch {
                        block_id: block.id.clone(),
                        variant: variant.clone(),
                        range,
                        line_mode,
                    }),
            );
        }
    }
    matches
}

/// Replaces `range` in editor content with `replacement`; `None` when
/// nothing is left. Runs outside the range keep their role. In line mode, a
/// line emptied by the replacement disappears, and a replacement across
/// lines rebuilds the lines from plain text (notes in it are lost).
pub fn replace_in_editor_content(
    content: &EditorContent,
    line_mode: bool,
    range: Range<usize>,
    replacement: &str,
) -> Option<EditorContent> {
    let range = ordered(range);
    if !line_mode {
        let inline = match content {
            EditorContent::Text(text) => text.clone(),
            EditorContent::Lines(lines) => InlineContent::Plain(join_lines_plain(lines)),
        };
        let plain = inline.plain_text();
        let range = floor_boundary(&plain, range.start)..floor_boundary(&plain, range.end);
        let next = replace_range_in_inline(&inline, range, replacement);
        return (!next.plain_text().is_empty()).then_some(EditorContent::Text(next));
    }

    let lines: Vec<InlineContent> = match content {
        EditorContent::Lines(lines) => lines.clone(),
        EditorContent::Text(text) => vec![text.clone()],
    };
    if lines.is_empty() {
        return (!replacement.is_empty()).then(|| {
            EditorContent::Lines(replacement.split('\n').map(InlineContent::from).collect())
        });
    }
    let (start_line, start_local) = map_offset_to_line(&lines, range.start);
    let (end_line, end_local) = map_offset_to_line(&lines, range.end);
    if start_line == end_line {
        let mut lines = lines;
        let next = replace_range_in_inline(&lines[start_line], start_local..end_local, replacement);
        if next.plain_text().is_empty() {
            lines.remove(start_line);
        } else {
            lines[start_line] = next;
        }
        return (!lines.is_empty()).then_some(EditorContent::Lines(lines));
    }
    let plain = join_lines_plain(&lines);
    let range = floor_boundary(&plain, range.start)..floor_boundary(&plain, range.end);
    let next = format!(
        "{}{replacement}{}",
        &plain[..range.start],
        &plain[range.end..]
    );
    (!next.is_empty())
        .then(|| EditorContent::Lines(next.split('\n').map(InlineContent::from).collect()))
}

/// Replaces one match. Returns whether the prayer changed.
pub fn replace_match(prayer: &mut Prayer, found: &FindMatch, replacement: &str) -> bool {
    let key = found.variant.key();
    let Some(block) = prayer.structure.iter_mut().find(|b| b.id == found.block_id) else {
        return false;
    };
    let content = editor_content(&block.kind, block.translation(key));
    let next =
        replace_in_editor_content(&content, found.line_mode, found.range.clone(), replacement)
            .unwrap_or_else(|| EditorContent::empty(found.line_mode));
    commit_into_block(block, key, &next)
}

/// Replaces all `matches` (from [`find_matches`] on this prayer, unchanged
/// since). Works from the end of each text so earlier positions stay valid.
/// Returns how many replacements changed the prayer.
pub fn replace_all(prayer: &mut Prayer, matches: &[FindMatch], replacement: &str) -> usize {
    let order = |id: &str| {
        prayer
            .structure
            .iter()
            .position(|b| b.id == id)
            .unwrap_or(0)
    };
    let mut sorted: Vec<(usize, &FindMatch)> =
        matches.iter().map(|m| (order(&m.block_id), m)).collect();
    sorted.sort_by(|(block_a, a), (block_b, b)| {
        block_b
            .cmp(block_a)
            .then_with(|| b.range.start.cmp(&a.range.start))
    });
    sorted
        .into_iter()
        .filter(|(_, m)| replace_match(prayer, m, replacement))
        .count()
}

/// Matches and Blocks they are in, for the "Replace all?" confirmation.
pub fn summarize_replace_all(matches: &[FindMatch]) -> (usize, usize) {
    let mut blocks: Vec<&str> = matches.iter().map(|m| m.block_id.as_str()).collect();
    blocks.sort_unstable();
    blocks.dedup();
    (matches.len(), blocks.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use prayer_core::model::TextRun;
    use serde_json::json;

    const DE: VariantKey<'static> = VariantKey {
        lang: "de",
        variant: "standard",
    };
    const RU: VariantKey<'static> = VariantKey {
        lang: "ru",
        variant: "cs",
    };
    const EL: VariantKey<'static> = VariantKey {
        lang: "el",
        variant: "standard",
    };

    fn prayer() -> Prayer {
        serde_json::from_value(json!({
            "id": "test",
            "type": "prayer",
            "variants": [
                {"lang": "de", "variant": "standard", "title": "Titel", "license": "CC0", "source": "x"},
                {"lang": "ru", "variant": "cs", "title": "Название", "license": "CC0", "source": "y"}
            ],
            "structure": [
                {"id": "h", "kind": "heading", "translations": [
                    {"lang": "de", "variant": "standard", "text": "Anfang"},
                    {"lang": "ru", "variant": "cs", "text": "Начало"}
                ]},
                {"id": "a", "kind": "annotation", "translations": [
                    {"lang": "de", "variant": "standard", "text": "Hallo Welt"},
                    {"lang": "ru", "variant": "cs", "text": "Слава Отцу"}
                ]},
                {"id": "v", "kind": "verse", "translations": [
                    {"lang": "de", "variant": "standard", "lines": ["Erste", "Zweite"]}
                ]}
            ]
        }))
        .unwrap()
    }

    fn text(s: &str) -> EditorContent {
        EditorContent::Text(s.into())
    }

    fn lines(ls: &[&str]) -> EditorContent {
        EditorContent::Lines(ls.iter().map(|l| InlineContent::from(*l)).collect())
    }

    fn content(p: &Prayer, id: &str, key: VariantKey<'_>) -> EditorContent {
        block_editor_content(p, id, key).unwrap()
    }

    fn valid(p: &Prayer) {
        let value = serde_json::to_value(p).unwrap();
        if let Err(errors) = prayer_core::validate::validate(&value) {
            panic!("invalid prayer: {errors:?}");
        }
    }

    // -- content ----------------------------------------------------------

    #[test]
    fn editor_content_shapes() {
        let p = prayer();
        assert_eq!(content(&p, "a", DE), text("Hallo Welt"));
        assert_eq!(content(&p, "v", DE), lines(&["Erste", "Zweite"]));
        // verse without lines for a Variant: no lines
        assert_eq!(content(&p, "v", RU), lines(&[]));
        assert_eq!(content(&p, "a", EL), text(""));
        assert_eq!(block_editor_content(&p, "nope", DE), None);

        // verse with only `text` shows one line; text Kind with lines joins them
        let verse_text = Translation {
            lang: "de".into(),
            variant: "standard".into(),
            text: Some("Eins".into()),
            lines: None,
        };
        assert_eq!(editor_content("verse", Some(&verse_text)), lines(&["Eins"]));
        let text_lines = Translation {
            text: None,
            lines: Some(vec!["Eins".into(), "Zwei".into()]),
            ..verse_text.clone()
        };
        assert_eq!(
            editor_content("annotation", Some(&text_lines)),
            text("Eins\nZwei")
        );
    }

    #[test]
    fn set_content_replaces_in_place_and_appends_new() {
        let mut p = prayer();
        assert!(set_block_content(&mut p, "a", DE, &text("Guten Tag")));
        assert_eq!(content(&p, "a", DE), text("Guten Tag"));
        assert_eq!(p.structure[1].translations[0].lang, "de", "order kept");
        assert!(set_block_content(&mut p, "v", RU, &lines(&["Первая"])));
        assert_eq!(p.structure[2].translations.len(), 2);
        valid(&p);
    }

    #[test]
    fn empty_content_removes_the_translation() {
        // checklist: no empty translation keys
        let mut p = prayer();
        assert!(set_block_content(&mut p, "a", DE, &text("")));
        assert!(p.structure[1].translation(DE).is_none());
        assert!(set_block_content(&mut p, "a", RU, &text("  \u{a0}\n")));
        assert!(p.structure[1].translation(RU).is_none());
        assert!(set_block_content(&mut p, "v", DE, &lines(&["", ""])));
        assert!(p.structure[2].translations.is_empty());
        // removing what is not there is a no-op
        assert!(!set_block_content(&mut p, "v", DE, &lines(&[])));
        valid(&p);
    }

    #[test]
    fn unchanged_commit_is_a_no_op() {
        let mut p = prayer();
        let before = p.clone();
        assert!(!set_block_content(&mut p, "a", DE, &text("Hallo Welt")));
        assert!(!set_block_content(
            &mut p,
            "v",
            DE,
            &lines(&["Erste", "Zweite"])
        ));
        assert!(!set_block_content(&mut p, "missing", DE, &text("x")));
        assert_eq!(p, before);
    }

    #[test]
    fn empty_lines_are_dropped_on_commit() {
        let mut p = prayer();
        set_block_content(&mut p, "v", DE, &lines(&["A", "", "B"]));
        assert_eq!(content(&p, "v", DE), lines(&["A", "B"]));
    }

    #[test]
    fn runs_are_stored_normalized() {
        let mut p = prayer();
        let runs = InlineContent::Runs(vec![
            TextRun::text("Слава "),
            TextRun::note(" (трижды) "),
            TextRun::text("Отцу"),
        ]);
        set_block_content(&mut p, "a", RU, &EditorContent::Text(runs));
        let stored = p.structure[1]
            .translation(RU)
            .unwrap()
            .text
            .clone()
            .unwrap();
        assert_eq!(
            stored,
            InlineContent::Runs(vec![
                TextRun::text("Слава  "),
                TextRun::note("(трижды)"),
                TextRun::text(" Отцу")
            ])
        );
        // runs without any note collapse to a plain string
        let only_text = InlineContent::Runs(vec![TextRun::text("a"), TextRun::text("b")]);
        set_block_content(&mut p, "a", RU, &EditorContent::Text(only_text));
        assert_eq!(content(&p, "a", RU), text("ab"));
        valid(&p);
    }

    #[test]
    fn text_into_verse_and_lines_into_text_reshape() {
        let mut p = prayer();
        // text committed to a verse Block becomes one line
        assert!(set_block_content(&mut p, "v", RU, &text("Единая")));
        let tr = p.structure[2].translation(RU).unwrap();
        assert_eq!(tr.lines, Some(vec!["Единая".into()]));
        assert_eq!(tr.text, None);
        // lines committed to a text Block are joined
        set_block_content(&mut p, "a", DE, &lines(&["Eins", "Zwei"]));
        assert_eq!(content(&p, "a", DE), text("Eins\nZwei"));
        valid(&p);
    }

    // -- split ------------------------------------------------------------

    #[test]
    fn split_text_block_in_the_middle() {
        let mut p = prayer();
        let out = split_block_with_id(&mut p, 1, DE, 5..5, "n1").unwrap();
        assert_eq!(out.new_index, 2);
        assert_eq!(content(&p, "a", DE), text("Hallo"));
        assert_eq!(content(&p, "n1", DE), text(" Welt"));
        assert_eq!(p.structure[2].kind, "annotation");
        // the other Variant is untouched
        assert_eq!(content(&p, "a", RU), text("Слава Отцу"));
        assert_eq!(content(&p, "n1", RU), text(""));
        valid(&p);
    }

    #[test]
    fn split_cyrillic_at_a_char_boundary_and_inside_a_char() {
        let mut p = prayer();
        // "Слава Отцу": С(2) л(2) а(2) в(2) а(2) = 10 bytes then space
        split_block_with_id(&mut p, 1, RU, 10..10, "n1").unwrap();
        assert_eq!(content(&p, "a", RU), text("Слава"));
        assert_eq!(content(&p, "n1", RU), text(" Отцу"));
        // an offset in the middle of a char is floored, never a panic
        let mut p = prayer();
        split_block_with_id(&mut p, 1, RU, 3..3, "n1").unwrap();
        assert_eq!(content(&p, "a", RU), text("С"));
        assert_eq!(content(&p, "n1", RU), text("лава Отцу"));
    }

    #[test]
    fn split_greek_with_selection_drops_the_selection() {
        let mut p = prayer();
        set_block_content(&mut p, "a", EL, &text("Κύριε ἐλέησον"));
        // "Κύριε " = Κ2 ύ2 ρ2 ι2 ε2 + space1 = 11 bytes
        let (start, end) = (0, "Κύριε".len());
        split_block_with_id(&mut p, 1, EL, start..end, "n1").unwrap();
        assert_eq!(content(&p, "a", EL), text(""));
        assert_eq!(content(&p, "n1", EL), text(" ἐλέησον"));
        assert!(
            p.structure[1].translation(EL).is_none(),
            "empty side removed"
        );
    }

    #[test]
    fn split_at_the_end_makes_an_empty_block_and_at_start_moves_everything() {
        let mut p = prayer();
        let len = "Hallo Welt".len();
        split_block_with_id(&mut p, 1, DE, len..len, "n1").unwrap();
        assert_eq!(content(&p, "a", DE), text("Hallo Welt"));
        assert_eq!(content(&p, "n1", DE), text(""));
        assert!(p.structure[2].translations.is_empty());

        let mut p = prayer();
        split_block_with_id(&mut p, 1, DE, 0..0, "n1").unwrap();
        assert_eq!(content(&p, "a", DE), text(""));
        assert_eq!(content(&p, "n1", DE), text("Hallo Welt"));
    }

    #[test]
    fn split_keeps_notes_on_both_sides() {
        let mut p = prayer();
        let runs = InlineContent::Runs(vec![
            TextRun::text("Gott "),
            TextRun::note("(leise)"),
            TextRun::text(" Amen"),
        ]);
        set_block_content(&mut p, "a", DE, &EditorContent::Text(runs));
        // cut in the middle of the note
        let at = "Gott (le".len();
        split_block_with_id(&mut p, 1, DE, at..at, "n1").unwrap();
        assert_eq!(
            content(&p, "a", DE),
            EditorContent::Text(InlineContent::Runs(vec![
                TextRun::text("Gott "),
                TextRun::note("(le")
            ]))
        );
        assert_eq!(
            content(&p, "n1", DE),
            EditorContent::Text(InlineContent::Runs(vec![
                TextRun::note("ise)"),
                TextRun::text(" Amen")
            ]))
        );
        valid(&p);
    }

    #[test]
    fn split_verse_between_and_inside_lines() {
        let mut p = prayer();
        // "Erste\nZweite": caret at the end of line 1 (offset 5)
        split_block_with_id(&mut p, 2, DE, 5..5, "n1").unwrap();
        assert_eq!(content(&p, "v", DE), lines(&["Erste"]));
        assert_eq!(content(&p, "n1", DE), lines(&["Zweite"]));
        assert_eq!(p.structure[3].kind, "verse");

        // caret inside line 2: offset 6 + 3
        let mut p = prayer();
        split_block_with_id(&mut p, 2, DE, 9..9, "n1").unwrap();
        assert_eq!(content(&p, "v", DE), lines(&["Erste", "Zwe"]));
        assert_eq!(content(&p, "n1", DE), lines(&["ite"]));

        // selection across both lines drops the middle
        let mut p = prayer();
        split_block_with_id(&mut p, 2, DE, 2..8, "n1").unwrap();
        assert_eq!(content(&p, "v", DE), lines(&["Er"]));
        assert_eq!(content(&p, "n1", DE), lines(&["eite"]));
        valid(&p);
    }

    #[test]
    fn split_rejects_bad_index_and_taken_id() {
        let mut p = prayer();
        let before = p.clone();
        assert!(split_block_with_id(&mut p, 9, DE, 0..0, "n1").is_none());
        assert!(split_block_with_id(&mut p, 1, DE, 0..0, "h").is_none());
        assert_eq!(p, before);
    }

    #[test]
    fn generated_block_ids_are_unique_and_electron_shaped() {
        let p = prayer();
        assert_eq!(create_block_id(3, 36), "b4-10");
        let id = fresh_block_id(&p);
        assert!(id.starts_with("b4-"), "{id}");
        // a clash bumps the counter
        let mut q = prayer();
        q.structure[0].id = fresh_block_id_at(&q, 1000);
        assert_eq!(q.structure[0].id, "b4-rs");
        assert_eq!(fresh_block_id_at(&q, 1000), "b5-rs");
        let mut r = prayer();
        let a = split_block(&mut r, 1, DE, 2..2).unwrap().new_block_id;
        let b = split_block(&mut r, 1, DE, 1..1).unwrap().new_block_id;
        assert_ne!(a, b);
        valid(&r);
    }

    // -- merge ------------------------------------------------------------

    #[test]
    fn merge_joins_each_variant() {
        // new Backspace behaviour from the prototype
        let mut p = prayer();
        split_block_with_id(&mut p, 1, DE, 5..5, "n1").unwrap();
        set_block_content(&mut p, "n1", RU, &text(" Сыну"));
        let out = merge_block_into_previous(&mut p, 2).unwrap();
        assert_eq!(out.block_id, "a");
        assert_eq!(out.block_index, 1);
        assert_eq!(p.structure.len(), 3);
        assert_eq!(content(&p, "a", DE), text("Hallo Welt"));
        assert_eq!(content(&p, "a", RU), text("Слава Отцу Сыну"));
        let de = out
            .join_points
            .iter()
            .find(|j| j.variant.key() == DE)
            .unwrap();
        assert_eq!(de.offset, "Hallo".len());
        let ru = out
            .join_points
            .iter()
            .find(|j| j.variant.key() == RU)
            .unwrap();
        assert_eq!(ru.offset, "Слава Отцу".len());
        valid(&p);
    }

    #[test]
    fn merge_when_only_one_side_has_text() {
        let mut p = prayer();
        set_block_content(&mut p, "h", DE, &text(""));
        let out = merge_block_into_previous(&mut p, 1).unwrap();
        // heading had no DE text: result is just the annotation's
        assert_eq!(content(&p, "h", DE), text("Hallo Welt"));
        assert_eq!(content(&p, "h", RU), text("НачалоСлава Отцу"));
        assert_eq!(
            out.join_points
                .iter()
                .find(|j| j.variant.key() == DE)
                .unwrap()
                .offset,
            0
        );
        assert_eq!(p.structure[0].kind, "heading", "previous Kind survives");
    }

    #[test]
    fn merge_notes_survive() {
        let mut p = prayer();
        set_block_content(
            &mut p,
            "h",
            DE,
            &EditorContent::Text(InlineContent::Runs(vec![
                TextRun::text("A "),
                TextRun::note("(n)"),
            ])),
        );
        merge_block_into_previous(&mut p, 1).unwrap();
        assert_eq!(
            content(&p, "h", DE),
            EditorContent::Text(InlineContent::Runs(vec![
                TextRun::text("A "),
                TextRun::note("(n)"),
                TextRun::text("Hallo Welt")
            ]))
        );
        valid(&p);
    }

    #[test]
    fn merge_verse_into_verse_joins_boundary_lines() {
        let mut p = prayer();
        insert_block_with_id(&mut p, 3, "verse", "v2").unwrap();
        set_block_content(&mut p, "v2", DE, &lines(&["ZweiteFortsetzung", "Dritte"]));
        // previous last line gets the first line of the merged one
        let out = merge_block_into_previous(&mut p, 3).unwrap();
        assert_eq!(
            content(&p, "v", DE),
            lines(&["Erste", "ZweiteZweiteFortsetzung", "Dritte"])
        );
        assert_eq!(out.join_points[0].offset, "Erste\nZweite".len());
        valid(&p);
    }

    #[test]
    fn merge_across_shapes_follows_the_previous_block() {
        // text <- verse: lines joined by \n
        let mut p = prayer();
        move_block(&mut p, 2, -1).unwrap(); // h, v, a
        merge_block_into_previous(&mut p, 2).unwrap(); // a into verse
        assert_eq!(content(&p, "v", DE), lines(&["Erste", "ZweiteHallo Welt"]));

        let mut p = prayer();
        merge_block_into_previous(&mut p, 1).unwrap(); // a into heading
        let mut q = p.clone();
        merge_block_into_previous(&mut q, 1).unwrap(); // verse into heading (text)
        assert_eq!(content(&q, "h", DE), text("AnfangHallo WeltErste\nZweite"));
        valid(&q);
    }

    #[test]
    fn merge_first_or_missing_block_is_none() {
        let mut p = prayer();
        assert!(merge_block_into_previous(&mut p, 0).is_none());
        assert!(merge_block_into_previous(&mut p, 3).is_none());
        assert_eq!(p, prayer());
    }

    // -- block structure --------------------------------------------------

    #[test]
    fn insert_add_delete_move() {
        let mut p = prayer();
        let id = add_block(&mut p, "annotation");
        assert_eq!(p.structure.last().unwrap().id, id);
        assert!(p.structure.last().unwrap().translations.is_empty());

        let id = insert_block_after(&mut p, 2).unwrap();
        assert_eq!(p.structure[3].id, id);
        assert_eq!(
            p.structure[3].kind, "verse",
            "same Kind as the Block before"
        );
        assert!(insert_block_after(&mut p, 99).is_none());

        insert_block_with_id(&mut p, 0, "heading", "first").unwrap();
        assert_eq!(p.structure[0].id, "first");
        assert!(
            insert_block_with_id(&mut p, 0, "heading", "first").is_none(),
            "no duplicate id"
        );
        insert_block_with_id(&mut p, 999, "heading", "last").unwrap();
        assert_eq!(p.structure.last().unwrap().id, "last");

        let removed = delete_block(&mut p, 0).unwrap();
        assert_eq!(removed.id, "first");
        assert!(delete_block(&mut p, 99).is_none());
        valid(&p);
    }

    #[test]
    fn move_block_swaps_and_stays_in_bounds() {
        let mut p = prayer();
        assert_eq!(move_block(&mut p, 0, 1), Some(1));
        assert_eq!(p.structure[0].id, "a");
        assert_eq!(move_block(&mut p, 1, -1), Some(0));
        assert_eq!(p.structure[0].id, "h");
        assert_eq!(move_block(&mut p, 0, -1), None);
        assert_eq!(move_block(&mut p, 2, 1), None);
        assert_eq!(move_block(&mut p, 5, -1), None);
        assert_eq!(move_block(&mut p, 1, 0), None);
    }

    #[test]
    fn change_kind_reshapes_translations() {
        let mut p = prayer();
        // verse -> annotation: lines become text joined by \n
        assert!(set_block_kind(&mut p, 2, "annotation"));
        let tr = p.structure[2].translation(DE).unwrap();
        assert_eq!(tr.text, Some("Erste\nZweite".into()));
        assert_eq!(tr.lines, None);
        // annotation -> verse again: one line (not split)
        assert!(set_block_kind(&mut p, 2, "verse"));
        let tr = p.structure[2].translation(DE).unwrap();
        assert_eq!(tr.lines, Some(vec!["Erste\nZweite".into()]));
        assert_eq!(tr.text, None);
        // same shape: only the Kind changes
        assert!(set_block_kind(&mut p, 1, "subheading"));
        assert_eq!(content(&p, "a", RU), text("Слава Отцу"));
        // same Kind: no change
        assert!(!set_block_kind(&mut p, 1, "subheading"));
        assert!(!set_block_kind(&mut p, 9, "verse"));
        valid(&p);
    }

    #[test]
    fn change_kind_with_single_line_keeps_notes() {
        let mut p = prayer();
        let note_line = InlineContent::Runs(vec![TextRun::text("Gott "), TextRun::note("(still)")]);
        p.structure[2].translations[0].lines = Some(vec![note_line.clone()]);
        set_block_kind(&mut p, 2, "annotation");
        assert_eq!(content(&p, "v", DE), EditorContent::Text(note_line));
        valid(&p);
    }

    #[test]
    fn kind_delete_and_rename_come_from_core() {
        let mut p = prayer();
        assert_eq!(rename_kind(&mut p, "annotation", "rubric"), 1);
        assert_eq!(p.structure[1].kind, "rubric");
        assert_eq!(delete_kind(&mut p, "rubric", DEFAULT_DELETE_FALLBACK), 1);
        assert_eq!(p.structure[1].kind, "verse");
    }

    // -- notes ------------------------------------------------------------

    #[test]
    fn toggle_note_on_and_off() {
        let mut p = prayer();
        let start = "Hallo ".len();
        assert!(toggle_note(&mut p, "a", DE, start..start + 4));
        assert_eq!(
            content(&p, "a", DE),
            EditorContent::Text(InlineContent::Runs(vec![
                TextRun::text("Hallo "),
                TextRun::note("Welt")
            ]))
        );
        valid(&p);
        // touching the note turns it back into text, and the string collapses
        assert!(toggle_note(&mut p, "a", DE, start + 1..start + 2));
        assert_eq!(content(&p, "a", DE), text("Hallo Welt"));
        assert!(matches!(
            p.structure[1].translation(DE).unwrap().text,
            Some(InlineContent::Plain(_))
        ));
    }

    #[test]
    fn toggle_note_cyrillic_keeps_edge_whitespace_as_text() {
        let mut p = prayer();
        let all = 0.."Слава Отцу".len();
        assert!(toggle_note(&mut p, "a", RU, all));
        assert_eq!(
            content(&p, "a", RU),
            EditorContent::Text(InlineContent::Runs(vec![TextRun::note("Слава Отцу")]))
        );
        valid(&p);
    }

    #[test]
    fn toggle_note_empty_or_whitespace_selection_does_nothing() {
        let mut p = prayer();
        let before = p.clone();
        assert!(!toggle_note(&mut p, "a", DE, 3..3));
        assert!(!toggle_note(&mut p, "a", DE, 5..6)); // just the space
        assert!(!toggle_note(&mut p, "nope", DE, 0..2));
        assert_eq!(p, before);
    }

    #[test]
    fn toggle_note_over_verse_lines() {
        let mut p = prayer();
        // "Erste\nZweite": select "te\nZwe"
        assert!(toggle_note(&mut p, "v", DE, 3..9));
        assert_eq!(
            content(&p, "v", DE),
            EditorContent::Lines(vec![
                InlineContent::Runs(vec![TextRun::text("Ers"), TextRun::note("te")]),
                InlineContent::Runs(vec![TextRun::note("Zwe"), TextRun::text("ite")]),
            ])
        );
        valid(&p);
        // toggling again over the whole thing removes both notes
        assert!(toggle_note(&mut p, "v", DE, 0..12));
        assert_eq!(content(&p, "v", DE), lines(&["Erste", "Zweite"]));
        valid(&p);
    }

    // -- metadata ---------------------------------------------------------

    #[test]
    fn prayer_settings() {
        let mut p = prayer();
        set_id(&mut p, "new-id");
        set_type(&mut p, "troparion");
        set_description(&mut p, "Kurz");
        set_book(&mut p, "horologion");
        set_occasion(&mut p, "Pascha");
        set_tone(&mut p, Some(4));
        assert_eq!(p.id, "new-id");
        assert_eq!(p.prayer_type, "troparion");
        assert_eq!(p.description.as_deref(), Some("Kurz"));
        assert_eq!(p.book.as_deref(), Some("horologion"));
        assert_eq!(p.occasion.as_deref(), Some("Pascha"));
        assert_eq!(p.tone, Some(Some(4)));
        // empty text removes optional keys
        set_description(&mut p, "");
        set_book(&mut p, "");
        set_occasion(&mut p, "");
        assert_eq!(
            (&p.description, &p.book, &p.occasion),
            (&None, &None, &None)
        );
        // clearing the tone writes null; an absent tone stays absent
        set_tone(&mut p, None);
        assert_eq!(p.tone, Some(None));
        let mut q = prayer();
        set_tone(&mut q, None);
        assert_eq!(q.tone, None);
        valid(&p);
    }

    #[test]
    fn custom_fields() {
        let mut p = prayer();
        assert_eq!(add_custom_field(&mut p), "field_1");
        assert_eq!(add_custom_field(&mut p), "field_2");
        set_custom_field(&mut p, "field_1", "Значение");
        assert_eq!(
            p.meta.as_ref().unwrap().custom.as_ref().unwrap()["field_1"],
            "Значение"
        );
        assert!(rename_custom_field(&mut p, "field_1", " editor "));
        let custom = p.meta.as_ref().unwrap().custom.as_ref().unwrap();
        assert_eq!(custom["editor"], "Значение");
        assert!(!custom.contains_key("field_1"));
        assert!(
            !rename_custom_field(&mut p, "editor", "field_2"),
            "name taken"
        );
        assert!(!rename_custom_field(&mut p, "editor", "  "));
        assert!(!rename_custom_field(&mut p, "nope", "x"));
        valid(&p);
        // a blank value removes the field; the last removal drops meta
        set_custom_field(&mut p, "editor", "   ");
        assert!(remove_custom_field(&mut p, "field_2"));
        assert_eq!(p.meta, None);
        assert!(!remove_custom_field(&mut p, "field_2"));
        valid(&p);
    }

    #[test]
    fn custom_field_keeps_non_string_values_until_edited() {
        let mut p = prayer();
        let mut custom = serde_json::Map::new();
        custom.insert("n".into(), json!(3));
        p.meta = Some(Meta {
            custom: Some(custom),
        });
        assert!(rename_custom_field(&mut p, "n", "m"));
        assert_eq!(
            p.meta.as_ref().unwrap().custom.as_ref().unwrap()["m"],
            json!(3)
        );
    }

    // -- variants ---------------------------------------------------------

    #[test]
    fn add_variant_defaults_and_unique_names() {
        let mut p = prayer();
        let v = add_variant(&mut p);
        assert_eq!(v, VariantRef::new("en", "draft-3"));
        assert_eq!(p.variants[2].title, "Titel");
        assert_eq!(p.variants[2].license, "unknown");
        assert_eq!(p.variants[2].source, "draft");
        // a taken name is skipped
        p.variants.pop();
        p.variants[1].lang = "en".into();
        p.variants[1].variant = "draft-3".into();
        assert_eq!(add_variant(&mut p), VariantRef::new("en", "draft-4"));
        valid(&p);
        let mut empty = prayer();
        empty.variants.clear();
        add_variant(&mut empty);
        assert_eq!(empty.variants[0].title, "Untitled");
    }

    #[test]
    fn remove_variant_keeps_the_last_one_and_the_translations() {
        let mut p = prayer();
        let removed = remove_variant(&mut p, 1).unwrap();
        assert_eq!(removed.lang, "ru");
        assert_eq!(p.variants.len(), 1);
        assert!(
            p.structure[1].translation(RU).is_some(),
            "text stays (Electron)"
        );
        assert!(remove_variant(&mut p, 0).is_none(), "last Variant stays");
        assert!(remove_variant(&mut p, 7).is_none());
    }

    #[test]
    fn update_variant_meta_edits_fields() {
        let mut p = prayer();
        let patch = VariantMetaPatch {
            title: Some("Neu".into()),
            license: Some("MIT".into()),
            source: Some("Buch".into()),
            ..Default::default()
        };
        assert_eq!(update_variant_meta(&mut p, 0, &patch), None, "no rename");
        assert_eq!(p.variants[0].title, "Neu");
        assert_eq!(p.variants[0].license, "MIT");
        assert_eq!(p.variants[0].source, "Buch");
        assert!(update_variant_meta(&mut p, 5, &patch).is_none());
    }

    #[test]
    fn renaming_a_variant_moves_its_translations() {
        let mut p = prayer();
        let renamed = update_variant_meta(
            &mut p,
            1,
            &VariantMetaPatch {
                lang: Some("cu".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(renamed.from, VariantRef::new("ru", "cs"));
        assert_eq!(renamed.to, VariantRef::new("cu", "cs"));
        let cu = VariantKey {
            lang: "cu",
            variant: "cs",
        };
        assert_eq!(content(&p, "a", cu), text("Слава Отцу"));
        assert!(p.structure[1].translation(RU).is_none());
        valid(&p);
    }

    #[test]
    fn renaming_onto_an_existing_variant_leaves_translations_alone() {
        let mut p = prayer();
        let renamed = update_variant_meta(
            &mut p,
            1,
            &VariantMetaPatch {
                lang: Some("de".into()),
                variant: Some("standard".into()),
                ..Default::default()
            },
        );
        assert!(renamed.is_some());
        // two Variants share the key now (validation reports it); text not merged
        assert_eq!(content(&p, "a", RU), text("Слава Отцу"));
        assert_eq!(content(&p, "a", DE), text("Hallo Welt"));
    }

    #[test]
    fn reconcile_visible_variants_falls_back() {
        let p = prayer();
        let de = VariantRef::new("de", "standard");
        let ru = VariantRef::new("ru", "cs");
        let gone = VariantRef::new("fr", "x");
        assert_eq!(
            reconcile_visible_variants(&[de.clone(), gone.clone(), ru.clone()], &p.variants, None),
            vec![de.clone(), ru.clone()]
        );
        assert_eq!(
            reconcile_visible_variants(std::slice::from_ref(&gone), &p.variants, Some(&ru)),
            vec![ru.clone()]
        );
        assert_eq!(
            reconcile_visible_variants(std::slice::from_ref(&gone), &p.variants, Some(&gone)),
            vec![de.clone()]
        );
        assert_eq!(
            reconcile_visible_variants(&[], &p.variants, None),
            vec![de.clone()]
        );
        assert!(reconcile_visible_variants(&[de], &[], None).is_empty());
        assert_eq!(pick_default_variant(&p, Some(&ru)), vec![ru]);
        assert_eq!(pick_default_variant(&p, Some(&gone)).len(), 1);
        assert_eq!(pick_default_variant(&p, None)[0].lang, "de");
    }

    // -- kinds and fill ---------------------------------------------------

    #[test]
    fn kind_ordering_and_options() {
        assert_eq!(
            order_kinds(["zeta", "verse", "alpha", "heading", "verse"]),
            vec!["heading", "verse", "alpha", "zeta"]
        );
        let p = prayer();
        assert_eq!(
            kind_options(&p, &["rubric"]),
            vec!["heading", "subheading", "annotation", "verse", "rubric"]
        );
    }

    #[test]
    fn kind_rename_issues_match_electron() {
        let existing = ["rubric", "other"];
        assert_eq!(
            kind_rename_issue("rubric", "  ", existing),
            Some("Required")
        );
        assert_eq!(kind_rename_issue("rubric", "rubric", existing), None);
        assert_eq!(
            kind_rename_issue("verse", "psalm", existing),
            Some("Built-in kinds cannot be renamed")
        );
        assert_eq!(
            kind_rename_issue("rubric", "1x", existing),
            Some("Use a letter, then letters, digits, _ or -")
        );
        assert_eq!(
            kind_rename_issue("rubric", "verse", existing),
            Some("That name is reserved")
        );
        assert_eq!(
            kind_rename_issue("rubric", "other", existing),
            Some("Already exists")
        );
        assert_eq!(kind_rename_issue("rubric", "psalm", existing), None);
    }

    #[test]
    fn fill_state() {
        let p = prayer();
        assert!(is_translation_filled(&p, "a", DE));
        assert!(!is_translation_filled(&p, "v", RU));
        assert!(!is_translation_filled(&p, "nope", DE));
        assert_eq!(
            fill(&p, DE),
            Fill {
                filled: 3,
                total: 3
            }
        );
        assert_eq!(
            fill(&p, RU),
            Fill {
                filled: 2,
                total: 3
            }
        );
        assert_eq!(fill(&p, RU).percent(), 67);
        assert_eq!(
            Fill {
                filled: 0,
                total: 0
            }
            .percent(),
            100
        );
        assert!(!is_block_empty_across_variants(&p, "v", None));
        assert!(is_block_empty_across_variants(&p, "v", Some(DE)));
        assert!(is_block_empty_across_variants(&p, "nope", None));
        let mut q = p.clone();
        let id = insert_block_after(&mut q, 2).unwrap();
        assert!(is_block_empty_across_variants(&q, &id, None));
    }

    // -- outline ----------------------------------------------------------

    #[test]
    fn outline_nests_subheadings_under_headings() {
        let mut p = prayer();
        p.structure.clear();
        for (id, kind, label) in [
            ("s0", "subheading", "Vorspann"),
            ("h1", "heading", "Erster"),
            ("x", "annotation", "Text"),
            ("s1", "subheading", "  Unter  "),
            ("s2", "subheading", ""),
            ("h2", "heading", "Zweiter"),
        ] {
            insert_block_with_id(&mut p, usize::MAX, kind, id).unwrap();
            set_block_content(&mut p, id, DE, &text(label));
        }
        let outline = build_outline(&p, DE);
        let shape: Vec<_> = outline
            .iter()
            .map(|e| (e.block_id.as_str(), e.label.as_str(), e.children.len()))
            .collect();
        assert_eq!(
            shape,
            vec![
                ("s0", "Vorspann", 0),
                ("h1", "Erster", 2),
                ("h2", "Zweiter", 0)
            ]
        );
        assert_eq!(outline[1].children[0].label, "Unter");
        assert_eq!(outline[1].children[1].label, "", "Untitled");
        // a Variant without text gives empty labels
        assert_eq!(build_outline(&p, RU)[1].label, "");

        let flat = flatten_outline(&outline);
        let ids: Vec<_> = flat.iter().map(|f| f.0.as_str()).collect();
        assert_eq!(ids, ["s0", "h1", "s1", "s2", "h2"]);
        assert!(flat[0].2, "root subheading is an orphan");
        assert!(!flat[2].2);
    }

    #[test]
    fn scrollspy_picks_last_heading_above_the_line() {
        let anchor = |id: &str, kind, top, orphan| OutlineAnchor {
            block_id: id.into(),
            kind,
            top,
            orphan,
        };
        let anchors = vec![
            anchor("o", OutlineKind::Subheading, 0.0, true),
            anchor("h1", OutlineKind::Heading, 100.0, false),
            anchor("s", OutlineKind::Subheading, 150.0, false),
            anchor("h2", OutlineKind::Heading, 300.0, false),
        ];
        assert_eq!(active_outline_id(&anchors, 0.0, 10.0), Some("o"));
        assert_eq!(active_outline_id(&anchors, 90.0, 10.0), Some("h1"));
        assert_eq!(
            active_outline_id(&anchors, 140.0, 10.0),
            Some("h1"),
            "nested never wins"
        );
        assert_eq!(
            active_outline_id(&anchors, 299.0, 0.0),
            Some("h2"),
            "1px slack"
        );
        assert_eq!(active_outline_id(&[], 0.0, 0.0), None);
    }

    // -- find and replace -------------------------------------------------

    const ANY: FindOptions = FindOptions {
        match_case: false,
        whole_word: false,
    };

    fn vis() -> Vec<VariantRef> {
        vec![
            VariantRef::new("de", "standard"),
            VariantRef::new("ru", "cs"),
        ]
    }

    #[test]
    fn find_across_blocks_and_variants() {
        let mut p = prayer();
        set_block_content(&mut p, "h", DE, &text("Welt der Welt"));
        let hits = find_matches(&p, &vis(), "welt", ANY);
        let found: Vec<_> = hits
            .iter()
            .map(|m| {
                (
                    m.block_id.as_str(),
                    m.variant.lang.as_str(),
                    m.range.clone(),
                )
            })
            .collect();
        assert_eq!(
            found,
            vec![("h", "de", 0..4), ("h", "de", 9..13), ("a", "de", 6..10)]
        );
        assert!(find_matches(&p, &vis(), "", ANY).is_empty());
        assert!(find_matches(&p, &[VariantRef::new("fr", "x")], "welt", ANY).is_empty());
        // only visible Variants are searched
        assert!(find_matches(&p, &vis()[1..], "welt", ANY).is_empty());
    }

    #[test]
    fn find_options_case_and_whole_word() {
        let mut p = prayer();
        set_block_content(&mut p, "a", DE, &text("Gott Gottes gott's Gott"));
        let n = |o| find_matches(&p, &vis()[..1], "gott", o).len();
        assert_eq!(n(ANY), 4);
        assert_eq!(
            n(FindOptions {
                match_case: true,
                whole_word: false
            }),
            1,
            "only gott's"
        );
        // "gott's": the apostrophe is a word char, so it is not a whole word
        assert_eq!(
            n(FindOptions {
                match_case: false,
                whole_word: true
            }),
            2
        );
        assert_eq!(
            find_matches(
                &p,
                &vis()[..1],
                "Gott",
                FindOptions {
                    match_case: true,
                    whole_word: true
                }
            )
            .len(),
            2
        );
    }

    #[test]
    fn find_cyrillic_and_greek_with_byte_ranges() {
        let mut p = prayer();
        set_block_content(&mut p, "a", RU, &text("Господи, помилуй. ГОСПОДИ!"));
        let hits = find_matches(&p, &vis()[1..], "господи", ANY);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].range, 0..14);
        let plain = "Господи, помилуй. ГОСПОДИ!";
        assert_eq!(&plain[hits[1].range.clone()], "ГОСПОДИ");
        let cs = find_matches(
            &p,
            &vis()[1..],
            "господи",
            FindOptions {
                match_case: true,
                whole_word: false,
            },
        );
        assert_eq!(cs.len(), 0);
        let cs = find_matches(
            &p,
            &vis()[1..],
            "Господи",
            FindOptions {
                match_case: true,
                whole_word: false,
            },
        );
        assert_eq!(cs.len(), 1);
        // whole word with punctuation next to the word
        let ww = find_matches(
            &p,
            &vis()[1..],
            "господи",
            FindOptions {
                match_case: false,
                whole_word: true,
            },
        );
        assert_eq!(ww.len(), 2);

        let el = [VariantRef::new("el", "standard")];
        set_block_content(&mut p, "a", EL, &text("ΟΔΥΣΣΕΥΣ και οδυσσευς"));
        assert_eq!(
            find_matches(&p, &el, "οδυσσευς", ANY).len(),
            2,
            "final sigma folds"
        );
    }

    #[test]
    fn find_in_verse_lines_uses_joined_offsets() {
        let p = prayer();
        let hits = find_matches(&p, &vis()[..1], "zweite", ANY);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].range, 6..12);
        assert!(hits[0].line_mode);
    }

    #[test]
    fn find_does_not_overlap_and_ignores_notes_in_the_text() {
        let mut p = prayer();
        set_block_content(&mut p, "a", DE, &text("aaaa"));
        assert_eq!(find_matches(&p, &vis()[..1], "aa", ANY).len(), 2);
        set_block_content(
            &mut p,
            "a",
            DE,
            &EditorContent::Text(InlineContent::Runs(vec![
                TextRun::text("Herr "),
                TextRun::note("(laut)"),
            ])),
        );
        assert_eq!(find_matches(&p, &vis()[..1], "herr (laut)", ANY).len(), 1);
    }

    #[test]
    fn replace_one_match_keeps_the_rest() {
        let mut p = prayer();
        let hits = find_matches(&p, &vis(), "Welt", ANY);
        assert_eq!(hits.len(), 1);
        assert!(replace_match(&mut p, &hits[0], "Erde"));
        assert_eq!(content(&p, "a", DE), text("Hallo Erde"));
        assert_eq!(content(&p, "a", RU), text("Слава Отцу"));
    }

    #[test]
    fn replace_with_different_byte_length_in_cyrillic() {
        let mut p = prayer();
        let hits = find_matches(&p, &vis()[1..], "отцу", ANY);
        assert!(replace_match(&mut p, &hits[0], "Сыну и Духу"));
        assert_eq!(content(&p, "a", RU), text("Слава Сыну и Духу"));
    }

    #[test]
    fn replace_keeps_notes_around_the_match() {
        let mut p = prayer();
        let runs = InlineContent::Runs(vec![
            TextRun::text("Herr "),
            TextRun::note("(laut)"),
            TextRun::text(" erbarme"),
        ]);
        set_block_content(&mut p, "a", DE, &EditorContent::Text(runs));
        let hits = find_matches(&p, &vis()[..1], "erbarme", ANY);
        replace_match(&mut p, &hits[0], "hilf");
        assert_eq!(
            content(&p, "a", DE),
            EditorContent::Text(InlineContent::Runs(vec![
                TextRun::text("Herr "),
                TextRun::note("(laut)"),
                TextRun::text(" hilf"),
            ]))
        );
        valid(&p);
    }

    #[test]
    fn replace_to_empty_removes_the_translation() {
        let mut p = prayer();
        let hits = find_matches(&p, &vis()[..1], "Hallo Welt", ANY);
        assert!(replace_match(&mut p, &hits[0], ""));
        assert!(p.structure[1].translation(DE).is_none());
        valid(&p);
    }

    #[test]
    fn replace_in_verse_lines() {
        let mut p = prayer();
        let hits = find_matches(&p, &vis()[..1], "Zweite", ANY);
        replace_match(&mut p, &hits[0], "Dritte");
        assert_eq!(content(&p, "v", DE), lines(&["Erste", "Dritte"]));
        // emptying a line removes it
        let hits = find_matches(&p, &vis()[..1], "Dritte", ANY);
        replace_match(&mut p, &hits[0], "");
        assert_eq!(content(&p, "v", DE), lines(&["Erste"]));
        // a match across lines rebuilds the lines from plain text
        let mut p = prayer();
        let hits = find_matches(&p, &vis()[..1], "e\nZ", ANY);
        assert_eq!(hits.len(), 1);
        replace_match(&mut p, &hits[0], "-");
        assert_eq!(content(&p, "v", DE), lines(&["Erst-weite"]));
        valid(&p);
    }

    #[test]
    fn replace_all_works_back_to_front() {
        let mut p = prayer();
        set_block_content(&mut p, "h", DE, &text("Welt Welt"));
        set_block_content(&mut p, "v", DE, &lines(&["Welt eins", "zwei Welt"]));
        let hits = find_matches(&p, &vis(), "welt", ANY);
        assert_eq!(hits.len(), 5);
        assert_eq!(summarize_replace_all(&hits), (5, 3));
        let n = replace_all(&mut p, &hits, "Erde und Himmel");
        assert_eq!(n, 5);
        assert_eq!(
            content(&p, "h", DE),
            text("Erde und Himmel Erde und Himmel")
        );
        assert_eq!(content(&p, "a", DE), text("Hallo Erde und Himmel"));
        assert_eq!(
            content(&p, "v", DE),
            lines(&["Erde und Himmel eins", "zwei Erde und Himmel"])
        );
        valid(&p);
        assert!(find_matches(&p, &vis(), "welt", ANY).is_empty());
    }

    #[test]
    fn replace_all_across_variants_in_one_block() {
        let mut p = prayer();
        set_block_content(&mut p, "a", DE, &text("Amen Amen"));
        set_block_content(&mut p, "a", RU, &text("Аминь Аминь"));
        let mut hits = find_matches(&p, &vis(), "амен", ANY);
        hits.extend(find_matches(&p, &vis(), "аминь", ANY));
        replace_all(&mut p, &hits, "x");
        assert_eq!(
            content(&p, "a", DE),
            text("Amen Amen"),
            "other text untouched"
        );
        assert_eq!(content(&p, "a", RU), text("x x"));
    }

    #[test]
    fn replace_match_for_a_missing_block_does_nothing() {
        let mut p = prayer();
        let m = FindMatch {
            block_id: "nope".into(),
            variant: VariantRef::new("de", "standard"),
            range: 0..1,
            line_mode: false,
        };
        assert!(!replace_match(&mut p, &m, "x"));
        assert_eq!(replace_all(&mut p, &[m], "x"), 0);
    }
}
