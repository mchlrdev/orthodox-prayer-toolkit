//! The Session draft: the in-memory working copy of one prayer.
//!
//! A draft holds the current [`Prayer`], the last saved or loaded baseline
//! (dirty means "differs from the baseline", so undoing back to the saved
//! state is clean again), one undo [`History`] of Prayer snapshots, live
//! validation errors and how the file on disk relates to it. It does no I/O:
//! the app layer reads and writes files and tells the draft what happened.
//!
//! The history survives saving and switching prayers (the app keeps the draft
//! around) and ends when the app closes.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use prayer_core::model::{Prayer, ValidationError};
use prayer_core::validate::validate;

use crate::history::{EditKind, History};

/// New content of a prayer file after an outside change.
#[derive(Clone, Debug, PartialEq)]
pub enum DiskContent {
    /// The file reads as a valid prayer.
    Valid(Box<Prayer>),
    /// The file no longer is a valid prayer (not JSON, schema errors...).
    Invalid(Vec<ValidationError>),
}

/// How the file on disk relates to the draft.
#[derive(Clone, Debug, PartialEq)]
pub enum DiskState {
    /// The file is what the draft last loaded or saved.
    InSync,
    /// The file changed outside while the draft has unsaved changes (or the
    /// new content cannot be loaded). Offer Reload (undoable) or Keep mine
    /// (the next save overwrites).
    ChangedOnDisk(DiskContent),
    /// The file was deleted or renamed. The draft stays open; saving
    /// recreates the file.
    DeletedOnDisk,
}

/// What the app should do after telling the draft about an outside change.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiskReaction {
    /// Nothing to do: the file holds what the draft already has.
    Unchanged,
    /// The draft had no unsaved changes and took the new content (an
    /// undoable step).
    ReloadedSilently,
    /// The draft is in [`DiskState::ChangedOnDisk`] or
    /// [`DiskState::DeletedOnDisk`]; the user decides.
    NeedsDecision,
    /// The file is gone and the draft had no unsaved changes: the app may
    /// close it. The draft is marked [`DiskState::DeletedOnDisk`].
    CleanDeleted,
}

/// In-memory working copy of one prayer.
#[derive(Debug)]
pub struct SessionDraft {
    prayer: Prayer,
    baseline: Prayer,
    /// The baseline does not match what is on disk (new, or file deleted or
    /// overwritten by "Keep mine"), so the draft counts as dirty until saved.
    baseline_stale: bool,
    path: PathBuf,
    history: History<Prayer>,
    disk: DiskState,
    errors: OnceLock<Vec<ValidationError>>,
    dirty: OnceLock<bool>,
}

impl SessionDraft {
    /// A draft of a prayer just loaded from `path`: clean.
    pub fn new(path: impl Into<PathBuf>, prayer: Prayer) -> Self {
        Self {
            baseline: prayer.clone(),
            prayer,
            baseline_stale: false,
            path: path.into(),
            history: History::new(),
            disk: DiskState::InSync,
            errors: OnceLock::new(),
            dirty: OnceLock::new(),
        }
    }

    /// A draft of a prayer that is not on disk yet (`path` is where it will
    /// be saved): dirty until the first save.
    pub fn new_unsaved(path: impl Into<PathBuf>, prayer: Prayer) -> Self {
        Self {
            baseline_stale: true,
            ..Self::new(path, prayer)
        }
    }

    pub fn prayer(&self) -> &Prayer {
        &self.prayer
    }

