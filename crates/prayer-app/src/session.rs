//! The Session: all app state the UI drives, without threads or a window.
//!
//! A [`Session`] owns the open [`Library`], the Session drafts (one
//! [`SessionDraft`] per opened prayer, kept for the app's lifetime so undo
//! survives switching prayers), the selection, the preferences and the
//! unsaved-changes decision in flight. The UI owns the
//! [`LibraryWatcher`](crate::watch::LibraryWatcher) and forwards its events to
//! [`Session::handle_watch_event`]; it also decides when to call
//! [`Session::scan_step`].
//!
//! Operations return what the user should be told as [`Notice`]s instead of
//! storing it: `Ok(Done { value, notices })` on success and `Err(Notice)` when
//! the operation failed and changed nothing. Titles and messages are the
//! Electron toast texts. Rewrite of `session/operations.ts`,
//! `persistPrayer.ts`, `prayerFileIo.ts`, `renameKindLibrary.ts`,
//! `visibleVariants.ts` and the session parts of `usePrayerSession.ts`.

use std::fmt;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use prayer_core::display_title::resolve_display_title;
use prayer_core::kinds::compare_locale;
use prayer_core::library::{is_prayer_filename, prayer_filename};
use prayer_core::resolve_styles::{ResolveStylesOptions, resolve_styles};
use prayer_core::validate::validate;
use prayer_core::validate_styles::is_valid_kind_id;
use prayer_core::{
    Block, IdCollision, LibraryManifest, Prayer, StyleMap, StyleOverrides, Translation,
    ValidationError, VariantKey, is_kind_preset,
};
use serde_json::Value;

use crate::catalog::{Catalog, CatalogEntry, EntryStatus, VariantId};
use crate::draft::{DiskContent, DiskReaction, DiskState, SessionDraft};
use crate::edit::{self, VariantRef, VariantRenamed};
use crate::export::{self, ExportDefaults, ExportError, ExportRequest};
use crate::fs::{LibraryRoot, write_atomic};
use crate::history::EditKind;
use crate::library::{Library, MANIFEST_PATH, NewLibrary, STYLES_CLEANED_TITLE, STYLES_PATH};
use crate::prefs::{Prefs, now_ms};
use crate::watch::WatchEvent;

// ---------------------------------------------------------------------------
// Notices and results
// ---------------------------------------------------------------------------

/// How a [`Notice`] is shown. Electron's "dark" toasts are `Info`, its
/// "accent" toasts `Error`; `Warning` is for the duplicate-id and
/// styles-cleaned toasts that say something is off without an operation
/// having failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoticeLevel {
    Info,
    Error,
    Warning,
}

/// A toast: what happened, in Electron's words.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice {
    pub level: NoticeLevel,
    pub title: String,
    pub message: String,
}

impl Notice {
    pub fn new(level: NoticeLevel, title: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            level,
            title: title.into(),
            message: message.into(),
        }
    }

    pub fn info(title: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(NoticeLevel::Info, title, message)
    }

    pub fn error(title: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(NoticeLevel::Error, title, message)
    }

    pub fn warning(title: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(NoticeLevel::Warning, title, message)
    }
}

impl fmt::Display for Notice {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} — {}", self.title, self.message)
    }
}

impl std::error::Error for Notice {}

/// A finished operation: its result plus the notices to show.
#[derive(Clone, Debug, PartialEq)]
pub struct Done<T = ()> {
    pub value: T,
    pub notices: Vec<Notice>,
}

impl<T> Done<T> {
    pub fn new(value: T) -> Self {
        Self {
            value,
            notices: Vec::new(),
        }
    }

    pub fn with_notice(value: T, notice: Notice) -> Self {
        Self {
            value,
            notices: vec![notice],
        }
    }
}

/// `Ok`: done (possibly with notices). `Err`: refused or failed, nothing
/// changed; the notice says why.
pub type SessionResult<T = ()> = Result<Done<T>, Notice>;

// ---------------------------------------------------------------------------
// Unsaved changes
// ---------------------------------------------------------------------------

/// Something that has to wait for the unsaved-changes decision.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PendingAction {
    /// The window is closing; the UI closes it once the Session allows.
    CloseWindow,
    /// Switch to the Library at this folder (picker, recent, new Library).
    OpenLibrary(PathBuf),
    /// Re-read the Library from disk.
    Refresh,
    /// Install an update and restart; the UI does that once the Session
    /// allows.
    InstallUpdate,
}

/// Answer to the "Unsaved changes" dialog.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnsavedChoice {
    SaveAll,
    DiscardAll,
    Cancel,
}

/// What became of a [`PendingAction`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ActionOutcome {
    /// Nothing was in the way. `OpenLibrary` and `Refresh` are done;
    /// `CloseWindow` and `InstallUpdate` are for the UI to carry out now.
    Performed(PendingAction),
    /// Drafts have unsaved changes: show the dialog, then call
    /// [`Session::resolve_unsaved`].
    NeedsDecision,
    /// The user cancelled; everything stays as it is.
    Cancelled,
}

/// A prayer with unsaved changes, for the dialog and the list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DirtyDraft {
    pub path: String,
    pub id: String,
}

// ---------------------------------------------------------------------------
// Selection and drafts
// ---------------------------------------------------------------------------

/// A selected file that cannot be opened in the editor (the "Cannot open
/// prayer" screen).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InvalidPrayer {
    pub path: String,
    /// The file is not JSON at all.
    pub invalid_json: bool,
    /// Shown by the "Show validation details" modal.
    pub errors: Vec<ValidationError>,
}

/// Result of [`Session::select_prayer`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SelectOutcome {
    /// The prayer is open in the editor.
    Opened,
    /// The file is invalid; show the Invalid prayer screen.
    Invalid {
        invalid_json: bool,
        errors: Vec<ValidationError>,
    },
    /// Selecting what is already selected does nothing.
    Unchanged,
}

enum Selected {
    Draft(String),
    Invalid(InvalidPrayer),
}

/// A Session draft with the columns it is shown in.
struct OpenPrayer {
    draft: SessionDraft,
    /// Visible Variants in reading order; the first is the primary one.
    columns: Vec<VariantRef>,
}

enum ParseFailure {
    NotJson,
    Schema(Vec<ValidationError>),
}

impl ParseFailure {
    fn errors(self) -> Vec<ValidationError> {
        match self {
            Self::NotJson => vec![ValidationError {
                path: "/".into(),
                message: "Invalid JSON".into(),
            }],
            Self::Schema(errors) => errors,
        }
    }
}

fn parse_prayer(text: &str) -> Result<Prayer, ParseFailure> {
    let value: Value = serde_json::from_str(text).map_err(|_| ParseFailure::NotJson)?;
    validate(&value).map_err(ParseFailure::Schema)
}

fn to_ids(columns: &[VariantRef]) -> Vec<VariantId> {
    columns
        .iter()
        .map(|c| VariantId {
            lang: c.lang.clone(),
            variant: c.variant.clone(),
        })
        .collect()
}

fn from_ids(columns: &[VariantId]) -> Vec<VariantRef> {
    columns
        .iter()
        .map(|c| VariantRef::new(c.lang.as_str(), c.variant.as_str()))
        .collect()
}

fn preferred_ref(library: &Library) -> Option<VariantRef> {
    library.preferred_variant().map(VariantRef::from)
}

/// Columns to open a prayer with: those remembered for it (reconciled with
/// its Variants), else the Library default or the first Variant.
fn initial_columns(
    prefs: &Prefs,
    library: &Library,
    path: &str,
    prayer: &Prayer,
) -> Vec<VariantRef> {
    let preferred = preferred_ref(library);
    let saved = prefs
        .prayer_view(&root_key(library), path)
        .map(from_ids)
        .unwrap_or_default();
    edit::reconcile_visible_variants(&saved, &prayer.variants, preferred.as_ref())
}

fn root_key(library: &Library) -> String {
    library.path().to_string_lossy().into_owned()
}

fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

// ---------------------------------------------------------------------------
// Forms and reports
// ---------------------------------------------------------------------------

/// Input of the "New prayer" modal. [`NewPrayerForm::new`] is the Electron
/// template: type `prayer`, no tone, one Variant `de` / `standard` titled
/// "Unbenannt" (license `unknown`, source `draft`) and one empty verse Block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewPrayerForm {
    /// File name without `.json`.
    pub id: String,
    pub description: String,
    pub prayer_type: String,
    /// 1 to 8; `None` writes `"tone": null`.
    pub tone: Option<u8>,
    pub book: String,
    pub occasion: String,
    pub lang: String,
    pub variant: String,
    pub title: String,
    pub license: String,
    pub source: String,
}

impl NewPrayerForm {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            description: String::new(),
            prayer_type: "prayer".into(),
            tone: None,
            book: String::new(),
            occasion: String::new(),
            lang: "de".into(),
            variant: "standard".into(),
            title: "Unbenannt".into(),
            license: "unknown".into(),
            source: "draft".into(),
        }
    }

    /// The prayer this form describes; empty description, book and occasion
    /// are omitted.
    pub fn to_prayer(&self) -> Prayer {
        let non_empty = |s: &str| (!s.is_empty()).then(|| s.to_owned());
        Prayer {
            id: self.id.clone(),
            prayer_type: self.prayer_type.clone(),
            book: non_empty(&self.book),
            occasion: non_empty(&self.occasion),
            tone: Some(self.tone),
            description: non_empty(&self.description),
            variants: vec![prayer_core::VariantMeta {
                lang: self.lang.clone(),
                variant: self.variant.clone(),
                title: self.title.clone(),
                license: self.license.clone(),
                source: self.source.clone(),
            }],
            structure: vec![Block {
                id: "b1".into(),
                kind: "verse".into(),
                translations: Vec::<Translation>::new(),
            }],
            meta: None,
        }
    }
}

/// What a Kind rename would touch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KindRenamePlan {
    pub from: String,
    pub to: String,
    /// Prayer files (paths) that use the Kind: open drafts first, then
    /// scanned files, then unscanned files that turned out to use it.
    pub affected: Vec<String>,
}

/// A prayer the rename could not write.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkippedFile {
    pub path: String,
    pub reason: String,
}

/// Result of a Kind rename across the Library.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KindRenameReport {
    /// Files rewritten at once.
    pub written: Vec<String>,
    /// Open drafts renamed in memory (they stay unsaved, undoable).
    pub drafts: Vec<String>,
    pub skipped: Vec<SkippedFile>,
}

/// Answer of [`Session::request_kind_rename`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KindRenameRequest {
    /// Presets, unchanged or invalid names: nothing to do.
    Ignored,
    /// More than one prayer uses the Kind: confirm "Rename kind in
    /// library?" ("Rename “A” to “B” in N prayers? This writes those files
    /// now."), then call [`Session::apply_kind_rename`].
    Confirm(KindRenamePlan),
    /// One or no prayer used it: renamed without confirmation.
    Applied(KindRenameReport),
}

/// Why a [`Session::scan_step`] returned.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanProgress {
    /// Files read in this step; `0` means the scan is done.
    pub read: usize,
    pub complete: bool,
    pub notices: Vec<Notice>,
}

/// One row of the Library sidebar: the catalog entry with the live state of
/// an open draft laid over it.
#[derive(Clone, Debug, PartialEq)]
pub struct SidebarEntry {
    pub path: String,
    pub id: Option<String>,
    /// Display title (Library default Variant, else the first); `None` for
    /// invalid files (the UI shows the path).
    pub title: Option<String>,
    pub description: Option<String>,
    /// `false` shows the "!" badge.
    pub valid: bool,
    pub errors: Vec<ValidationError>,
    /// Unsaved changes (the dirty dot).
    pub dirty: bool,
    /// The prayer is open as a Session draft.
    pub open: bool,
    pub scanned: bool,
}

/// How an open draft reacted to an outside change.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiskChange {
    /// A draft without unsaved changes took the new file content.
    Reloaded,
    /// "Changed on disk": Reload or Keep mine.
    ChangedOnDisk,
    /// "Deleted on disk": saving recreates the file.
    DeletedOnDisk,
    /// The draft had no unsaved changes and its file is gone: it was closed.
    Closed,
    /// The selected invalid file changed; the Invalid prayer screen (or the
    /// editor, if it became valid) was updated.
    SelectionUpdated,
}

/// A change to one open prayer caused by the file system.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DraftChange {
    pub path: String,
    pub change: DiskChange,
}

/// What [`Session::handle_watch_event`] changed.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WatchReport {
    pub changes: Vec<DraftChange>,
    /// `manifest.json` or the styles file was re-read.
    pub config_reloaded: bool,
    /// The whole Library was re-read (the catalog restarted; keep calling
    /// [`Session::scan_step`]).
    pub rescanned: bool,
    pub notices: Vec<Notice>,
}

// ---------------------------------------------------------------------------
// The Session
// ---------------------------------------------------------------------------

/// All app state behind the UI. See the [module docs](self).
pub struct Session {
    library: Option<Library>,
    prefs: Prefs,
    prefs_path: Option<PathBuf>,
    /// Every opened prayer by path, in the order opened.
    drafts: IndexMap<String, OpenPrayer>,
    selected: Option<Selected>,
    pending: Option<PendingAction>,
    /// Duplicate ids were already reported for the current Library state.
    collisions_reported: bool,
}

impl Session {
    /// A Session with the given preferences, saved to `prefs_path` after
    /// every change (best effort; `None` keeps them in memory only).
    pub fn new(prefs: Prefs, prefs_path: Option<PathBuf>) -> Self {
        Self {
            library: None,
            prefs,
            prefs_path,
            drafts: IndexMap::new(),
            selected: None,
            pending: None,
            collisions_reported: false,
        }
    }

    /// A Session with the preferences of this user ([`Prefs::load`]).
    pub fn load() -> Self {
        Self::new(Prefs::load(), Prefs::default_path())
    }

    // -- preferences -------------------------------------------------------

    pub fn prefs(&self) -> &Prefs {
        &self.prefs
    }

    /// Changes the preferences and saves them.
    pub fn update_prefs<R>(&mut self, f: impl FnOnce(&mut Prefs) -> R) -> R {
        let result = f(&mut self.prefs);
        self.save_prefs();
        result
    }

    /// "Remove from recent".
    pub fn forget_recent(&mut self, path: &str) {
        self.update_prefs(|p| p.remove_recent(path));
    }

    fn save_prefs(&self) {
        if let Some(path) = &self.prefs_path {
            // Preferences are best effort: a failed write loses nothing the
            // user typed.
            let _ = self.prefs.save_to(path);
        }
    }

    // -- the Library -------------------------------------------------------

    pub fn library(&self) -> Option<&Library> {
        self.library.as_ref()
    }

    pub fn catalog(&self) -> Option<&Catalog> {
        self.library.as_ref().map(Library::catalog)
    }

    /// Ids claimed by more than one file (the sidebar "Duplicate ids" alert).
    pub fn collisions(&self) -> &[IdCollision] {
        self.catalog().map_or(&[], Catalog::collisions)
    }

    /// Opens the Library at `path` (picker or recent), recording it in the
    /// recent list. With unsaved changes the switch waits for the decision:
    /// [`ActionOutcome::NeedsDecision`]. A folder that is gone is removed
    /// from the recent list. Cancelling a picker is the UI's no-op.
    pub fn open_library(&mut self, path: impl Into<PathBuf>) -> SessionResult<ActionOutcome> {
        self.request(PendingAction::OpenLibrary(path.into()))
    }

    /// Creates `<parent>/<name>` with a `manifest.json` and opens it (after
    /// the unsaved-changes decision, if one is needed). Notices: "Library
    /// created".
    pub fn create_library(
        &mut self,
        parent: &Path,
        spec: &NewLibrary,
    ) -> SessionResult<ActionOutcome> {
        let created = Library::create(parent, spec)
            .map_err(|e| Notice::error("Could not create library", e.to_string()))?;
        let created_notice = Notice::info("Library created", "manifest.json written");
        let mut done = self.request(PendingAction::OpenLibrary(created.path().to_path_buf()))?;
        done.notices.insert(0, created_notice);
        Ok(done)
    }

    /// Starts an action that must not lose unsaved changes: performs it now
    /// when no draft is dirty, else remembers it as pending.
    pub fn request(&mut self, action: PendingAction) -> SessionResult<ActionOutcome> {
        if let PendingAction::OpenLibrary(path) = &action
            && let Err(err) = LibraryRoot::open(path)
        {
            self.forget_recent(&path.to_string_lossy());
            return Err(Notice::error("Could not open library", err.to_string()));
        }
        if self.has_unsaved() {
            self.pending = Some(action);
            return Ok(Done::new(ActionOutcome::NeedsDecision));
        }
        self.perform(action)
    }

    /// The action waiting for the unsaved-changes decision.
    pub fn pending_action(&self) -> Option<&PendingAction> {
        self.pending.as_ref()
    }

    /// Answers the unsaved-changes dialog and performs the pending action:
    /// Save all first (a failed save keeps the action pending and returns
    /// "Cannot save all"), Discard all drops the unsaved changes, Cancel
    /// leaves everything as is.
    pub fn resolve_unsaved(&mut self, choice: UnsavedChoice) -> SessionResult<ActionOutcome> {
        let Some(action) = self.pending.clone() else {
            return Ok(Done::new(ActionOutcome::Cancelled));
        };
        let mut notices = Vec::new();
        match choice {
            UnsavedChoice::Cancel => {
                self.pending = None;
                return Ok(Done::new(ActionOutcome::Cancelled));
            }
            UnsavedChoice::SaveAll => notices.extend(self.save_all()?.notices),
            UnsavedChoice::DiscardAll => {
                // A plain refresh keeps the selected prayer: re-read from disk.
                self.discard_all_inner(action == PendingAction::Refresh);
            }
        }
        self.pending = None;
        let mut done = self.perform(action)?;
        notices.append(&mut done.notices);
        done.notices = notices;
        Ok(done)
    }

    fn perform(&mut self, action: PendingAction) -> SessionResult<ActionOutcome> {
        match &action {
            PendingAction::CloseWindow | PendingAction::InstallUpdate => {}
            PendingAction::OpenLibrary(path) => {
                let notices = self.open_library_now(path)?;
                return Ok(Done {
                    value: ActionOutcome::Performed(action),
                    notices,
                });
            }
            PendingAction::Refresh => {
                let notices = self.refresh_now();
                return Ok(Done {
                    value: ActionOutcome::Performed(action),
                    notices,
                });
            }
        }
        Ok(Done::new(ActionOutcome::Performed(action)))
    }

    fn open_library_now(&mut self, path: &Path) -> Result<Vec<Notice>, Notice> {
        let mut library = match Library::open(path) {
            Ok(library) => library,
            Err(err) => {
                self.forget_recent(&path.to_string_lossy());
                return Err(Notice::error("Could not open library", err.to_string()));
            }
        };
        let notices = library
            .take_styles_notice()
            .map(|message| Notice::warning(STYLES_CLEANED_TITLE, message))
            .into_iter()
            .collect();
        let root = root_key(&library);
        self.update_prefs(|p| p.push_recent(&root, now_ms()));
        self.drafts.clear();
        self.selected = None;
        self.collisions_reported = false;
        self.library = Some(library);
        Ok(notices)
    }

    /// Re-reads the Library from disk (Refresh): the catalog restarts, open
    /// prayers are compared with their files (clean ones follow the file,
    /// others get "Changed on disk" / "Deleted on disk") and the selection
    /// stays. Asks about unsaved changes first, like [`Session::request`].
    pub fn refresh(&mut self) -> SessionResult<ActionOutcome> {
        self.request(PendingAction::Refresh)
    }

    fn refresh_now(&mut self) -> Vec<Notice> {
        let Some(library) = self.library.as_mut() else {
            return Vec::new();
        };
        library.rescan();
        self.collisions_reported = false;
        let mut notices = Vec::new();
        if let Some(message) = library.take_styles_notice() {
            notices.push(Notice::warning(STYLES_CLEANED_TITLE, message));
        }
        self.reconcile_all_with_disk();
        notices
    }

    /// Closes the Library. Refused (`false`) while drafts have unsaved
    /// changes: resolve them first ([`Session::request`]).
    pub fn close_library(&mut self) -> bool {
        if self.has_unsaved() {
            return false;
        }
        self.library = None;
        self.drafts.clear();
        self.selected = None;
        true
    }

    /// Reads the next chunk of the catalog. Reports duplicate ids once, when
    /// they first appear.
    pub fn scan_step(&mut self, chunk_size: usize) -> ScanProgress {
        let Some(library) = self.library.as_mut() else {
            return ScanProgress {
                read: 0,
                complete: true,
                notices: Vec::new(),
            };
        };
        let read = library.scan_step(chunk_size);
        let complete = library.catalog().scan_complete();
        let mut notices = Vec::new();
        let collisions = library.catalog().collisions();
        if collisions.is_empty() {
            self.collisions_reported = false;
        } else if !self.collisions_reported {
            self.collisions_reported = true;
            let message = collisions
                .iter()
                .map(|c| format!("{}: {}", c.id, c.paths.join(", ")))
                .collect::<Vec<_>>()
                .join(" · ");
            notices.push(Notice::warning("Duplicate prayer ids", message));
        }
        ScanProgress {
            read,
            complete,
            notices,
        }
    }

    /// Scans the whole catalog (tests, small Libraries).
    pub fn scan_all(&mut self) -> Vec<Notice> {
        let mut notices = Vec::new();
        loop {
            let step = self.scan_step(crate::catalog::CHUNK_SIZE);
            notices.extend(step.notices);
            if step.read == 0 {
                return notices;
            }
        }
    }

    // -- unsaved state -----------------------------------------------------

    pub fn has_unsaved(&self) -> bool {
        self.drafts.values().any(|o| o.draft.is_dirty())
    }

    /// Prayers with unsaved changes, in the order they were opened.
    pub fn dirty_drafts(&self) -> Vec<DirtyDraft> {
        self.drafts
            .iter()
            .filter(|(_, o)| o.draft.is_dirty())
            .map(|(path, o)| DirtyDraft {
                path: path.clone(),
                id: o.draft.prayer().id.clone(),
            })
            .collect()
    }

    // -- selection and drafts ----------------------------------------------

    /// Path of the selected prayer (editor or Invalid prayer screen).
    pub fn selected_path(&self) -> Option<&str> {
        match self.selected.as_ref()? {
            Selected::Draft(path) => Some(path),
            Selected::Invalid(invalid) => Some(&invalid.path),
        }
    }

    /// The selected file when it cannot be opened.
    pub fn selected_invalid(&self) -> Option<&InvalidPrayer> {
        match self.selected.as_ref()? {
            Selected::Invalid(invalid) => Some(invalid),
            Selected::Draft(_) => None,
        }
    }

    pub fn selected_draft(&self) -> Option<&SessionDraft> {
        match self.selected.as_ref()? {
            Selected::Draft(path) => self.draft(path),
            Selected::Invalid(_) => None,
        }
    }

    /// The selected draft for editing. After edits that may change the
    /// Variants, [`Session::visible_variants`] reconciles the columns.
    pub fn selected_draft_mut(&mut self) -> Option<&mut SessionDraft> {
        let Some(Selected::Draft(path)) = self.selected.as_ref() else {
            return None;
        };
        self.drafts.get_mut(path).map(|o| &mut o.draft)
    }

    pub fn draft(&self, path: &str) -> Option<&SessionDraft> {
        self.drafts.get(path).map(|o| &o.draft)
    }

    /// Any open draft, for example to answer "Reload" / "Keep mine".
    pub fn draft_mut(&mut self, path: &str) -> Option<&mut SessionDraft> {
        self.drafts.get_mut(path).map(|o| &mut o.draft)
    }

    /// Paths of all open drafts, in the order opened.
    pub fn open_paths(&self) -> impl Iterator<Item = &str> {
        self.drafts.keys().map(String::as_str)
    }

    /// Edits the selected prayer (undoable) and keeps the visible columns
    /// pointing at Variants that exist. `None` without a selected draft.
    pub fn edit_selected<R>(
        &mut self,
        kind: EditKind,
        f: impl FnOnce(&mut Prayer) -> R,
    ) -> Option<R> {
        let result = self.selected_draft_mut()?.edit(kind, f);
        self.visible_variants();
        Some(result)
    }

    /// Selects a prayer: reads and validates the file and opens it as a
    /// Session draft, or reports it as invalid. A prayer opened before keeps
    /// its draft (and undo history), clean or dirty. Selecting what is
    /// selected does nothing.
    ///
    /// Errors: "Could not open prayer" (unreadable). Invalid JSON adds the
    /// "Invalid JSON" notice next to [`SelectOutcome::Invalid`]; schema
    /// errors have none.
    pub fn select_prayer(&mut self, path: &str) -> SessionResult<SelectOutcome> {
        if self.library.is_none() || self.selected_path() == Some(path) {
            return Ok(Done::new(SelectOutcome::Unchanged));
        }
        if self.drafts.contains_key(path) {
            self.selected = Some(Selected::Draft(path.to_owned()));
            return Ok(Done::new(SelectOutcome::Opened));
        }
        let Some(library) = self.library.as_mut() else {
            return Ok(Done::new(SelectOutcome::Unchanged));
        };
        let text = library
            .root()
            .read_text(path)
            .map_err(|e| Notice::error("Could not open prayer", e.to_string()))?;
        match parse_prayer(&text) {
            Ok(prayer) => {
                library.catalog_mut().upsert_prayer(path, &prayer);
                let columns = initial_columns(&self.prefs, library, path, &prayer);
                self.drafts.insert(
                    path.to_owned(),
                    OpenPrayer {
                        draft: SessionDraft::new(path, prayer),
                        columns,
                    },
                );
                self.selected = Some(Selected::Draft(path.to_owned()));
                Ok(Done::new(SelectOutcome::Opened))
            }
            Err(failure) => {
                library
                    .catalog_mut()
                    .upsert(CatalogEntry::from_text(path, &text));
                let invalid_json = matches!(failure, ParseFailure::NotJson);
                let errors = failure.errors();
                self.selected = Some(Selected::Invalid(InvalidPrayer {
                    path: path.to_owned(),
                    invalid_json,
                    errors: errors.clone(),
                }));
                let notices = if invalid_json {
                    vec![Notice::error("Invalid JSON", path)]
                } else {
                    Vec::new()
                };
                Ok(Done {
                    value: SelectOutcome::Invalid {
                        invalid_json,
                        errors,
                    },
                    notices,
                })
            }
        }
    }

    /// Clears the selection (the "Select a prayer" empty state). The draft
    /// stays open.
    pub fn clear_selection(&mut self) {
        self.selected = None;
    }

    // -- visible Variant columns --------------------------------------------

    /// Visible Variant columns of the selected prayer, reading order, the
    /// first being the primary one. Columns whose Variant no longer exists
    /// are dropped (falling back to the Library default or the first
    /// Variant) and the result is remembered.
    pub fn visible_variants(&mut self) -> Vec<VariantRef> {
        let Some(Selected::Draft(path)) = self.selected.as_ref() else {
            return Vec::new();
        };
        let path = path.clone();
        let preferred = self.library.as_ref().and_then(preferred_ref);
        let Some(open) = self.drafts.get_mut(&path) else {
            return Vec::new();
        };
        let reconciled = edit::reconcile_visible_variants(
            &open.columns,
            &open.draft.prayer().variants,
            preferred.as_ref(),
        );
        if reconciled != open.columns {
            open.columns = reconciled.clone();
            self.remember_columns(&path);
        }
        reconciled
    }

    /// Sets the visible columns of the selected prayer and remembers them
    /// per prayer. Columns without a matching Variant are dropped.
    pub fn set_visible_variants(&mut self, columns: Vec<VariantRef>) {
        let Some(Selected::Draft(path)) = self.selected.as_ref() else {
            return;
        };
        let path = path.clone();
        let Some(open) = self.drafts.get_mut(&path) else {
            return;
        };
        let variants = &open.draft.prayer().variants;
        let valid: Vec<VariantRef> = columns
            .into_iter()
            .filter(|c| variants.iter().any(|v| v.key() == c.key()))
            .collect();
        if valid.is_empty() || valid == open.columns {
            return;
        }
        open.columns = valid;
        self.remember_columns(&path);
    }

    /// Makes `variant` the first (primary) column, adding it when hidden.
    pub fn set_active_variant(&mut self, variant: VariantRef) {
        let mut columns = self.visible_variants();
        columns.retain(|c| *c != variant);
        columns.insert(0, variant);
        self.set_visible_variants(columns);
    }

    /// Keeps the columns on a Variant whose `lang` or `variant` was edited
    /// ([`edit::update_variant_meta`] returns the rename).
    pub fn apply_variant_rename(&mut self, renamed: &VariantRenamed) {
        let Some(Selected::Draft(path)) = self.selected.as_ref() else {
            return;
        };
        let path = path.clone();
        let Some(open) = self.drafts.get_mut(&path) else {
            return;
        };
        let mut changed = false;
        for column in open.columns.iter_mut().filter(|c| **c == renamed.from) {
            *column = renamed.to.clone();
            changed = true;
        }
        if changed {
            self.remember_columns(&path);
        }
    }