    /// The prayer as last loaded or saved.
    pub fn baseline(&self) -> &Prayer {
        &self.baseline
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn disk_state(&self) -> &DiskState {
        &self.disk
    }

    /// Unsaved changes: the prayer differs from the baseline, or the file on
    /// disk is not the baseline any more (deleted, overwritten by Keep mine,
    /// never saved).
    pub fn is_dirty(&self) -> bool {
        *self
            .dirty
            .get_or_init(|| self.baseline_stale || self.prayer != self.baseline)
    }

    /// Validation errors of the current prayer, empty when it is valid.
    /// Computed on first use after an edit and cached.
    pub fn errors(&self) -> &[ValidationError] {
        self.errors
            .get_or_init(|| match serde_json::to_value(&self.prayer) {
                Ok(value) => validate(&value).err().unwrap_or_default(),
                Err(e) => vec![ValidationError {
                    path: "/".into(),
                    message: format!("Cannot serialize prayer: {e}"),
                }],
            })
    }

    pub fn is_valid(&self) -> bool {
        self.errors().is_empty()
    }

    fn invalidate(&mut self) {
        self.errors = OnceLock::new();
        self.dirty = OnceLock::new();
    }

    // -- editing ----------------------------------------------------------

    /// Applies an edit to the prayer and records it in the history. An edit
    /// that changes nothing is not recorded. Returns what `f` returns.
    pub fn edit<R>(&mut self, kind: EditKind, f: impl FnOnce(&mut Prayer) -> R) -> R {
        self.edit_with(kind, None, f)
    }

    /// [`edit`](Self::edit) with a label for the undo step ("Split block").
    pub fn edit_labeled<R>(
        &mut self,
        kind: EditKind,
        label: &'static str,
        f: impl FnOnce(&mut Prayer) -> R,
    ) -> R {
        self.edit_with(kind, Some(label), f)
    }

    fn edit_with<R>(
        &mut self,
        kind: EditKind,
        label: Option<&'static str>,
        f: impl FnOnce(&mut Prayer) -> R,
    ) -> R {
        let before = self.prayer.clone();
        let result = f(&mut self.prayer);
        if self.prayer != before {
            match label {
                Some(label) => self.history.record_labeled(before, kind, label),
                None => self.history.record(before, kind),
            }
            self.invalidate();
        }
        result
    }

    /// Ends a typing/deleting run so the next edit is its own undo step
    /// (after the caret moved, or focus went elsewhere).
    pub fn break_coalescing(&mut self) {
        self.history.break_coalescing();
    }

    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }

    pub fn undo_label(&self) -> Option<&'static str> {
        self.history.undo_label()
    }

    pub fn redo_label(&self) -> Option<&'static str> {
        self.history.redo_label()
    }

    /// Takes back the last edit. Returns whether there was one.
    pub fn undo(&mut self) -> bool {
        match self.history.undo(self.prayer.clone()) {
            Some(previous) => {
                self.prayer = previous;
                self.invalidate();
                true
            }
            None => false,
        }
    }

    /// Re-applies the last undone edit. Returns whether there was one.
    pub fn redo(&mut self) -> bool {
        match self.history.redo(self.prayer.clone()) {
            Some(next) => {
                self.prayer = next;
                self.invalidate();
                true
            }
            None => false,
        }
    }

    // -- saving -----------------------------------------------------------

    /// The current prayer was written to `path` (which may differ from the
    /// old path when the id, hence the file name, changed): it is the new
    /// baseline. Resolves any disk conflict, since the save overwrote it.
    pub fn mark_saved(&mut self, path: impl Into<PathBuf>) {
        let saved = self.prayer.clone();
        self.mark_saved_snapshot(path, saved);
    }

    /// Like [`mark_saved`](Self::mark_saved) for a save that wrote `saved`,
    /// a snapshot taken before the user kept typing: the draft stays dirty if
    /// it moved on since.
    pub fn mark_saved_snapshot(&mut self, path: impl Into<PathBuf>, saved: Prayer) {
        self.path = path.into();
        self.baseline = saved;
        self.baseline_stale = false;
        self.disk = DiskState::InSync;
        self.history.break_coalescing();
        self.dirty = OnceLock::new();
    }

    // -- the file changed outside ----------------------------------------

    /// Whether a change on disk may be taken without asking: the draft has
    /// no unsaved changes.
    pub fn can_silently_reload(&self) -> bool {
        !self.is_dirty()
    }

    /// Replaces the prayer with `prayer` read from disk, which becomes the
    /// baseline. The previous content stays one undo step away (so
    /// "Reload" can be undone); an unchanged prayer records nothing.
    pub fn reload_from_disk(&mut self, prayer: Prayer) {
        if self.prayer != prayer {
            let before = std::mem::replace(&mut self.prayer, prayer.clone());
            self.history
                .record_labeled(before, EditKind::Other, "Reload from disk");
        }
        self.baseline = prayer;
        self.baseline_stale = false;
        self.disk = DiskState::InSync;
        self.invalidate();
    }

    /// Reloads the content waiting in [`DiskState::ChangedOnDisk`]. Returns
    /// `false` when nothing valid is waiting.
    pub fn reload_pending(&mut self) -> bool {
        match &self.disk {
            DiskState::ChangedOnDisk(DiskContent::Valid(prayer)) => {
                let prayer = (**prayer).clone();
                self.reload_from_disk(prayer);
                true
            }
            _ => false,
        }
    }

    /// "Keep mine": the user declines the outside change. The draft counts as
    /// dirty (against what is on disk now) so that saving overwrites it.
    pub fn keep_mine(&mut self) {
        match std::mem::replace(&mut self.disk, DiskState::InSync) {
            DiskState::InSync => {}
            DiskState::ChangedOnDisk(DiskContent::Valid(on_disk)) => {
                self.baseline = *on_disk;
                self.baseline_stale = false;
            }
            DiskState::ChangedOnDisk(DiskContent::Invalid(_)) | DiskState::DeletedOnDisk => {
                self.baseline_stale = true;
            }
        }
        self.dirty = OnceLock::new();
    }

    /// The file changed outside; `content` is what it holds now.
    ///
    /// Content equal to the baseline (for example the draft's own save coming
    /// back from the watcher) changes nothing. A draft without unsaved
    /// changes takes valid content at once; otherwise the draft enters
    /// [`DiskState::ChangedOnDisk`].
    pub fn disk_changed(&mut self, content: DiskContent) -> DiskReaction {
        if let DiskContent::Valid(prayer) = &content {
            if **prayer == self.baseline {
                self.baseline_stale = false;
                self.disk = DiskState::InSync;
                self.dirty = OnceLock::new();
                return DiskReaction::Unchanged;
            }
            if self.can_silently_reload() {
                self.reload_from_disk((**prayer).clone());
                return DiskReaction::ReloadedSilently;
            }
        }
        self.disk = DiskState::ChangedOnDisk(content);
        DiskReaction::NeedsDecision
    }

    /// The file was deleted or renamed. The draft stays open as
    /// [`DiskState::DeletedOnDisk`] and counts as dirty (saving recreates
    /// the file). When it had no unsaved changes the app may close it.
    pub fn disk_deleted(&mut self) -> DiskReaction {
        let was_clean = !self.is_dirty();
        self.disk = DiskState::DeletedOnDisk;
        self.baseline_stale = true;
        self.dirty = OnceLock::new();
        if was_clean {
            DiskReaction::CleanDeleted
        } else {
            DiskReaction::NeedsDecision
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit::{self, EditorContent, FindOptions, VariantRef};
    use prayer_core::model::{InlineContent, TextRun, VariantKey};
    use serde_json::json;

    const DE: VariantKey<'static> = VariantKey {
        lang: "de",
        variant: "standard",
    };
    const RU: VariantKey<'static> = VariantKey {
        lang: "ru",
        variant: "cs",
    };

    fn prayer() -> Prayer {
        serde_json::from_value(json!({
            "id": "gebet",
            "type": "prayer",
            "variants": [
                {"lang": "de", "variant": "standard", "title": "Gebet", "license": "CC0", "source": "x"},
                {"lang": "ru", "variant": "cs", "title": "Молитва", "license": "CC0", "source": "y"}
            ],
            "structure": [
                {"id": "a", "kind": "annotation", "translations": [
                    {"lang": "de", "variant": "standard", "text": "Herr erbarme dich"},
                    {"lang": "ru", "variant": "cs", "text": "Господи, помилуй"}
                ]},
                {"id": "v", "kind": "verse", "translations": [
                    {"lang": "de", "variant": "standard", "lines": ["Erste", "Zweite"]}
                ]}
            ]
        }))
        .unwrap()
    }

    fn draft() -> SessionDraft {
        SessionDraft::new("/lib/gebet.json", prayer())
    }

    fn text(s: &str) -> EditorContent {
        EditorContent::Text(s.into())
    }

    fn type_text(d: &mut SessionDraft, s: &str) {
        d.edit(EditKind::Typing, |p| {
            edit::set_block_content(p, "a", DE, &text(s));
        });
    }

    fn de_text(d: &SessionDraft) -> String {
        edit::block_editor_content(d.prayer(), "a", DE)
            .unwrap()
            .plain_text()
    }

    #[test]
    fn fresh_draft_is_clean_valid_and_in_sync() {
        let d = draft();
        assert!(!d.is_dirty());
        assert!(d.is_valid());
        assert!(d.errors().is_empty());
        assert_eq!(d.disk_state(), &DiskState::InSync);
        assert_eq!(d.path(), Path::new("/lib/gebet.json"));
        assert!(!d.can_undo() && !d.can_redo());
        assert_eq!(d.baseline(), d.prayer());
    }

    #[test]
    fn edit_makes_dirty_and_undo_back_to_baseline_is_clean_again() {
        let mut d = draft();
        type_text(&mut d, "Herr, erbarme dich");
        assert!(d.is_dirty());
        assert!(d.can_undo());
        assert!(d.undo());
        assert!(!d.is_dirty(), "undo to the saved state is clean");
        assert!(d.redo());
        assert!(d.is_dirty());
        assert_eq!(de_text(&d), "Herr, erbarme dich");
        assert!(!d.redo());
    }

    #[test]
    fn editing_back_by_hand_is_clean_too() {
        let mut d = draft();
        type_text(&mut d, "x");
        d.break_coalescing();
        type_text(&mut d, "Herr erbarme dich");
        assert!(!d.is_dirty());
        assert_eq!(d.undo_label(), None);
    }

    #[test]
    fn edit_returns_the_closure_result_and_skips_no_ops() {
        let mut d = draft();
        let changed = d.edit(EditKind::Other, |p| {
            edit::set_block_content(p, "a", DE, &text("Herr erbarme dich"))
        });
        assert!(!changed);
        assert!(!d.can_undo(), "unchanged edits are not recorded");
        let new_id = d.edit_labeled(EditKind::Other, "Insert block", |p| {
            edit::insert_block_after(p, 0)
        });
        assert!(new_id.is_some());
        assert_eq!(d.undo_label(), Some("Insert block"));
    }

    #[test]
    fn typing_coalesces_into_one_undo_step() {
        let mut d = draft();
        for s in [
            "Herr erbarme dich ",
            "Herr erbarme dich u",
            "Herr erbarme dich uns",
        ] {
            type_text(&mut d, s);
        }
        assert_eq!(de_text(&d), "Herr erbarme dich uns");
        assert!(d.undo());
        assert_eq!(de_text(&d), "Herr erbarme dich");
        assert!(!d.can_undo());
    }

    #[test]
    fn undo_round_trip_across_structural_edits_multi_variant() {
        let mut d = draft();
        let original = d.prayer().clone();
        // split (Cyrillic, byte offset after "Господи")
        let at = "Господи".len();
        d.edit_labeled(EditKind::Other, "Split block", |p| {
            edit::split_block_with_id(p, 0, RU, at..at, "n1")
        });
        assert_eq!(d.prayer().structure.len(), 3);
        // merge it back
        d.edit(EditKind::Other, |p| edit::merge_block_into_previous(p, 1));
        assert_eq!(d.prayer().structure.len(), 2);
        // kind change on the verse, then replace, then a variant
        d.edit(EditKind::Other, |p| {
            edit::set_block_kind(p, 1, "annotation")
        });
        let hits = edit::find_matches(
            d.prayer(),
            &[VariantRef::new("de", "standard")],
            "zweite",
            FindOptions::default(),
        );
        d.edit(EditKind::Other, |p| edit::replace_all(p, &hits, "Dritte"));
        d.edit(EditKind::Other, edit::add_variant);
        d.edit(EditKind::Other, |p| edit::set_tone(p, Some(2)));
        assert!(d.is_dirty());
        assert!(d.is_valid(), "{:?}", d.errors());

        let after = d.prayer().clone();
        let mut steps = 0;
        while d.undo() {
            steps += 1;
        }
        assert_eq!(steps, 6);
        assert_eq!(d.prayer(), &original);
        assert!(!d.is_dirty());
        while d.redo() {}
        assert_eq!(d.prayer(), &after);
    }

    #[test]
    fn verse_notes_and_cyrillic_survive_undo_redo() {
        let mut d = draft();
        d.edit(EditKind::Other, |p| {
            edit::toggle_note(p, "v", DE, 3..9);
            edit::toggle_note(p, "a", RU, 0.."Господи".len());
        });
        let marked = d.prayer().clone();
        assert!(matches!(
            edit::block_editor_content(&marked, "a", RU),
            Some(EditorContent::Text(InlineContent::Runs(_)))
        ));
        assert!(d.undo());
        assert_eq!(d.prayer(), &prayer());
        assert!(d.redo());
        assert_eq!(d.prayer(), &marked);
        assert!(d.is_valid());
        // the Runs are what a save would write
        let value = serde_json::to_value(d.prayer()).unwrap();
        assert_eq!(
            value["structure"][0]["translations"][1]["text"][0],
            json!({"t": "note", "v": "Господи"})
        );
    }

    #[test]
    fn new_edit_after_undo_drops_redo() {
        let mut d = draft();
        d.edit(EditKind::Other, |p| edit::set_type(p, "troparion"));
        d.undo();
        d.edit(EditKind::Other, |p| edit::set_type(p, "kontakion"));
        assert!(!d.can_redo());
        assert_eq!(d.prayer().prayer_type, "kontakion");
    }

    #[test]
    fn errors_are_live_and_cached() {
        let mut d = draft();
        assert!(d.errors().is_empty());
        d.edit(EditKind::Typing, |p| p.id = String::new());
        assert!(!d.is_valid());
        let first = d.errors().as_ptr();
        assert_eq!(d.errors().as_ptr(), first, "cached until the next edit");
        assert!(
            d.errors().iter().any(|e| e.path == "/id"),
            "{:?}",
            d.errors()
        );
        d.undo();
        assert!(d.is_valid(), "errors follow undo");
        // duplicate Variant: a semantic error appears and goes
        d.edit(EditKind::Other, |p| {
            let dup = p.variants[0].clone();
            p.variants.push(dup);
        });
        assert!(
            d.errors()
                .iter()
                .any(|e| e.message.starts_with("Duplicate variant"))
        );
    }

    #[test]
    fn mark_saved_makes_clean_and_keeps_undo() {
        let mut d = draft();
        type_text(&mut d, "Neu");
        d.mark_saved("/lib/gebet.json");
        assert!(!d.is_dirty());
        assert_eq!(d.baseline(), d.prayer());
        assert!(d.can_undo(), "undo survives saving");
        assert!(d.undo());
        assert!(d.is_dirty(), "undoing past the save is a change again");
        assert!(d.redo());
        assert!(!d.is_dirty());
    }

    #[test]
    fn mark_saved_with_a_new_path_after_an_id_change() {
        let mut d = draft();
        d.edit(EditKind::Other, |p| edit::set_id(p, "neu"));
        d.mark_saved("/lib/neu.json");
        assert_eq!(d.path(), Path::new("/lib/neu.json"));
        assert!(!d.is_dirty());
    }

    #[test]
    fn mark_saved_snapshot_stays_dirty_when_the_user_kept_typing() {
        let mut d = draft();
        type_text(&mut d, "A");
        let snapshot = d.prayer().clone();
        d.break_coalescing();
        type_text(&mut d, "AB");
        d.mark_saved_snapshot("/lib/gebet.json", snapshot);
        assert!(d.is_dirty());
        d.undo();
        assert!(!d.is_dirty());
    }

    #[test]
    fn new_unsaved_is_dirty_until_saved() {
        let mut d = SessionDraft::new_unsaved("/lib/gebet.json", prayer());
        assert!(d.is_dirty());
        assert!(!d.can_silently_reload());
        d.mark_saved("/lib/gebet.json");
        assert!(!d.is_dirty());
    }

    // -- disk state ---------------------------------------------------------

    fn changed_on_disk() -> Prayer {
        let mut p = prayer();
        edit::set_description(&mut p, "von draußen");
        p
    }

    #[test]
    fn clean_draft_reloads_silently_and_undoably() {
        let mut d = draft();
        assert!(d.can_silently_reload());
        let reaction = d.disk_changed(DiskContent::Valid(changed_on_disk().into()));
        assert_eq!(reaction, DiskReaction::ReloadedSilently);
        assert_eq!(d.prayer().description.as_deref(), Some("von draußen"));
        assert!(!d.is_dirty());
        assert_eq!(d.disk_state(), &DiskState::InSync);
        assert_eq!(d.undo_label(), Some("Reload from disk"));
        assert!(d.undo());
        assert_eq!(d.prayer(), &prayer());
        assert!(d.is_dirty(), "undoing a reload leaves the file different");
    }

    #[test]
    fn echo_of_our_own_save_is_ignored() {
        let mut d = draft();
        type_text(&mut d, "Neu");
        d.mark_saved("/lib/gebet.json");
        type_text(&mut d, "Neuer");
        // the watcher reports the file we just wrote: it equals the baseline
        let echo = d.baseline().clone();
        assert_eq!(
            d.disk_changed(DiskContent::Valid(echo.into())),
            DiskReaction::Unchanged
        );
        assert_eq!(de_text(&d), "Neuer", "unsaved text kept");
        assert_eq!(d.disk_state(), &DiskState::InSync);
        assert!(d.is_dirty());
    }

    #[test]
    fn dirty_draft_gets_changed_on_disk_then_reload_is_undoable() {
        let mut d = draft();
        type_text(&mut d, "Mein Text");
        let outside = changed_on_disk();
        assert_eq!(
            d.disk_changed(DiskContent::Valid(outside.clone().into())),
            DiskReaction::NeedsDecision
        );
        assert_eq!(
            d.disk_state(),
            &DiskState::ChangedOnDisk(DiskContent::Valid(outside.clone().into()))
        );
        assert_eq!(de_text(&d), "Mein Text", "nothing replaced yet");

        assert!(d.reload_pending());
        assert_eq!(d.prayer(), &outside);
        assert!(!d.is_dirty());
        assert_eq!(d.disk_state(), &DiskState::InSync);
        assert!(d.undo(), "Reload can be undone");
        assert_eq!(de_text(&d), "Mein Text");
        assert!(d.is_dirty());
    }

    #[test]
    fn keep_mine_makes_saving_overwrite() {
        let mut d = draft();
        type_text(&mut d, "Mein Text");
        d.disk_changed(DiskContent::Valid(changed_on_disk().into()));
        d.keep_mine();
        assert_eq!(d.disk_state(), &DiskState::InSync);
        assert!(d.is_dirty());
        assert_eq!(de_text(&d), "Mein Text");
        // undoing everything: still different from what is on disk, so dirty
        d.undo();
        assert!(d.is_dirty(), "the file on disk is not this prayer");
        d.redo();
        d.mark_saved("/lib/gebet.json");
        assert!(!d.is_dirty());
    }

    #[test]
    fn keep_mine_with_invalid_disk_content_stays_dirty() {
        let mut d = draft();
        type_text(&mut d, "x");
        let errors = vec![ValidationError {
            path: "/".into(),
            message: "not json".into(),
        }];
        assert_eq!(
            d.disk_changed(DiskContent::Invalid(errors.clone())),
            DiskReaction::NeedsDecision
        );
        assert!(!d.reload_pending(), "invalid content cannot be loaded");
        d.undo();
        d.keep_mine();
        assert!(d.is_dirty(), "disk holds something else until we save");
    }

    #[test]
    fn clean_draft_with_invalid_disk_content_asks() {
        let mut d = draft();
        let errors = vec![ValidationError {
            path: "/id".into(),
            message: "Required".into(),
        }];
        assert_eq!(
            d.disk_changed(DiskContent::Invalid(errors.clone())),
            DiskReaction::NeedsDecision
        );
        assert_eq!(
            d.disk_state(),
            &DiskState::ChangedOnDisk(DiskContent::Invalid(errors))
        );
        assert_eq!(de_text(&d), "Herr erbarme dich");
    }

    #[test]
    fn deleted_on_disk_with_unsaved_changes_stays_and_save_recreates() {
        let mut d = draft();
        type_text(&mut d, "Mein Text");
        assert_eq!(d.disk_deleted(), DiskReaction::NeedsDecision);
        assert_eq!(d.disk_state(), &DiskState::DeletedOnDisk);
        assert!(d.is_dirty());
        d.undo();
        assert!(d.is_dirty(), "deleted file: saving is still needed");
        d.mark_saved("/lib/gebet.json");
        assert_eq!(d.disk_state(), &DiskState::InSync);
        assert!(!d.is_dirty());
    }

    #[test]
    fn deleted_clean_draft_may_be_closed() {
        let mut d = draft();
        assert_eq!(d.disk_deleted(), DiskReaction::CleanDeleted);
        assert_eq!(d.disk_state(), &DiskState::DeletedOnDisk);
    }

    #[test]
    fn file_coming_back_identical_resolves_deleted() {
        let mut d = draft();
        d.disk_deleted();
        assert_eq!(
            d.disk_changed(DiskContent::Valid(prayer().into())),
            DiskReaction::Unchanged
        );
        assert_eq!(d.disk_state(), &DiskState::InSync);
        assert!(!d.is_dirty());
    }

    #[test]
    fn file_coming_back_different_after_delete_asks_when_dirty() {
        let mut d = draft();
        type_text(&mut d, "Mein Text");
        d.disk_deleted();
        assert_eq!(
            d.disk_changed(DiskContent::Valid(changed_on_disk().into())),
            DiskReaction::NeedsDecision
        );
        assert!(matches!(d.disk_state(), DiskState::ChangedOnDisk(_)));
    }

    #[test]
    fn reload_of_the_same_prayer_records_nothing() {
        let mut d = draft();
        d.reload_from_disk(prayer());
        assert!(!d.can_undo());
        assert!(!d.is_dirty());
    }

    #[test]
    fn saving_resolves_a_pending_disk_change() {
        let mut d = draft();
        type_text(&mut d, "Mein Text");
        d.disk_changed(DiskContent::Valid(changed_on_disk().into()));
        d.mark_saved("/lib/gebet.json");
        assert_eq!(d.disk_state(), &DiskState::InSync);
        assert!(!d.is_dirty());
    }

    #[test]
    fn greek_text_round_trips_through_split_and_undo() {
        let mut d = draft();
        let el = VariantKey {
            lang: "el",
            variant: "standard",
        };
        d.edit(EditKind::Other, |p| {
            p.variants.push(prayer_core::model::VariantMeta {
                lang: "el".into(),
                variant: "standard".into(),
                title: "Προσευχή".into(),
                license: "CC0".into(),
                source: "z".into(),
            });
            edit::set_block_content(p, "a", el, &text("Κύριε ἐλέησον"));
        });
        let before = d.prayer().clone();
        let at = "Κύριε".len();
        d.edit(EditKind::Other, |p| {
            edit::split_block_with_id(p, 0, el, at..at, "n1")
        });
        assert_eq!(
            edit::block_editor_content(d.prayer(), "n1", el)
                .unwrap()
                .plain_text(),
            " ἐλέησον"
        );
        assert!(d.undo());
        assert_eq!(d.prayer(), &before);
        assert!(d.is_valid());
        let _ = TextRun::text("");
    }
}