    fn remember_columns(&mut self, path: &str) {
        let (Some(library), Some(open)) = (self.library.as_ref(), self.drafts.get(path)) else {
            return;
        };
        let root = root_key(library);
        let columns = to_ids(&open.columns);
        self.update_prefs(|p| p.set_prayer_view(&root, path, columns));
    }

    // -- the sidebar --------------------------------------------------------

    /// Catalog rows with live draft state overlaid: title, id, validity and
    /// the dirty dot come from an open draft, not from the file. Open drafts
    /// whose file left the catalog (deleted on disk) are listed too. `query`
    /// filters by id, title, description and path, case-insensitively.
    pub fn sidebar_entries(&self, query: &str) -> Vec<SidebarEntry> {
        let Some(library) = self.library.as_ref() else {
            return Vec::new();
        };
        let preferred = library.preferred_variant();
        let mut rows: Vec<SidebarEntry> = library
            .catalog()
            .entries()
            .iter()
            .map(|entry| match self.drafts.get(&entry.path) {
                Some(open) => draft_row(&entry.path, &open.draft, preferred, entry.is_scanned()),
                None => catalog_row(entry, preferred),
            })
            .collect();
        for (path, open) in &self.drafts {
            if library.catalog().entry(path).is_none() {
                rows.push(draft_row(path, &open.draft, preferred, true));
            }
        }
        rows.sort_by(|a, b| {
            let key = |r: &SidebarEntry| r.id.clone().unwrap_or_else(|| r.path.clone());
            compare_locale(&key(a), &key(b)).then_with(|| a.path.cmp(&b.path))
        });
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return rows;
        }
        let contains = |hay: &str| hay.to_lowercase().contains(&needle);
        rows.retain(|r| {
            r.id.as_deref().is_some_and(contains)
                || r.title.as_deref().is_some_and(contains)
                || r.description.as_deref().is_some_and(contains)
                || contains(&r.path)
        });
        rows
    }

    /// Resolved Kind styles: built-in defaults and the Library's styles for
    /// every Kind in the Library and in open drafts.
    pub fn resolved_styles(&self) -> StyleMap {
        let mut kinds: Vec<&str> = self
            .catalog()
            .map(|c| c.kinds().iter().map(String::as_str).collect())
            .unwrap_or_default();
        for open in self.drafts.values() {
            kinds.extend(
                open.draft
                    .prayer()
                    .structure
                    .iter()
                    .map(|b| b.kind.as_str()),
            );
        }
        let library_styles = self.library.as_ref().map(Library::styles);
        resolve_styles(
            kinds,
            &ResolveStylesOptions {
                library_overrides: library_styles,
                ..Default::default()
            },
        )
    }

    // -- create ---------------------------------------------------------------

    /// Starts the "New prayer" modal: the template with the first free
    /// `new-prayer-N` id. Only one such form exists at a time; the UI holds
    /// it until [`Session::create_prayer`].
    pub fn begin_create(&self) -> Result<NewPrayerForm, Notice> {
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| Notice::error("Create failed", "No library is open"))?;
        let id = library
            .new_prayer_id()
            .map_err(|e| Notice::error("Create failed", e.to_string()))?;
        Ok(NewPrayerForm::new(id))
    }

    /// Creates the prayer file from the form and selects it with its Variant
    /// as the only column. Returns the new path.
    ///
    /// Errors: "Cannot create" (schema, messages joined with ` · `), "Id
    /// collision" (`{id}.json` exists; the modal stays open), "Create
    /// failed" (write error).
    pub fn create_prayer(&mut self, form: &NewPrayerForm) -> SessionResult<String> {
        let library = self
            .library
            .as_mut()
            .ok_or_else(|| Notice::error("Create failed", "No library is open"))?;
        let prayer = form.to_prayer();
        let value = serde_json::to_value(&prayer)
            .map_err(|e| Notice::error("Create failed", e.to_string()))?;
        if let Err(errors) = validate(&value) {
            return Err(Notice::error(
                "Cannot create",
                errors
                    .iter()
                    .map(|e| e.message.as_str())
                    .collect::<Vec<_>>()
                    .join(" · "),
            ));
        }
        let path = prayer_filename(&prayer.id);
        let root = library.root();
        let exists = root
            .exists(&path)
            .map_err(|e| Notice::error("Create failed", e.to_string()))?;
        if exists {
            return Err(Notice::error(
                "Id collision",
                format!("File {path} already exists. Choose another id."),
            ));
        }
        root.write_json(&path, &prayer)
            .map_err(|e| Notice::error("Create failed", e.to_string()))?;
        library.catalog_mut().upsert_prayer(&path, &prayer);
        let column = VariantRef::new(form.lang.as_str(), form.variant.as_str());
        let key = root_key(library);
        let view = to_ids(std::slice::from_ref(&column));
        self.drafts.insert(
            path.clone(),
            OpenPrayer {
                draft: SessionDraft::new(path.as_str(), prayer),
                columns: vec![column],
            },
        );
        self.selected = Some(Selected::Draft(path.clone()));
        self.update_prefs(|p| p.set_prayer_view(&key, &path, view));
        Ok(Done::with_notice(
            path.clone(),
            Notice::info("Created", path),
        ))
    }

    // -- save -----------------------------------------------------------------

    /// Saves the selected prayer. Blocked with "Cannot save" while it has
    /// validation errors or its new id would overwrite another file; renaming
    /// by id writes the new file, then deletes the old one. A draft whose file
    /// was deleted outside recreates it, one that changed outside overwrites
    /// ("Keep mine").
    pub fn save_selected(&mut self) -> SessionResult<String> {
        let Some(Selected::Draft(path)) = self.selected.as_ref() else {
            return Ok(Done::new(String::new()));
        };
        let path = path.clone();
        self.save_draft(&path)
    }

    /// Saves one open prayer; returns its (possibly new) path.
    pub fn save_draft(&mut self, path: &str) -> SessionResult<String> {
        let new_path = self
            .save_path(path)
            .map_err(|message| Notice::error("Cannot save", message))?;
        let id = self
            .draft(&new_path)
            .map(|d| d.prayer().id.clone())
            .unwrap_or_default();
        Ok(Done::with_notice(
            new_path,
            Notice::info("Saved", prayer_filename(&id)),
        ))
    }

    /// Saves every prayer with unsaved changes, in the order opened, stopping
    /// at the first failure ("Cannot save all"). Success: "N prayers saved".
    pub fn save_all(&mut self) -> SessionResult {
        let dirty = self.dirty_drafts();
        if dirty.is_empty() {
            return Ok(Done::new(()));
        }
        for draft in &dirty {
            self.save_path(&draft.path)
                .map_err(|message| Notice::error("Cannot save all", message))?;
        }
        let message = match dirty.len() {
            1 => "1 prayer saved".to_owned(),
            n => format!("{n} prayers saved"),
        };
        Ok(Done::with_notice((), Notice::info("Saved", message)))
    }

    fn save_path(&mut self, path: &str) -> Result<String, String> {
        let library = self
            .library
            .as_mut()
            .ok_or_else(|| "No library is open".to_owned())?;
        let open = self
            .drafts
            .get(path)
            .ok_or_else(|| format!("{path} is not open"))?;
        let prayer = open.draft.prayer().clone();
        if !open.draft.is_valid() {
            return Err(format!("“{}”: fix validation errors first.", prayer.id));
        }
        let target = prayer_filename(&prayer.id);
        let renamed = basename(path) != target;
        let root = library.root();
        if renamed && root.exists(&target).map_err(|e| e.to_string())? {
            return Err(format!("Id collision: {target} already exists."));
        }
        let new_path = if renamed { target } else { path.to_owned() };
        root.write_json(&new_path, &prayer)
            .map_err(|e| e.to_string())?;
        if renamed {
            // Not atomic, like Electron: a failing delete leaves both files.
            root.delete(path).map_err(|e| e.to_string())?;
            library.catalog_mut().remove(path);
        }
        library.catalog_mut().upsert_prayer(&new_path, &prayer);
        let key = root_key(library);

        if renamed {
            self.rekey_draft(path, &new_path);
            self.update_prefs(|p| p.rename_prayer(&key, path, &new_path));
        }
        if let Some(open) = self.drafts.get_mut(&new_path) {
            open.draft.mark_saved(new_path.as_str());
        }
        self.remember_columns(&new_path);
        Ok(new_path)
    }

    fn rekey_draft(&mut self, from: &str, to: &str) {
        let old = std::mem::take(&mut self.drafts);
        self.drafts = old
            .into_iter()
            .map(|(k, v)| {
                if k == from {
                    (to.to_owned(), v)
                } else {
                    (k, v)
                }
            })
            .collect();
        match self.selected.as_mut() {
            Some(Selected::Draft(p)) if p == from => *p = to.to_owned(),
            _ => {}
        }
    }

    // -- discard, delete ---------------------------------------------------

    /// Drops one prayer's draft with its unsaved changes and undo history. If
    /// it was selected, it is opened again from disk.
    pub fn discard(&mut self, path: &str) -> SessionResult {
        let was_selected = self.selected_path() == Some(path);
        if self.drafts.shift_remove(path).is_none() {
            return Ok(Done::new(()));
        }
        if was_selected {
            self.selected = None;
            // The file may be gone or unreadable: then nothing is selected.
            let _ = self.select_prayer(path);
        }
        Ok(Done::new(()))
    }

    /// Drops every draft with unsaved changes ("Discard all"). A selected
    /// prayer that was dropped is opened again from disk.
    pub fn discard_all(&mut self) {
        self.discard_all_inner(true);
    }

    fn discard_all_inner(&mut self, reselect: bool) {
        let selected = self.selected_path().map(str::to_owned);
        self.drafts.retain(|_, o| !o.draft.is_dirty());
        if let Some(path) = selected
            && !self.drafts.contains_key(&path)
            && matches!(self.selected, Some(Selected::Draft(_)))
        {
            self.selected = None;
            if reselect {
                // An unreadable file simply leaves nothing selected.
                let _ = self.select_prayer(&path);
            }
        }
    }

    /// Deletes a prayer file (any file of the catalog, valid or not) with its
    /// saved view and export preferences and its draft. Errors: "Delete
    /// failed".
    pub fn delete_prayer(&mut self, path: &str) -> SessionResult {
        let library = self
            .library
            .as_mut()
            .ok_or_else(|| Notice::error("Delete failed", "No library is open"))?;
        library
            .root()
            .delete(path)
            .map_err(|e| Notice::error("Delete failed", e.to_string()))?;
        library.catalog_mut().remove(path);
        let key = root_key(library);
        self.update_prefs(|p| p.remove_prayer(&key, path));
        self.drafts.shift_remove(path);
        if self.selected_path() == Some(path) {
            self.selected = None;
        }
        Ok(Done::with_notice((), Notice::info("Deleted", path)))
    }

    // -- import and export of prayer JSON -------------------------------------

    /// Copies a prayer JSON file into the Library root unchanged, as
    /// `{id}.json` (or its own file name without a usable id), and opens it.
    /// Never overwrites: "Id collision". Errors: "Import failed", "Cannot
    /// import" (not a flat prayer file name). Returns the new path; an
    /// invalid imported file opens as the Invalid prayer screen.
    pub fn import_prayer(&mut self, source: &Path) -> SessionResult<String> {
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| Notice::error("Import failed", "No library is open"))?;
        let bytes = std::fs::read(source)
            .map_err(|e| Notice::error("Import failed", format!("{}: {e}", source.display())))?;
        let text = String::from_utf8_lossy(&bytes);
        let source_name = source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        let id = serde_json::from_str::<Value>(&text).ok().and_then(|v| {
            v.get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        });
        let path = id
            .as_deref()
            .map_or_else(|| basename(&source_name).to_owned(), prayer_filename);
        if path.contains(['/', '\\']) || !is_prayer_filename(&path) {
            return Err(Notice::error(
                "Cannot import",
                format!(
                    "Cannot import “{}” as a prayer file.",
                    basename(&source_name)
                ),
            ));
        }

        let catalog = library.catalog();
        let clash = catalog.entry(&path).or_else(|| {
            id.as_deref().and_then(|id| {
                catalog
                    .entries()
                    .iter()
                    .find(|e| e.id.as_deref() == Some(id))
            })
        });
        if let Some(clash) = clash {
            return Err(Notice::error(
                "Id collision",
                format!(
                    "“{}” already exists as {}.",
                    id.as_deref().unwrap_or(&path),
                    clash.path
                ),
            ));
        }
        let root = library.root();
        let exists = root
            .exists(&path)
            .map_err(|e| Notice::error("Import failed", e.to_string()))?;
        if exists {
            return Err(Notice::error(
                "Id collision",
                format!("File {path} already exists."),
            ));
        }
        root.write_bytes(&path, &bytes)
            .map_err(|e| Notice::error("Import failed", e.to_string()))?;

        let mut notices = vec![Notice::info("Imported", path.as_str())];
        match self.select_prayer(&path) {
            Ok(done) => notices.extend(done.notices),
            Err(notice) => notices.push(notice),
        }
        Ok(Done {
            value: path,
            notices,
        })
    }

    /// Default file name for "Export prayer JSON": `{id}.json`.
    pub fn prayer_json_file_name(&self, path: &str) -> String {
        let id = self
            .draft(path)
            .map(|d| d.prayer().id.clone())
            .or_else(|| self.catalog()?.entry(path)?.id.clone());
        id.map_or_else(|| basename(path).to_owned(), |id| prayer_filename(&id))
    }

    /// Writes the complete prayer JSON to `target` (chosen in a save dialog
    /// titled "Export prayer JSON"): the draft when it has unsaved changes,
    /// else the file's bytes. Errors: "Export failed". Notice: "Exported"
    /// with the path.
    pub fn export_prayer_json(&mut self, path: &str, target: &Path) -> SessionResult {
        let fail = |message: String| Notice::error("Export failed", message);
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| fail("No library is open".into()))?;
        let bytes = match self.drafts.get(path) {
            Some(open) if open.draft.is_dirty() => crate::fs::to_pretty_json(open.draft.prayer())
                .map_err(|e| fail(e.to_string()))?
                .into_bytes(),
            _ => library
                .root()
                .read_bytes(path)
                .map_err(|e| fail(e.to_string()))?,
        };
        write_atomic(target, &bytes).map_err(|e| fail(format!("{}: {e}", target.display())))?;
        Ok(Done::with_notice(
            (),
            Notice::info("Exported", target.display().to_string()),
        ))
    }

    // -- variant export (the Export dialog) ----------------------------------

    /// The prayer an export uses: the open draft (unsaved changes included,
    /// whether or not it validates), else the file, which must be valid
    /// ("Cannot export" / "Prayer is invalid.").
    fn prayer_for_export(&self, path: &str) -> Result<Prayer, ExportError> {
        if let Some(open) = self.drafts.get(path) {
            return Ok(open.draft.prayer().clone());
        }
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| ExportError::Write("No library is open".into()))?;
        let text = library
            .root()
            .read_text(path)
            .map_err(|e| ExportError::NotJson(e.to_string()))?;
        export::load_exportable(&text)
    }

    /// State of the Export dialog for a prayer: defaults from the Library and
    /// the options remembered after its last export. Errors: "Cannot
    /// export", "Export failed".
    pub fn export_defaults(&self, path: &str) -> Result<ExportDefaults, Notice> {
        let prayer = self.prayer_for_export(path).map_err(|e| e.notice())?;
        let library = self
            .library
            .as_ref()
            .ok_or_else(|| Notice::error("Export failed", "No library is open"))?;
        Ok(ExportDefaults::new(
            &prayer,
            library.manifest(),
            &self.resolved_styles(),
            self.prefs.export_prefs(&root_key(library), path),
        ))
    }

    /// Exports one Variant of the prayer to `target` and remembers the
    /// options for this prayer. Always uses the in-memory draft. Errors:
    /// "Cannot export", "Export failed" (the dialog stays open). Notice:
    /// "Exported" with the path.
    pub fn export_variant(
        &mut self,
        path: &str,
        request: &ExportRequest,
        target: &Path,
    ) -> SessionResult {
        let prayer = self.prayer_for_export(path).map_err(|e| e.notice())?;
        let output = export::export_prayer(&prayer, request).map_err(|e| e.notice())?;
        write_atomic(target, &output.bytes)
            .map_err(|e| ExportError::Write(format!("{}: {e}", target.display())).notice())?;
        if let Some(library) = self.library.as_ref() {
            let key = root_key(library);
            let patch = request.prefs_patch();
            self.update_prefs(|p| p.save_export_prefs(&key, path, patch));
        }
        Ok(Done::with_notice(
            (),
            Notice::info("Exported", target.display().to_string()),
        ))
    }

    // -- Library settings and styles ---------------------------------------

    /// Writes `manifest.json`. Notice "Library updated"; error "Could not
    /// save library settings" (the modal stays open).
    pub fn save_library_settings(&mut self, manifest: LibraryManifest) -> SessionResult {
        let library = self.library.as_mut().ok_or_else(|| {
            Notice::error("Could not save library settings", "No library is open")
        })?;
        library
            .save_manifest(manifest)
            .map_err(|e| Notice::error("Could not save library settings", e.to_string()))?;
        Ok(Done::with_notice(
            (),
            Notice::info("Library updated", "manifest.json saved"),
        ))
    }

    /// Validates and writes the Library Kind styles at once (outside undo).
    /// Error: "Cannot save library styles".
    pub fn set_library_styles(&mut self, styles: &StyleOverrides) -> SessionResult {
        let library = self
            .library
            .as_mut()
            .ok_or_else(|| Notice::error("Cannot save library styles", "No library is open"))?;
        library
            .save_styles(styles)
            .map_err(|e| Notice::error("Cannot save library styles", e.to_string()))?;
        Ok(Done::new(()))
    }

    // -- Kind rename and delete --------------------------------------------

    /// Asks to rename Kind `from` to `to`. Presets, an unchanged or invalid
    /// name are ignored; when more than one prayer uses the Kind the UI
    /// confirms first, otherwise it is renamed at once.
    pub fn request_kind_rename(
        &mut self,
        from: &str,
        to: &str,
    ) -> SessionResult<KindRenameRequest> {
        let to = to.trim();
        if self.library.is_none() || from == to || !is_valid_kind_id(to) || is_kind_preset(from) {
            return Ok(Done::new(KindRenameRequest::Ignored));
        }
        let plan = self.plan_kind_rename(from, to);
        if plan.affected.len() > 1 {
            return Ok(Done::new(KindRenameRequest::Confirm(plan)));
        }
        let done = self.apply_kind_rename(&plan)?;
        Ok(Done {
            value: KindRenameRequest::Applied(done.value),
            notices: done.notices,
        })
    }

    /// The prayers that use `from`: open drafts, scanned catalog entries and
    /// files the scan has not read yet (read now).
    pub fn plan_kind_rename(&self, from: &str, to: &str) -> KindRenamePlan {
        let mut affected: Vec<String> = Vec::new();
        let Some(library) = self.library.as_ref().filter(|_| !is_kind_preset(from)) else {
            return KindRenamePlan {
                from: from.to_owned(),
                to: to.to_owned(),
                affected,
            };
        };
        let uses = |prayer: &Prayer| prayer.structure.iter().any(|b| b.kind == from);
        for (path, open) in &self.drafts {
            if uses(open.draft.prayer()) {
                affected.push(path.clone());
            }
        }
        let catalog = library.catalog();
        for entry in catalog.entries_using_kind(from) {
            if !self.drafts.contains_key(&entry.path) {
                affected.push(entry.path.clone());
            }
        }
        for entry in catalog.entries() {
            if entry.is_scanned() || self.drafts.contains_key(&entry.path) {
                continue;
            }
            let read = library.root().read_text(&entry.path);
            if let Ok(prayer) = read
                .map_err(|_| ())
                .and_then(|t| parse_prayer(&t).map_err(|_| ()))
                && uses(&prayer)
            {
                affected.push(entry.path.clone());
            }
        }
        KindRenamePlan {
            from: from.to_owned(),
            to: to.to_owned(),
            affected,
        }
    }

    /// Renames the Kind across the Library: open drafts are edited in memory
    /// (undoable, left unsaved), other affected files are rewritten at once
    /// (files that cannot be read, validated or written are skipped and
    /// counted), and the Library style is renamed. Presets are never
    /// renamed. Notice "Kind renamed"; error "Kind rename failed".
    pub fn apply_kind_rename(&mut self, plan: &KindRenamePlan) -> SessionResult<KindRenameReport> {
        let (from, to) = (plan.from.as_str(), plan.to.as_str());
        let mut report = KindRenameReport {
            written: Vec::new(),
            drafts: Vec::new(),
            skipped: Vec::new(),
        };
        let Some(library) = self.library.as_mut() else {
            return Ok(Done::new(report));
        };
        if is_kind_preset(from) {
            return Ok(Done::new(report));
        }

        for (path, open) in &mut self.drafts {
            if open.draft.prayer().structure.iter().any(|b| b.kind == from) {
                open.draft
                    .edit_labeled(EditKind::Other, "Rename kind", |p| {
                        edit::rename_kind(p, from, to)
                    });
                report.drafts.push(path.clone());
            }
        }

        for path in plan
            .affected
            .iter()
            .filter(|p| !self.drafts.contains_key(*p))
        {
            let loaded = library
                .root()
                .read_text(path)
                .map_err(|e| e.to_string())
                .and_then(|text| parse_prayer(&text).map_err(|_| "invalid prayer JSON".to_owned()));
            let mut prayer = match loaded {
                Ok(prayer) => prayer,
                Err(reason) => {
                    report.skipped.push(SkippedFile {
                        path: path.clone(),
                        reason,
                    });
                    continue;
                }
            };
            edit::rename_kind(&mut prayer, from, to);
            match library.root().write_json(path, &prayer) {
                Ok(()) => {
                    library.catalog_mut().upsert_prayer(path, &prayer);
                    report.written.push(path.clone());
                }
                Err(e) => report.skipped.push(SkippedFile {
                    path: path.clone(),
                    reason: e.to_string(),
                }),
            }
        }

        let mut styles = library.styles().clone();
        if styles.contains_key(from) && from != to {
            if let Some(style) = styles.shift_remove(from) {
                styles.insert(to.to_owned(), style);
            }
            library
                .save_styles(&styles)
                .map_err(|e| Notice::error("Kind rename failed", e.to_string()))?;
        }

        let count = report.written.len() + report.drafts.len();
        let skipped = match report.skipped.len() {
            0 => String::new(),
            n => format!(" · {n} skipped"),
        };
        let notice = Notice::info(
            "Kind renamed",
            format!(
                "“{from}” → “{to}” in {count} prayer{}{skipped}",
                if count == 1 { "" } else { "s" }
            ),
        );
        Ok(Done::with_notice(report, notice))
    }

    /// Deletes a custom Kind: its Library style is removed at once and the
    /// Blocks of the selected prayer that use it become `verse` (`annotation`
    /// for `verse`; an undoable edit of the draft). Presets are never
    /// deleted. Returns the number of Blocks changed.
    pub fn delete_kind(&mut self, kind: &str) -> SessionResult<usize> {
        if is_kind_preset(kind) {
            return Ok(Done::new(0));
        }
        let Some(library) = self.library.as_mut() else {
            return Ok(Done::new(0));
        };
        let mut styles = library.styles().clone();
        if styles.shift_remove(kind).is_some() {
            library
                .save_styles(&styles)
                .map_err(|e| Notice::error("Cannot save library styles", e.to_string()))?;
        }
        let changed = self
            .edit_selected(EditKind::Other, |p| {
                edit::delete_kind(p, kind, edit::DEFAULT_DELETE_FALLBACK)
            })
            .unwrap_or(0);
        Ok(Done::new(changed))
    }

    // -- the folder watcher -------------------------------------------------

    /// Applies an outside change reported by the
    /// [`LibraryWatcher`](crate::watch::LibraryWatcher): the catalog is
    /// refreshed; open prayers without unsaved changes follow their file
    /// silently, the others enter "Changed on disk" / "Deleted on disk";
    /// `manifest.json` and the styles file are re-read. The report lists what
    /// changed so the UI can redraw and show notices.
    pub fn handle_watch_event(&mut self, event: &WatchEvent) -> WatchReport {
        let mut report = WatchReport::default();
        if self.library.is_none() {
            return report;
        }
        match event {
            WatchEvent::Rescan => {
                report.notices = self.refresh_now();
                report.rescanned = true;
            }
            WatchEvent::Created(path) | WatchEvent::Changed(path) => {
                self.on_file_present(path, &mut report);
            }
            WatchEvent::Removed(path) => {
                // Debounced events can be stale: a file that is back counts
                // as changed.
                let present = self
                    .library
                    .as_ref()
                    .is_some_and(|l| l.root().exists(path).unwrap_or(false));
                if present {
                    self.on_file_present(path, &mut report);
                } else {
                    self.on_file_gone(path, &mut report);
                }
            }
        }
        report
    }

    fn on_file_present(&mut self, path: &str, report: &mut WatchReport) {
        if path == MANIFEST_PATH || path == STYLES_PATH {
            self.reload_config(report);
            return;
        }
        if !is_prayer_filename(path) {
            return;
        }
        if let Some(library) = self.library.as_mut() {
            library.refresh_path(path);
        }
        if let Some(change) = self.reconcile_with_disk(path) {
            report.changes.push(DraftChange {
                path: path.to_owned(),
                change,
            });
        }
    }

    fn on_file_gone(&mut self, path: &str, report: &mut WatchReport) {
        if path == MANIFEST_PATH || path == STYLES_PATH {
            self.reload_config(report);
            return;
        }
        if !is_prayer_filename(path) {
            return;
        }
        if let Some(library) = self.library.as_mut() {
            library.catalog_mut().remove(path);
        }
        if let Some(change) = self.reconcile_with_disk(path) {
            report.changes.push(DraftChange {
                path: path.to_owned(),
                change,
            });
        }
    }

    fn reload_config(&mut self, report: &mut WatchReport) {
        let Some(library) = self.library.as_mut() else {
            return;
        };
        library.reload_config();
        report.config_reloaded = true;
        if let Some(message) = library.take_styles_notice() {
            report
                .notices
                .push(Notice::warning(STYLES_CLEANED_TITLE, message));
        }
    }

    /// Compares an open prayer (or the Invalid prayer screen) with its file.
    fn reconcile_with_disk(&mut self, path: &str) -> Option<DiskChange> {
        let library = self.library.as_ref()?;
        let read = library.root().read_text(path);

        if let Some(Selected::Invalid(invalid)) = &self.selected
            && invalid.path == path
        {
            return self.update_invalid_selection(path, read.ok());
        }

        let open = self.drafts.get_mut(path)?;
        let reaction = match read {
            Ok(text) => {
                let content = match parse_prayer(&text) {
                    Ok(prayer) => DiskContent::Valid(Box::new(prayer)),
                    Err(failure) => DiskContent::Invalid(failure.errors()),
                };
                open.draft.disk_changed(content)
            }
            Err(err) if err.is_not_found() => open.draft.disk_deleted(),
            // Unreadable for another reason: leave the draft as it is.
            Err(_) => return None,
        };
        match reaction {
            DiskReaction::Unchanged => None,
            DiskReaction::ReloadedSilently => Some(DiskChange::Reloaded),
            DiskReaction::NeedsDecision => Some(match open.draft.disk_state() {
                DiskState::DeletedOnDisk => DiskChange::DeletedOnDisk,
                _ => DiskChange::ChangedOnDisk,
            }),
            DiskReaction::CleanDeleted => {
                self.drafts.shift_remove(path);
                if self.selected_path() == Some(path) {
                    self.selected = None;
                }
                Some(DiskChange::Closed)
            }
        }
    }

    /// The selected file was invalid; it changed or vanished.
    fn update_invalid_selection(&mut self, path: &str, text: Option<String>) -> Option<DiskChange> {
        self.selected = None;
        let text = text?;
        match parse_prayer(&text) {
            Ok(prayer) => {
                let library = self.library.as_ref()?;
                let columns = initial_columns(&self.prefs, library, path, &prayer);
                self.drafts.insert(
                    path.to_owned(),
                    OpenPrayer {
                        draft: SessionDraft::new(path, prayer),
                        columns,
                    },
                );
                self.selected = Some(Selected::Draft(path.to_owned()));
            }
            Err(failure) => {
                let invalid_json = matches!(failure, ParseFailure::NotJson);
                self.selected = Some(Selected::Invalid(InvalidPrayer {
                    path: path.to_owned(),
                    invalid_json,
                    errors: failure.errors(),
                }));
            }
        }
        Some(DiskChange::SelectionUpdated)
    }

    fn reconcile_all_with_disk(&mut self) {
        let paths: Vec<String> = self.drafts.keys().cloned().collect();
        for path in paths {
            self.reconcile_with_disk(&path);
        }
        if let Some(Selected::Invalid(invalid)) = &self.selected {
            let path = invalid.path.clone();
            self.reconcile_with_disk(&path);
        }
    }
}

fn draft_row(
    path: &str,
    draft: &SessionDraft,
    preferred: Option<VariantKey<'_>>,
    scanned: bool,
) -> SidebarEntry {
    let prayer = draft.prayer();
    SidebarEntry {
        path: path.to_owned(),
        id: Some(prayer.id.clone()),
        title: Some(resolve_display_title(&prayer.id, &prayer.variants, preferred).to_owned()),
        description: prayer.description.clone(),
        valid: draft.is_valid(),
        errors: draft.errors().to_vec(),
        dirty: draft.is_dirty(),
        open: true,
        scanned,
    }
}

fn catalog_row(entry: &CatalogEntry, preferred: Option<VariantKey<'_>>) -> SidebarEntry {
    SidebarEntry {
        path: entry.path.clone(),
        id: entry.id.clone(),
        title: entry.display_title(preferred).map(str::to_owned),
        description: match &entry.status {
            EntryStatus::Valid(s) => s.description.clone(),
            _ => None,
        },
        valid: !matches!(
            entry.status,
            EntryStatus::InvalidJson | EntryStatus::InvalidSchema(_) | EntryStatus::Unreadable(_)
        ),
        errors: entry.errors(),
        dirty: false,
        open: false,
        scanned: entry.is_scanned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::{ExportTarget, LayoutExportOptions, LayoutFormat};
    use serde_json::json;

    fn prayer_value(id: &str, kinds: &[&str]) -> Value {
        json!({
            "id": id,
            "type": "prayer",
            "variants": [
                {"lang": "de", "variant": "standard", "title": format!("Titel {id}"),
                 "license": "CC0", "source": "x"},
                {"lang": "en", "variant": "standard", "title": format!("Title {id}"),
                 "license": "CC0", "source": "y"}
            ],
            "structure": kinds.iter().enumerate().map(|(i, k)| json!({
                "id": format!("b{}", i + 1), "kind": k,
                "translations": [{"lang": "de", "variant": "standard", "text": format!("Text {i}")}]
            })).collect::<Vec<_>>()
        })
    }

    struct Env {
        dir: tempfile::TempDir,
        session: Session,
    }

    impl Env {
        /// A Library with the given (id, kinds) prayers and a Session with
        /// it open and fully scanned.
        fn with(prayers: &[(&str, &[&str])]) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let lib = dir.path().join("lib");
            std::fs::create_dir(&lib).unwrap();
            for (id, kinds) in prayers {
                write(&lib, &format!("{id}.json"), &prayer_value(id, kinds));
            }
            let mut session = Session::new(Prefs::default(), Some(dir.path().join("prefs.json")));
            session.open_library(&lib).unwrap();
            session.scan_all();
            Self { dir, session }
        }

        fn lib(&self) -> PathBuf {
            self.dir.path().join("lib")
        }

        fn read(&self, name: &str) -> String {
            std::fs::read_to_string(self.lib().join(name)).unwrap()
        }

        fn select(&mut self, path: &str) -> SelectOutcome {
            self.session.select_prayer(path).unwrap().value
        }

        fn type_text(&mut self, text: &str) {
            let path = self.session.selected_path().unwrap().to_owned();
            let block = self.session.selected_draft().unwrap().prayer().structure[0]
                .id
                .clone();
            self.session.edit_selected(EditKind::Typing, |p| {
                edit::set_block_content(
                    p,
                    &block,
                    VariantKey {
                        lang: "de",
                        variant: "standard",
                    },
                    &edit::EditorContent::Text(text.into()),
                );
            });
            assert!(self.session.draft(&path).unwrap().is_dirty());
        }
    }

    fn write(dir: &Path, name: &str, value: &Value) {
        std::fs::write(
            dir.join(name),
            serde_json::to_string_pretty(value).unwrap() + "\n",
        )
        .unwrap();
    }

    fn titles(notices: &[Notice]) -> Vec<&str> {
        notices.iter().map(|n| n.title.as_str()).collect()
    }

    fn err_of<T: fmt::Debug>(result: SessionResult<T>) -> Notice {
        result.unwrap_err()
    }

    // -- Library: open, recent, create, refresh (checklist 3) ---------------

    // Checklist 3: opening records the Library in recent, newest first.
    #[test]
    fn open_library_records_recent() {
        let env = Env::with(&[("a", &["verse"])]);
        let recent = &env.session.prefs().recent_libraries;
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].label(), "lib");
        // Persisted to the prefs file.
        let saved = Prefs::load_from(&env.dir.path().join("prefs.json"));
        assert_eq!(saved.recent_libraries.len(), 1);
        assert_eq!(env.session.library().unwrap().folder_name(), "lib");
    }

    // Checklist 3: a missing folder: "Could not open library", forgotten.
    #[test]
    fn open_missing_library_fails_and_forgets_recent() {
        let mut env = Env::with(&[]);
        let gone = env.dir.path().join("gone");
        env.session
            .update_prefs(|p| p.push_recent(&gone.to_string_lossy(), 1));
        let notice = err_of(env.session.open_library(&gone));
        assert_eq!(notice.title, "Could not open library");
        assert_eq!(notice.message, "Folder not found");
        assert_eq!(notice.level, NoticeLevel::Error);
        assert!(
            !env.session
                .prefs()
                .recent_libraries
                .iter()
                .any(|r| r.path == gone.to_string_lossy())
        );
        assert!(env.session.library().is_some(), "old Library stays open");
    }

    // Checklist 3: new Library flow and its notices.
    #[test]
    fn create_library_writes_manifest_and_opens() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = Session::new(Prefs::default(), None);
        let spec = NewLibrary {
            name: "fresh".into(),
            description: "Hi".into(),
            ..NewLibrary::default()
        };
        let done = session.create_library(dir.path(), &spec).unwrap();
        assert_eq!(titles(&done.notices), ["Library created"]);
        assert_eq!(done.notices[0].message, "manifest.json written");
        assert!(matches!(done.value, ActionOutcome::Performed(_)));
        let library = session.library().unwrap();
        assert_eq!(
            library.manifest().unwrap().description.as_deref(),
            Some("Hi")
        );

        let again = err_of(session.create_library(dir.path(), &spec));
        assert_eq!(again.title, "Could not create library");
        assert_eq!(again.message, "Folder already exists: fresh");
        let bad = err_of(session.create_library(
            dir.path(),
            &NewLibrary {
                name: "a/b".into(),
                ..NewLibrary::default()
            },
        ));
        assert_eq!(bad.message, "Library name cannot contain path separators");
    }

    // Checklist 3: Refresh rescans, keeps the selection and open drafts.
    #[test]
    fn refresh_keeps_selection_and_clean_drafts() {
        let mut env = Env::with(&[("a", &["verse"]), ("b", &["verse"])]);
        env.select("a.json");
        env.select("b.json");
        write(&env.lib(), "c.json", &prayer_value("c", &["verse"]));
        let done = env.session.refresh().unwrap();
        assert_eq!(done.value, ActionOutcome::Performed(PendingAction::Refresh));
        assert!(env.session.pending_action().is_none());
        assert_eq!(env.session.selected_path(), Some("b.json"));
        assert_eq!(env.session.catalog().unwrap().entries().len(), 3);
        assert!(!env.session.catalog().unwrap().scan_complete());
        env.session.scan_all();
        assert!(env.session.catalog().unwrap().scan_complete());
    }

    // Checklist 3 + 6: Refresh with a dirty draft goes through the dialog.
    #[test]
    fn refresh_with_dirty_draft_asks_first() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.type_text("changed");
        let done = env.session.refresh().unwrap();
        assert_eq!(done.value, ActionOutcome::NeedsDecision);
        assert_eq!(env.session.pending_action(), Some(&PendingAction::Refresh));
    }

    // Checklist 3: Refresh re-reads open prayers from disk.
    #[test]
    fn refresh_updates_clean_drafts_and_flags_dirty_ones() {
        let mut env = Env::with(&[("a", &["verse"]), ("b", &["verse"])]);
        env.select("a.json");
        env.select("b.json");
        env.type_text("mine");
        write(
            &env.lib(),
            "a.json",
            &prayer_value("a", &["verse", "heading"]),
        );
        write(&env.lib(), "b.json", &prayer_value("b", &["heading"]));
        // Dirty draft b blocks the plain Refresh; discard decision keeps going.
        env.session.refresh().unwrap();
        let done = env
            .session
            .resolve_unsaved(UnsavedChoice::DiscardAll)
            .unwrap();
        assert!(matches!(
            done.value,
            ActionOutcome::Performed(PendingAction::Refresh)
        ));
        // b was dirty: dropped and (as the selected one) reopened from disk.
        assert_eq!(env.session.selected_path(), Some("b.json"));
        let b = env.session.selected_draft().unwrap();
        assert!(!b.is_dirty());
        assert_eq!(b.prayer().structure[0].kind, "heading");
        // a was clean: follows the file.
        assert_eq!(
            env.session
                .draft("a.json")
                .unwrap()
                .prayer()
                .structure
                .len(),
            2
        );
    }

    // Checklist 3: switching Library resets drafts and selection.
    #[test]
    fn switching_library_resets_session() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        let other = env.dir.path().join("other");
        std::fs::create_dir(&other).unwrap();
        env.session.open_library(&other).unwrap();
        assert!(env.session.selected_path().is_none());
        assert_eq!(env.session.open_paths().count(), 0);
        assert_eq!(env.session.prefs().recent_libraries.len(), 2);
        assert_eq!(env.session.prefs().recent_libraries[0].label(), "other");
        assert!(env.session.close_library());
        assert!(env.session.library().is_none());
    }

    // Checklist 3: styles cleaned toast on open.
    #[test]
    fn open_reports_cleaned_styles_once() {
        let dir = tempfile::tempdir().unwrap();
        let tk = dir.path().join(".orthodox-prayer-toolkit");
        std::fs::create_dir(&tk).unwrap();
        std::fs::write(
            tk.join("styles.json"),
            r##"{"verse": {"fontSize": "bogus"}}"##,
        )
        .unwrap();
        let mut session = Session::new(Prefs::default(), None);
        let done = session.open_library(dir.path()).unwrap();
        assert_eq!(titles(&done.notices), ["Library styles cleaned"]);
    }

    // Checklist 8: duplicate ids reported once when they first appear.
    #[test]
    fn duplicate_ids_reported_once() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.json", &prayer_value("same", &["verse"]));
        write(dir.path(), "b.json", &prayer_value("same", &["verse"]));
        write(dir.path(), "c.json", &prayer_value("other", &["verse"]));
        let mut session = Session::new(Prefs::default(), None);
        session.open_library(dir.path()).unwrap();
        let first = session.scan_step(2);
        let rest = session.scan_step(25);
        let mut all = first.notices;
        all.extend(rest.notices);
        assert_eq!(titles(&all), ["Duplicate prayer ids"]);
        assert_eq!(all[0].message, "same: a.json, b.json");
        assert_eq!(all[0].level, NoticeLevel::Warning);
        assert_eq!(session.collisions().len(), 1);
        assert!(session.scan_step(25).complete);
    }

    // -- select (checklist 5, 7) -------------------------------------------

    // Checklist 5: selecting a valid prayer opens a draft; re-select no-op.
    #[test]
    fn select_valid_prayer_opens_draft() {
        let mut env = Env::with(&[("a", &["verse"])]);
        let done = env.session.select_prayer("a.json").unwrap();
        assert_eq!(done.value, SelectOutcome::Opened);
        assert!(done.notices.is_empty());
        assert_eq!(env.session.selected_path(), Some("a.json"));
        assert!(!env.session.selected_draft().unwrap().is_dirty());
        // Library default absent: first Variant is the only column.
        assert_eq!(
            env.session.visible_variants(),
            [VariantRef::new("de", "standard")]
        );
        assert_eq!(
            env.session.select_prayer("a.json").unwrap().value,
            SelectOutcome::Unchanged
        );
    }

    // Checklist 7: schema-invalid file: Invalid screen without a toast.
    #[test]
    fn select_schema_invalid_prayer() {
        let mut env = Env::with(&[]);
        std::fs::write(env.lib().join("bad.json"), r#"{"id": "bad"}"#).unwrap();
        env.session.library.as_mut().unwrap().rescan();
        env.session.scan_all();
        let done = env.session.select_prayer("bad.json").unwrap();
        let SelectOutcome::Invalid {
            invalid_json,
            errors,
        } = &done.value
        else {
            panic!("expected Invalid, got {:?}", done.value);
        };
        assert!(!invalid_json);
        assert!(!errors.is_empty());
        assert!(done.notices.is_empty());
        assert_eq!(env.session.selected_invalid().unwrap().path, "bad.json");
        assert!(env.session.selected_draft().is_none());
        let row = &env.session.sidebar_entries("")[0];
        assert!(!row.valid);
    }

    // Checklist 5: broken JSON: "Invalid JSON" toast + Invalid screen.
    #[test]
    fn select_bad_json_toasts() {
        let mut env = Env::with(&[]);
        std::fs::write(env.lib().join("bad.json"), "{nope").unwrap();
        env.session.library.as_mut().unwrap().rescan();
        let done = env.session.select_prayer("bad.json").unwrap();
        assert!(matches!(
            done.value,
            SelectOutcome::Invalid {
                invalid_json: true,
                ..
            }
        ));
        assert_eq!(done.notices, [Notice::error("Invalid JSON", "bad.json")]);
        assert_eq!(
            env.session.selected_invalid().unwrap().errors[0].message,
            "Invalid JSON"
        );
        // Re-selecting is a no-op, without a second toast.
        let again = env.session.select_prayer("bad.json").unwrap();
        assert_eq!(again.value, SelectOutcome::Unchanged);
        assert!(again.notices.is_empty());
    }

    #[test]
    fn select_missing_file_is_could_not_open() {
        let mut env = Env::with(&[("a", &["verse"])]);
        let notice = err_of(env.session.select_prayer("nope.json"));
        assert_eq!(notice.title, "Could not open prayer");
    }

    // Decided change: drafts (and undo) survive switching prayers.
    #[test]
    fn drafts_survive_switching_with_undo() {
        let mut env = Env::with(&[("a", &["verse"]), ("b", &["verse"])]);
        env.select("a.json");
        env.type_text("edited");
        env.select("b.json");
        assert_eq!(env.session.open_paths().count(), 2);
        assert_eq!(
            env.session.dirty_drafts(),
            [DirtyDraft {
                path: "a.json".into(),
                id: "a".into()
            }]
        );
        env.select("a.json");
        assert!(env.session.selected_draft().unwrap().can_undo());
        assert!(env.session.selected_draft_mut().unwrap().undo());
        assert!(!env.session.selected_draft().unwrap().is_dirty());
        // Clean drafts are kept too.
        env.select("b.json");
        assert_eq!(env.session.open_paths().count(), 2);
    }

    // Checklist 4/9: sidebar overlays live draft state.
    #[test]
    fn sidebar_overlays_draft_title_id_and_dirty_dot() {
        let mut env = Env::with(&[("a", &["verse"]), ("b", &["verse"])]);
        env.select("a.json");
        env.session.edit_selected(EditKind::Other, |p| {
            edit::update_variant_meta(
                p,
                0,
                &edit::VariantMetaPatch {
                    title: Some("Neu".into()),
                    ..Default::default()
                },
            );
            edit::set_id(p, "renamed");
        });
        let rows = env.session.sidebar_entries("");
        let row = rows.iter().find(|r| r.path == "a.json").unwrap();
        assert_eq!(row.id.as_deref(), Some("renamed"));
        assert_eq!(row.title.as_deref(), Some("Neu"));
        assert!(row.dirty && row.open && row.valid);
        let other = rows.iter().find(|r| r.path == "b.json").unwrap();
        assert!(!other.dirty);
        assert_eq!(other.title.as_deref(), Some("Titel b"));
        let found = env.session.sidebar_entries("neu");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].path, "a.json");
    }

    // -- columns (checklist 9) ---------------------------------------------

    // Checklist 15: manifest default variant drives initial columns.
    #[test]
    fn initial_column_uses_library_default() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.session
            .save_library_settings(LibraryManifest {
                default_variant: Some(prayer_core::DefaultVariant {
                    lang: "en".into(),
                    variant: "standard".into(),
                }),
                ..Default::default()
            })
            .unwrap();
        env.select("a.json");
        assert_eq!(
            env.session.visible_variants(),
            [VariantRef::new("en", "standard")]
        );
    }

    // Checklist 9: column set persisted per prayer path per library.
    #[test]
    fn columns_persist_and_reconcile() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        let both = vec![
            VariantRef::new("en", "standard"),
            VariantRef::new("de", "standard"),
        ];
        env.session.set_visible_variants(both.clone());
        assert_eq!(env.session.visible_variants(), both);
        env.session
            .set_visible_variants(vec![VariantRef::new("xx", "none")]);
        assert_eq!(
            env.session.visible_variants(),
            both,
            "unknown columns ignored"
        );
        env.session
            .set_active_variant(VariantRef::new("de", "standard"));
        assert_eq!(
            env.session.visible_variants()[0],
            VariantRef::new("de", "standard")
        );

        // A new Session over the same prefs file restores them.
        let prefs = Prefs::load_from(&env.dir.path().join("prefs.json"));
        let mut again = Session::new(prefs, None);
        again.open_library(env.lib()).unwrap();
        again.select_prayer("a.json").unwrap();
        assert_eq!(
            again.visible_variants()[0],
            VariantRef::new("de", "standard")
        );
        assert_eq!(again.visible_variants().len(), 2);

        // Removing a Variant reconciles the columns.
        env.session.edit_selected(EditKind::Other, |p| {
            edit::remove_variant(p, 1);
        });
        assert_eq!(
            env.session.visible_variants(),
            [VariantRef::new("de", "standard")]
        );
    }

    // Checklist 13: editing lang keeps the active column.
    #[test]
    fn variant_rename_keeps_column() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        let renamed = env
            .session
            .edit_selected(EditKind::Other, |p| {
                edit::update_variant_meta(
                    p,
                    0,
                    &edit::VariantMetaPatch {
                        variant: Some("alt".into()),
                        ..Default::default()
                    },
                )
            })
            .unwrap()
            .unwrap();
        env.session.apply_variant_rename(&renamed);
        assert_eq!(
            env.session.visible_variants(),
            [VariantRef::new("de", "alt")]
        );
    }

    // -- create (checklist 5) ------------------------------------------------

    // Checklist 5: first free new-prayer-N, template, create, select.
    #[test]
    fn create_prayer_flow() {
        let mut env = Env::with(&[("new-prayer-1", &["verse"])]);
        let form = env.session.begin_create().unwrap();
        assert_eq!(form.id, "new-prayer-2");
        assert_eq!(form.prayer_type, "prayer");
        assert_eq!(form.title, "Unbenannt");
        assert_eq!(
            (form.lang.as_str(), form.variant.as_str()),
            ("de", "standard")
        );
        assert_eq!(
            (form.license.as_str(), form.source.as_str()),
            ("unknown", "draft")
        );

        let done = env.session.create_prayer(&form).unwrap();
        assert_eq!(done.value, "new-prayer-2.json");
        assert_eq!(done.notices, [Notice::info("Created", "new-prayer-2.json")]);
        let text = env.read("new-prayer-2.json");
        assert!(text.ends_with("}\n"));
        assert!(text.contains("\"tone\": null"));
        assert!(text.contains("\"kind\": \"verse\""));
        assert!(!text.contains("description"));
        assert_eq!(env.session.selected_path(), Some("new-prayer-2.json"));
        assert!(!env.session.selected_draft().unwrap().is_dirty());
        assert_eq!(
            env.session.visible_variants(),
            [VariantRef::new("de", "standard")]
        );
        assert!(
            env.session
                .catalog()
                .unwrap()
                .entry("new-prayer-2.json")
                .unwrap()
                .is_valid()
        );
        assert_eq!(env.session.begin_create().unwrap().id, "new-prayer-3");
    }

    // Checklist 5: schema failure "Cannot create"; collision "Id collision".
    #[test]
    fn create_prayer_refusals() {
        let mut env = Env::with(&[("taken", &["verse"])]);
        let mut form = NewPrayerForm::new("");
        let notice = err_of(env.session.create_prayer(&form));
        assert_eq!(notice.title, "Cannot create");
        assert!(!notice.message.is_empty());

        form.id = "taken".into();
        let notice = err_of(env.session.create_prayer(&form));
        assert_eq!(notice.title, "Id collision");
        assert_eq!(
            notice.message,
            "File taken.json already exists. Choose another id."
        );
        assert!(
            env.read("taken.json").contains("Titel taken"),
            "not overwritten"
        );

        form.id = "fine".into();
        form.description = "About".into();
        form.tone = Some(3);
        form.book = "Horologion".into();
        env.session.create_prayer(&form).unwrap();
        let prayer = env.session.selected_draft().unwrap().prayer();
        assert_eq!(prayer.description.as_deref(), Some("About"));
        assert_eq!(prayer.tone, Some(Some(3)));
        assert_eq!(prayer.book.as_deref(), Some("Horologion"));
        assert_eq!(prayer.occasion, None);
    }

    // -- save (checklist 5) ----------------------------------------------------

    // Checklist 5: edit then save writes JSON + newline, clears dirty.
    #[test]
    fn edit_and_save() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.type_text("neu");
        let done = env.session.save_selected().unwrap();
        assert_eq!(done.value, "a.json");
        assert_eq!(done.notices, [Notice::info("Saved", "a.json")]);
        assert!(env.read("a.json").contains("neu"));
        assert!(env.read("a.json").ends_with("}\n"));
        let draft = env.session.selected_draft().unwrap();
        assert!(!draft.is_dirty());
        assert!(draft.can_undo(), "history survives saving");
        assert!(!env.session.has_unsaved());
    }

    // Checklist 5: validation errors block saving.
    #[test]
    fn save_blocked_by_validation_errors() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.session
            .edit_selected(EditKind::Other, |p| p.variants.clear());
        let notice = err_of(env.session.save_selected());
        assert_eq!(notice.title, "Cannot save");
        assert_eq!(notice.message, "“a”: fix validation errors first.");
        assert!(env.read("a.json").contains("Titel a"));
        assert!(env.session.selected_draft().unwrap().is_dirty());
    }

    // Checklist 5: rename by id: write new, delete old; view prefs move.
    #[test]
    fn rename_by_id_moves_file_and_prefs() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.session.set_visible_variants(vec![
            VariantRef::new("en", "standard"),
            VariantRef::new("de", "standard"),
        ]);
        env.session
            .edit_selected(EditKind::Other, |p| edit::set_id(p, "b"));
        let done = env.session.save_selected().unwrap();
        assert_eq!(done.value, "b.json");
        assert_eq!(done.notices, [Notice::info("Saved", "b.json")]);
        assert!(!env.lib().join("a.json").exists());
        assert!(env.lib().join("b.json").exists());
        assert_eq!(env.session.selected_path(), Some("b.json"));
        assert!(env.session.draft("a.json").is_none());
        assert!(env.session.catalog().unwrap().entry("a.json").is_none());
        assert!(env.session.catalog().unwrap().entry("b.json").is_some());
        let root = env.lib().to_string_lossy().into_owned();
        let prefs = env.session.prefs();
        assert!(prefs.prayer_view(&root, "a.json").is_none());
        assert_eq!(prefs.prayer_view(&root, "b.json").unwrap().len(), 2);
        assert_eq!(
            env.session.visible_variants()[0],
            VariantRef::new("en", "standard")
        );
    }

    // Checklist 5: rename collision blocks the save; nothing overwritten.
    #[test]
    fn rename_collision_blocks_save() {
        let mut env = Env::with(&[("a", &["verse"]), ("b", &["verse"])]);
        env.select("a.json");
        env.session
            .edit_selected(EditKind::Other, |p| edit::set_id(p, "b"));
        let notice = err_of(env.session.save_selected());
        assert_eq!(notice.title, "Cannot save");
        assert_eq!(notice.message, "Id collision: b.json already exists.");
        assert!(env.read("b.json").contains("Titel b"));
        assert!(env.lib().join("a.json").exists());
        assert!(env.session.selected_draft().unwrap().is_dirty());
    }

    // Checklist 5/6: Save All order, failure message, success message.
    #[test]
    fn save_all_success_and_failure() {
        let mut env = Env::with(&[("a", &["verse"]), ("b", &["verse"]), ("c", &["verse"])]);
        env.select("a.json");
        env.type_text("one");
        env.select("b.json");
        env.type_text("two");
        let done = env.session.save_all().unwrap();
        assert_eq!(done.notices, [Notice::info("Saved", "2 prayers saved")]);
        assert!(!env.session.has_unsaved());
        assert!(env.read("b.json").contains("two"));

        env.select("a.json");
        env.type_text("three");
        assert_eq!(
            env.session.save_all().unwrap().notices,
            [Notice::info("Saved", "1 prayer saved")]
        );
        assert!(
            env.session.save_all().unwrap().notices.is_empty(),
            "nothing dirty"
        );

        // A failure stops and keeps what was saved.
        env.select("a.json");
        env.type_text("four");
        env.select("b.json");
        env.session
            .edit_selected(EditKind::Other, |p| edit::set_id(p, "c"));
        env.select("c.json");
        env.type_text("five");
        let notice = err_of(env.session.save_all());
        assert_eq!(notice.title, "Cannot save all");
        assert_eq!(notice.message, "Id collision: c.json already exists.");
        assert!(env.read("a.json").contains("four"), "first one was saved");
        assert!(!env.read("c.json").contains("five"));
        assert_eq!(env.session.dirty_drafts().len(), 2);
    }

    // -- unsaved changes (checklist 6) -----------------------------------------

    // Checklist 6: no dirty drafts: actions happen at once.
    #[test]
    fn clean_session_performs_actions_directly() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        let done = env.session.request(PendingAction::CloseWindow).unwrap();
        assert_eq!(
            done.value,
            ActionOutcome::Performed(PendingAction::CloseWindow)
        );
        let done = env.session.request(PendingAction::InstallUpdate).unwrap();
        assert_eq!(
            done.value,
            ActionOutcome::Performed(PendingAction::InstallUpdate)
        );
    }

    // Checklist 6: pending action waits, Cancel leaves everything.
    #[test]
    fn cancel_leaves_everything() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.type_text("x");
        let done = env.session.request(PendingAction::CloseWindow).unwrap();
        assert_eq!(done.value, ActionOutcome::NeedsDecision);
        assert_eq!(
            env.session.pending_action(),
            Some(&PendingAction::CloseWindow)
        );
        let done = env.session.resolve_unsaved(UnsavedChoice::Cancel).unwrap();
        assert_eq!(done.value, ActionOutcome::Cancelled);
        assert!(env.session.pending_action().is_none());
        assert!(env.session.has_unsaved());
        // Resolving with nothing pending does nothing.
        assert_eq!(
            env.session
                .resolve_unsaved(UnsavedChoice::DiscardAll)
                .unwrap()
                .value,
            ActionOutcome::Cancelled
        );
        assert!(env.session.has_unsaved());
    }

    // Checklist 6: Save all then continues; stops when a save fails.
    #[test]
    fn save_all_then_continue_or_stop() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.type_text("saved");
        env.session.request(PendingAction::CloseWindow).unwrap();
        let done = env.session.resolve_unsaved(UnsavedChoice::SaveAll).unwrap();
        assert_eq!(
            done.value,
            ActionOutcome::Performed(PendingAction::CloseWindow)
        );
        assert_eq!(done.notices, [Notice::info("Saved", "1 prayer saved")]);
        assert!(env.read("a.json").contains("saved"));
        assert!(env.session.pending_action().is_none());

        // Failure: still pending.
        env.type_text("again");
        env.session
            .edit_selected(EditKind::Other, |p| p.variants.clear());
        env.session.request(PendingAction::InstallUpdate).unwrap();
        let notice = err_of(env.session.resolve_unsaved(UnsavedChoice::SaveAll));
        assert_eq!(notice.title, "Cannot save all");
        assert_eq!(
            env.session.pending_action(),
            Some(&PendingAction::InstallUpdate)
        );
    }

    // Checklist 6: Discard all drops unsaved changes and goes on, e.g.
    // opening the other Library.
    #[test]
    fn discard_all_then_open_library() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.type_text("lost");
        let other = env.dir.path().join("other");
        std::fs::create_dir(&other).unwrap();
        let done = env.session.open_library(&other).unwrap();
        assert_eq!(done.value, ActionOutcome::NeedsDecision);
        assert_eq!(env.session.library().unwrap().folder_name(), "lib");
        let done = env
            .session
            .resolve_unsaved(UnsavedChoice::DiscardAll)
            .unwrap();
        assert!(matches!(
            done.value,
            ActionOutcome::Performed(PendingAction::OpenLibrary(_))
        ));
        assert_eq!(env.session.library().unwrap().folder_name(), "other");
        assert!(!env.session.has_unsaved());
        assert!(env.read("a.json").contains("Text 0"), "disk untouched");
    }

    // Checklist 3: opening a gone folder is refused before the dialog.
    #[test]
    fn open_gone_folder_does_not_ask() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.type_text("x");
        let notice = err_of(env.session.open_library(env.dir.path().join("gone")));
        assert_eq!(notice.title, "Could not open library");
        assert!(env.session.pending_action().is_none());
        assert!(!env.session.close_library(), "dirty: refused");
    }

    // Checklist 6: discarding one draft re-reads a selected prayer.
    #[test]
    fn discard_single_draft_reopens_from_disk() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.type_text("lost");
        env.session.discard("a.json").unwrap();
        assert_eq!(env.session.selected_path(), Some("a.json"));
        let draft = env.session.selected_draft().unwrap();
        assert!(!draft.is_dirty() && !draft.can_undo());
        env.session.discard("zzz.json").unwrap();
        env.type_text("again");
        env.session.discard_all();
        assert!(!env.session.has_unsaved());
        assert_eq!(env.session.selected_path(), Some("a.json"));
    }

    // -- delete (checklist 5) ---------------------------------------------------

    // Checklist 5: delete removes file, prefs, catalog row, draft, selection.
    #[test]
    fn delete_prayer_removes_everything() {
        let mut env = Env::with(&[("a", &["verse"]), ("b", &["verse"])]);
        env.select("a.json");
        env.session
            .set_visible_variants(vec![VariantRef::new("en", "standard")]);
        let done = env.session.delete_prayer("a.json").unwrap();
        assert_eq!(done.notices, [Notice::info("Deleted", "a.json")]);
        assert!(!env.lib().join("a.json").exists());
        assert!(env.session.draft("a.json").is_none());
        assert!(env.session.selected_path().is_none());
        assert!(env.session.catalog().unwrap().entry("a.json").is_none());
        let root = env.lib().to_string_lossy().into_owned();
        assert!(env.session.prefs().prayer_view(&root, "a.json").is_none());
        assert_eq!(env.session.catalog().unwrap().entries().len(), 1);
    }

    // Checklist 7: invalid prayers can be deleted too.
    #[test]
    fn delete_invalid_prayer() {
        let mut env = Env::with(&[]);
        std::fs::write(env.lib().join("bad.json"), "{nope").unwrap();
        env.session.library.as_mut().unwrap().rescan();
        env.session.select_prayer("bad.json").unwrap();
        env.session.delete_prayer("bad.json").unwrap();
        assert!(env.session.selected_path().is_none());
        assert!(!env.lib().join("bad.json").exists());
    }

    // -- import / export prayer JSON (checklist 5, 8) ---------------------------

    fn external(env: &Env, name: &str, text: &str) -> PathBuf {
        let path = env.dir.path().join(name);
        std::fs::write(&path, text).unwrap();
        path
    }

    // Checklist 5: import copies bytes unchanged under `{id}.json` and opens.
    #[test]
    fn import_copies_bytes_and_opens() {
        let mut env = Env::with(&[]);
        let text = "{\"id\":\"imported\",\"type\":\"prayer\",\"variants\":[{\"lang\":\"de\",\"variant\":\"standard\",\"title\":\"T\",\"license\":\"l\",\"source\":\"s\"}],\"structure\":[{\"id\":\"b1\",\"kind\":\"verse\",\"translations\":[]}]}";
        let src = external(&env, "whatever.json", text);
        let done = env.session.import_prayer(&src).unwrap();
        assert_eq!(done.value, "imported.json");
        assert_eq!(titles(&done.notices), ["Imported"]);
        assert_eq!(done.notices[0].message, "imported.json");
        assert_eq!(env.read("imported.json"), text, "bytes unchanged");
        assert_eq!(env.session.selected_path(), Some("imported.json"));
        assert!(env.session.selected_draft().is_some());
    }

    // Checklist 5: no id: the source name is kept; bad JSON opens invalid.
    #[test]
    fn import_without_id_and_bad_json() {
        let mut env = Env::with(&[]);
        let src = external(&env, "mine.json", "{nope");
        let done = env.session.import_prayer(&src).unwrap();
        assert_eq!(done.value, "mine.json");
        assert_eq!(titles(&done.notices), ["Imported", "Invalid JSON"]);
        assert_eq!(env.session.selected_invalid().unwrap().path, "mine.json");

        let src = external(&env, "manifest.json", "{}");
        let notice = err_of(env.session.import_prayer(&src));
        assert_eq!(notice.title, "Cannot import");
        assert_eq!(
            notice.message,
            "Cannot import “manifest.json” as a prayer file."
        );
        let src = external(&env, "notes.txt", "x");
        assert_eq!(
            err_of(env.session.import_prayer(&src)).title,
            "Cannot import"
        );
        let missing = env.dir.path().join("missing.json");
        assert_eq!(
            err_of(env.session.import_prayer(&missing)).title,
            "Import failed"
        );
    }

    // Checklist 5/8: import collisions by path, by id and on disk.
    #[test]
    fn import_collisions_never_overwrite() {
        let mut env = Env::with(&[("a", &["verse"])]);
        let before = env.read("a.json");
        let same_id = serde_json::to_string(&prayer_value("a", &["heading"])).unwrap();
        let src = external(&env, "x.json", &same_id);
        let notice = err_of(env.session.import_prayer(&src));
        assert_eq!(notice.title, "Id collision");
        assert_eq!(notice.message, "“a” already exists as a.json.");
        assert_eq!(env.read("a.json"), before);

        // Same id claimed by a differently named file.
        std::fs::rename(env.lib().join("a.json"), env.lib().join("other-name.json")).unwrap();
        env.session.library.as_mut().unwrap().rescan();
        env.session.scan_all();
        let notice = err_of(env.session.import_prayer(&src));
        assert_eq!(notice.message, "“a” already exists as other-name.json.");

        // A file on disk the catalog does not know yet.
        std::fs::write(env.lib().join("late.json"), "{}").unwrap();
        let late = external(
            &env,
            "late-src.json",
            &serde_json::to_string(&prayer_value("late", &["verse"])).unwrap(),
        );
        let notice = err_of(env.session.import_prayer(&late));
        assert_eq!(notice.message, "File late.json already exists.");
        assert_eq!(env.read("late.json"), "{}");
    }

    // Checklist 5: export JSON: dirty draft vs disk bytes, default name.
    #[test]
    fn export_prayer_json_draft_or_disk() {
        let mut env = Env::with(&[("a", &["verse"])]);
        let target = env.dir.path().join("out.json");
        // Not open: disk bytes exactly.
        env.session.export_prayer_json("a.json", &target).unwrap();
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            env.read("a.json")
        );
        // Clean draft: still the disk bytes.
        env.select("a.json");
        env.session.export_prayer_json("a.json", &target).unwrap();
        assert_eq!(
            std::fs::read_to_string(&target).unwrap(),
            env.read("a.json")
        );
        // Dirty draft: the unsaved prayer.
        env.type_text("unsaved text");
        let done = env.session.export_prayer_json("a.json", &target).unwrap();
        assert_eq!(
            done.notices,
            [Notice::info("Exported", target.display().to_string())]
        );
        let exported = std::fs::read_to_string(&target).unwrap();
        assert!(exported.contains("unsaved text") && exported.ends_with("}\n"));
        assert!(!env.read("a.json").contains("unsaved text"));
        assert_eq!(env.session.prayer_json_file_name("a.json"), "a.json");

        let notice = err_of(env.session.export_prayer_json("gone.json", &target));
        assert_eq!(notice.title, "Export failed");
    }

    // -- variant export (checklist 16) ---------------------------------------------

    fn flat(lang: &str) -> ExportRequest {
        ExportRequest {
            variant: VariantRef::new(lang, "standard"),
            include_blocks_without_translation: false,
            target: ExportTarget::FlatJson,
        }
    }

    // Checklist 16: export always uses the in-memory draft; prefs remembered.
    #[test]
    fn export_variant_uses_draft_and_remembers_options() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.type_text("draft only");
        let target = env.dir.path().join("a.de.standard.flat.json");
        let mut request = flat("de");
        request.include_blocks_without_translation = true;
        let done = env
            .session
            .export_variant("a.json", &request, &target)
            .unwrap();
        assert_eq!(done.notices[0].title, "Exported");
        assert!(
            std::fs::read_to_string(&target)
                .unwrap()
                .contains("draft only")
        );

        let defaults = env.session.export_defaults("a.json").unwrap();
        assert!(defaults.include_blocks_without_translation);
        assert_eq!(defaults.format, crate::export::ExportFormat::FlatJson);

        // Layout settings are remembered next.
        let layout = ExportRequest {
            target: ExportTarget::Layout(LayoutExportOptions {
                format: LayoutFormat::Rtf,
                prefix_stem: String::new(),
            }),
            ..request
        };
        let rtf = env.dir.path().join("a.rtf");
        env.session.export_variant("a.json", &layout, &rtf).unwrap();
        let defaults = env.session.export_defaults("a.json").unwrap();
        assert_eq!(defaults.layout.format, LayoutFormat::Rtf);
        assert_eq!(defaults.layout.prefix_stem, "");
        assert!(std::fs::read_to_string(&rtf).unwrap().contains("{\\rtf"));
    }

    // Checklist 16/19: unopened invalid file: "Cannot export"; bad request:
    // "Export failed"; failures remember nothing.
    #[test]
    fn export_variant_errors() {
        let mut env = Env::with(&[("a", &["verse"])]);
        std::fs::write(env.lib().join("bad.json"), r#"{"id": 5}"#).unwrap();
        let target = env.dir.path().join("o.json");
        let notice = env.session.export_defaults("bad.json").unwrap_err();
        assert_eq!(notice, Notice::error("Cannot export", "Prayer is invalid."));
        let notice = err_of(env.session.export_variant("bad.json", &flat("de"), &target));
        assert_eq!(notice.title, "Cannot export");
        let notice = err_of(env.session.export_variant("a.json", &flat("fr"), &target));
        assert_eq!(notice.title, "Export failed");
        assert_eq!(
            notice.message,
            "Variant not found: lang=\"fr\" variant=\"standard\""
        );
        assert!(!target.exists());
        let root = env.lib().to_string_lossy().into_owned();
        assert!(env.session.prefs().export_prefs(&root, "a.json").is_none());
    }

    // Checklist 3/13: export prefs follow a rename and die with a delete.
    #[test]
    fn export_prefs_follow_rename_and_delete() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        let target = env.dir.path().join("o.json");
        env.session
            .export_variant("a.json", &flat("de"), &target)
            .unwrap();
        env.session
            .edit_selected(EditKind::Other, |p| edit::set_id(p, "z"));
        env.session.save_selected().unwrap();
        let root = env.lib().to_string_lossy().into_owned();
        assert!(env.session.prefs().export_prefs(&root, "a.json").is_none());
        assert!(env.session.prefs().export_prefs(&root, "z.json").is_some());
        env.session.delete_prayer("z.json").unwrap();
        assert!(env.session.prefs().export_prefs(&root, "z.json").is_none());
    }

    // -- Kind rename and delete (checklist 14) -----------------------------------------

    fn styles_with(kind: &str) -> StyleOverrides {
        serde_json::from_value(json!({
            kind: {"fontSize": "1rem", "color": "base", "fontWeight": "400", "fontStyle": "normal"}
        }))
        .unwrap()
    }

    // Checklist 14: rename across files and open drafts, styles renamed.
    #[test]
    fn kind_rename_across_library() {
        let mut env = Env::with(&[
            ("a", &["custom", "verse"]),
            ("b", &["custom"]),
            ("c", &["verse"]),
            ("d", &["custom"]),
        ]);
        env.session
            .set_library_styles(&styles_with("custom"))
            .unwrap();
        // d is open (clean), b is open and dirty; a is only on disk.
        env.select("d.json");
        env.select("b.json");
        env.type_text("unsaved");

        let request = env
            .session
            .request_kind_rename("custom", " renamed ")
            .unwrap();
        let KindRenameRequest::Confirm(plan) = request.value else {
            panic!("three prayers use it: confirm first");
        };
        assert_eq!(plan.to, "renamed");
        let mut affected = plan.affected.clone();
        affected.sort();
        assert_eq!(affected, ["a.json", "b.json", "d.json"]);

        let done = env.session.apply_kind_rename(&plan).unwrap();
        assert_eq!(
            done.notices,
            [Notice::info(
                "Kind renamed",
                "“custom” → “renamed” in 3 prayers"
            )]
        );
        assert_eq!(done.value.written, ["a.json"]);
        let mut drafts = done.value.drafts.clone();
        drafts.sort();
        assert_eq!(drafts, ["b.json", "d.json"]);
        // Files on disk: a written at once; open drafts only in memory.
        assert!(env.read("a.json").contains("\"kind\": \"renamed\""));
        assert!(env.read("b.json").contains("\"kind\": \"custom\""));
        assert!(env.read("c.json").contains("\"kind\": \"verse\""));
        for path in ["b.json", "d.json"] {
            let draft = env.session.draft(path).unwrap();
            assert_eq!(draft.prayer().structure[0].kind, "renamed");
            assert!(draft.is_dirty());
        }
        // Library styles renamed on disk at once.
        let styles = env.read(".orthodox-prayer-toolkit/styles.json");
        assert!(styles.contains("\"renamed\"") && !styles.contains("\"custom\""));
        assert!(
            env.session
                .library()
                .unwrap()
                .styles()
                .contains_key("renamed")
        );
        assert!(
            env.session
                .catalog()
                .unwrap()
                .kinds()
                .iter()
                .any(|k| k == "renamed")
        );
    }

    // Checklist 14: one or zero prayers rename without confirm; presets,
    // invalid and unchanged names are ignored; skipped files are counted.
    #[test]
    fn kind_rename_small_cases_and_skips() {
        let mut env = Env::with(&[("a", &["custom"]), ("b", &["verse"])]);
        let done = env.session.request_kind_rename("custom", "other").unwrap();
        let KindRenameRequest::Applied(report) = done.value else {
            panic!("single prayer renames at once");
        };
        assert_eq!(report.written, ["a.json"]);
        assert_eq!(
            done.notices,
            [Notice::info(
                "Kind renamed",
                "“custom” → “other” in 1 prayer"
            )]
        );
        for (from, to) in [
            ("verse", "x"),
            ("other", "other"),
            ("other", "1bad"),
            ("other", ""),
        ] {
            let done = env.session.request_kind_rename(from, to).unwrap();
            assert_eq!(done.value, KindRenameRequest::Ignored, "{from} -> {to}");
        }
        let done = env.session.request_kind_rename("nothing", "x").unwrap();
        let KindRenameRequest::Applied(report) = done.value else {
            panic!()
        };
        assert!(report.written.is_empty());
        assert_eq!(done.notices[0].message, "“nothing” → “x” in 0 prayers");

        // An unreadable affected file is skipped, and counted in the notice.
        let plan = KindRenamePlan {
            from: "other".into(),
            to: "again".into(),
            affected: vec!["a.json".into(), "ghost.json".into()],
        };
        let done = env.session.apply_kind_rename(&plan).unwrap();
        assert_eq!(done.value.written, ["a.json"]);
        assert_eq!(done.value.skipped.len(), 1);
        assert_eq!(done.value.skipped[0].path, "ghost.json");
        assert_eq!(
            done.notices[0].message,
            "“other” → “again” in 1 prayer · 1 skipped"
        );
    }

    // Checklist 14: unscanned stubs are read when planning.
    #[test]
    fn kind_plan_reads_unscanned_files() {
        let mut env = Env::with(&[("a", &["custom"]), ("b", &["custom"])]);
        env.session.library.as_mut().unwrap().rescan();
        assert!(!env.session.catalog().unwrap().scan_complete());
        let plan = env.session.plan_kind_rename("custom", "x");
        assert_eq!(plan.affected, ["a.json", "b.json"]);
    }

    // Checklist 14: Library styles written immediately; invalid refused.
    #[test]
    fn library_styles_written_immediately() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.session
            .set_library_styles(&styles_with("verse"))
            .unwrap();
        assert!(
            env.read(".orthodox-prayer-toolkit/styles.json")
                .contains("verse")
        );
        let mut bad = styles_with("verse");
        bad.get_mut("verse").unwrap().color = Some("neon".into());
        let notice = err_of(env.session.set_library_styles(&bad));
        assert_eq!(notice.title, "Cannot save library styles");
        assert!(
            env.session
                .library()
                .unwrap()
                .styles()
                .get("verse")
                .unwrap()
                .color
                .as_deref()
                != Some("neon")
        );
    }

    // Checklist 14: delete a Kind: style removed, selected prayer's Blocks
    // fall back to verse (undoable); presets are fixed.
    #[test]
    fn kind_delete() {
        let mut env = Env::with(&[("a", &["custom", "heading"])]);
        env.session
            .set_library_styles(&styles_with("custom"))
            .unwrap();
        env.select("a.json");
        let done = env.session.delete_kind("custom").unwrap();
        assert_eq!(done.value, 1);
        assert_eq!(
            env.session.selected_draft().unwrap().prayer().structure[0].kind,
            "verse"
        );
        assert!(
            !env.session
                .library()
                .unwrap()
                .styles()
                .contains_key("custom")
        );
        assert!(env.session.selected_draft_mut().unwrap().undo());
        assert_eq!(env.session.delete_kind("verse").unwrap().value, 0);
        assert!(
            env.session
                .selected_draft()
                .unwrap()
                .prayer()
                .structure
                .iter()
                .any(|b| b.kind == "custom")
        );
    }

    // Checklist 15: Library settings save.
    #[test]
    fn library_settings_save() {
        let mut env = Env::with(&[]);
        let done = env
            .session
            .save_library_settings(LibraryManifest {
                description: Some("D".into()),
                style_prefix_stem: Some("lit".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(
            done.notices,
            [Notice::info("Library updated", "manifest.json saved")]
        );
        let text = env.read("manifest.json");
        assert!(text.contains("\"stylePrefixStem\": \"lit\"") && text.ends_with("}\n"));
        assert_eq!(
            env.session
                .library()
                .unwrap()
                .manifest()
                .unwrap()
                .description
                .as_deref(),
            Some("D")
        );
        // Settings feed the Export dialog.
        env.session.create_prayer(&NewPrayerForm::new("p")).unwrap();
        let defaults = env.session.export_defaults("p.json").unwrap();
        assert_eq!(defaults.layout.prefix_stem, "lit");
    }

    // -- watcher events (decided change) -----------------------------------------------

    // Decided change: a clean draft follows an outside change silently.
    #[test]
    fn watch_clean_draft_reloads_silently() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        write(
            &env.lib(),
            "a.json",
            &prayer_value("a", &["heading", "verse"]),
        );
        let report = env
            .session
            .handle_watch_event(&WatchEvent::Changed("a.json".into()));
        assert_eq!(
            report.changes,
            [DraftChange {
                path: "a.json".into(),
                change: DiskChange::Reloaded
            }]
        );
        let draft = env.session.selected_draft().unwrap();
        assert_eq!(draft.prayer().structure.len(), 2);
        assert!(!draft.is_dirty());
        assert!(draft.can_undo(), "the reload is undoable");
        // Catalog follows the file.
        let kinds = env.session.catalog().unwrap().kinds().to_vec();
        assert_eq!(kinds, ["heading", "verse"]);
    }

    // Decided change: dirty draft: Changed on disk with Reload / Keep mine.
    #[test]
    fn watch_dirty_draft_changed_on_disk() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.type_text("mine");
        write(&env.lib(), "a.json", &prayer_value("a", &["heading"]));
        let report = env
            .session
            .handle_watch_event(&WatchEvent::Changed("a.json".into()));
        assert_eq!(report.changes[0].change, DiskChange::ChangedOnDisk);
        assert!(matches!(
            env.session.draft("a.json").unwrap().disk_state(),
            DiskState::ChangedOnDisk(_)
        ));
        assert_eq!(
            env.session.selected_draft().unwrap().prayer().structure[0].kind,
            "verse"
        );

        // Reload takes the file's content (undoable).
        assert!(env.session.draft_mut("a.json").unwrap().reload_pending());
        assert_eq!(
            env.session.selected_draft().unwrap().prayer().structure[0].kind,
            "heading"
        );
        assert!(env.session.selected_draft_mut().unwrap().undo());
        // Keep mine: saving overwrites.
        write(&env.lib(), "a.json", &prayer_value("a", &["annotation"]));
        env.session
            .handle_watch_event(&WatchEvent::Changed("a.json".into()));
        env.session.draft_mut("a.json").unwrap().keep_mine();
        env.session.save_selected().unwrap();
        assert!(env.read("a.json").contains("mine"));
    }

    // Own writes never reach the Session (the watcher filters them), but a
    // late event for our own save changes nothing anyway.
    #[test]
    fn watch_event_for_own_save_changes_nothing() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        env.type_text("saved");
        env.session.save_selected().unwrap();
        let report = env
            .session
            .handle_watch_event(&WatchEvent::Changed("a.json".into()));
        assert!(report.changes.is_empty());
        assert!(!env.session.selected_draft().unwrap().is_dirty());
    }

    // Decided change: deleted file: clean draft closes, dirty stays open as
    // Deleted on disk and saving recreates the file.
    #[test]
    fn watch_removed_files() {
        let mut env = Env::with(&[("a", &["verse"]), ("b", &["verse"]), ("c", &["verse"])]);
        env.select("a.json");
        env.select("b.json");
        env.type_text("keep me");
        env.select("c.json");
        std::fs::remove_file(env.lib().join("a.json")).unwrap();
        std::fs::remove_file(env.lib().join("b.json")).unwrap();
        std::fs::remove_file(env.lib().join("c.json")).unwrap();

        let a = env
            .session
            .handle_watch_event(&WatchEvent::Removed("a.json".into()));
        assert_eq!(a.changes[0].change, DiskChange::Closed);
        assert!(env.session.draft("a.json").is_none());
        let b = env
            .session
            .handle_watch_event(&WatchEvent::Removed("b.json".into()));
        assert_eq!(b.changes[0].change, DiskChange::DeletedOnDisk);
        let c = env
            .session
            .handle_watch_event(&WatchEvent::Removed("c.json".into()));
        assert_eq!(c.changes[0].change, DiskChange::Closed);
        assert!(
            env.session.selected_path().is_none(),
            "closed selection clears"
        );

        // Dirty draft stays listed (even without a catalog entry) and counts
        // as unsaved.
        assert!(env.session.has_unsaved());
        assert!(env.session.catalog().unwrap().entry("b.json").is_none());
        let rows = env.session.sidebar_entries("");
        assert_eq!(rows.len(), 1);
        assert!(rows[0].dirty && rows[0].open);
        // Saving recreates the file.
        env.select("b.json");
        env.session.save_selected().unwrap();
        assert!(env.read("b.json").contains("keep me"));
        assert!(!env.session.has_unsaved());
        assert_eq!(
            env.session.draft("b.json").unwrap().disk_state(),
            &DiskState::InSync
        );
    }

    // A stale Removed event for a file that exists again counts as changed.
    #[test]
    fn watch_stale_removed_event_is_a_change() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        write(&env.lib(), "a.json", &prayer_value("a", &["heading"]));
        let report = env
            .session
            .handle_watch_event(&WatchEvent::Removed("a.json".into()));
        assert_eq!(report.changes[0].change, DiskChange::Reloaded);
    }

    // Catalog follows created, changed and removed files.
    #[test]
    fn watch_updates_catalog() {
        let mut env = Env::with(&[("a", &["verse"])]);
        write(&env.lib(), "n.json", &prayer_value("n", &["heading"]));
        let report = env
            .session
            .handle_watch_event(&WatchEvent::Created("n.json".into()));
        assert!(report.changes.is_empty());
        assert!(
            env.session
                .catalog()
                .unwrap()
                .entry("n.json")
                .unwrap()
                .is_valid()
        );
        std::fs::write(env.lib().join("n.json"), "{nope").unwrap();
        env.session
            .handle_watch_event(&WatchEvent::Changed("n.json".into()));
        assert_eq!(
            env.session
                .catalog()
                .unwrap()
                .entry("n.json")
                .unwrap()
                .status,
            EntryStatus::InvalidJson
        );
        std::fs::remove_file(env.lib().join("n.json")).unwrap();
        env.session
            .handle_watch_event(&WatchEvent::Removed("n.json".into()));
        assert!(env.session.catalog().unwrap().entry("n.json").is_none());
        // Other JSON files do not become prayers.
        env.session
            .handle_watch_event(&WatchEvent::Created("notes/x.json/".into()));
        env.session.handle_watch_event(&WatchEvent::Created(
            ".orthodox-prayer-toolkit/other.json".into(),
        ));
        assert_eq!(env.session.catalog().unwrap().entries().len(), 1);
    }

    // A clean draft whose file turns invalid needs a decision, not a reload.
    #[test]
    fn watch_file_turning_invalid_needs_decision() {
        let mut env = Env::with(&[("a", &["verse"])]);
        env.select("a.json");
        std::fs::write(env.lib().join("a.json"), "{nope").unwrap();
        let report = env
            .session
            .handle_watch_event(&WatchEvent::Changed("a.json".into()));
        assert_eq!(report.changes[0].change, DiskChange::ChangedOnDisk);
        assert!(!env.session.draft_mut("a.json").unwrap().reload_pending());
        assert_eq!(env.session.selected_draft().unwrap().prayer().id, "a");
    }

    // The Invalid prayer screen follows the file when it is fixed.
    #[test]
    fn watch_fixes_invalid_selection() {
        let mut env = Env::with(&[]);
        std::fs::write(env.lib().join("fix.json"), "{nope").unwrap();
        env.session.library.as_mut().unwrap().rescan();
        env.session.select_prayer("fix.json").unwrap();
        write(&env.lib(), "fix.json", &prayer_value("fix", &["verse"]));
        let report = env
            .session
            .handle_watch_event(&WatchEvent::Changed("fix.json".into()));
        assert_eq!(report.changes[0].change, DiskChange::SelectionUpdated);
        assert!(env.session.selected_draft().is_some());
        assert!(env.session.selected_invalid().is_none());
    }

    // manifest.json and styles reload config; styles notice once.
    #[test]
    fn watch_reloads_manifest_and_styles() {
        let mut env = Env::with(&[("a", &["verse"])]);
        std::fs::write(
            env.lib().join("manifest.json"),
            r#"{"description": "Fresh"}"#,
        )
        .unwrap();
        let report = env
            .session
            .handle_watch_event(&WatchEvent::Changed("manifest.json".into()));
        assert!(report.config_reloaded && report.changes.is_empty());
        assert_eq!(
            env.session
                .library()
                .unwrap()
                .manifest()
                .unwrap()
                .description
                .as_deref(),
            Some("Fresh")
        );
        let tk = env.lib().join(".orthodox-prayer-toolkit");
        std::fs::create_dir_all(&tk).unwrap();
        std::fs::write(
            tk.join("styles.json"),
            r##"{"verse": {"fontSize": "bogus"}}"##,
        )
        .unwrap();
        let report = env.session.handle_watch_event(&WatchEvent::Created(
            ".orthodox-prayer-toolkit/styles.json".into(),
        ));
        assert!(report.config_reloaded);
        assert_eq!(titles(&report.notices), ["Library styles cleaned"]);
        std::fs::remove_file(env.lib().join("manifest.json")).unwrap();
        env.session
            .handle_watch_event(&WatchEvent::Removed("manifest.json".into()));
        assert!(env.session.library().unwrap().manifest().is_none());
    }

    // Rescan event: catalog restarts, drafts are reconciled.
    #[test]
    fn watch_rescan_reconciles_everything() {
        let mut env = Env::with(&[("a", &["verse"]), ("b", &["verse"])]);
        env.select("a.json");
        env.select("b.json");
        write(&env.lib(), "a.json", &prayer_value("a", &["heading"]));
        std::fs::remove_file(env.lib().join("b.json")).unwrap();
        let report = env.session.handle_watch_event(&WatchEvent::Rescan);
        assert!(report.rescanned);
        assert!(env.session.draft("b.json").is_none());
        assert_eq!(
            env.session.draft("a.json").unwrap().prayer().structure[0].kind,
            "heading"
        );
        assert!(env.session.selected_path().is_none());
        assert_eq!(env.session.catalog().unwrap().entries().len(), 1);
    }

    #[test]
    fn watch_without_library_is_a_no_op() {
        let mut session = Session::new(Prefs::default(), None);
        let report = session.handle_watch_event(&WatchEvent::Rescan);
        assert_eq!(report, WatchReport::default());
        assert!(session.sidebar_entries("").is_empty());
        assert!(session.scan_step(5).complete);
        assert!(session.begin_create().is_err());
        assert_eq!(
            session.select_prayer("a.json").unwrap().value,
            SelectOutcome::Unchanged
        );
    }

    // Notice display.
    #[test]
    fn notice_display() {
        assert_eq!(
            Notice::error("Cannot export", "Prayer is invalid.").to_string(),
            "Cannot export — Prayer is invalid."
        );
    }
}
