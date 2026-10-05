//! The app state entity: the [`Session`] plus what only a running UI has
//! (the folder watcher, the progressive scan, one editor per open prayer).

use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::*;
use prayer_app::catalog::CHUNK_SIZE;
use prayer_app::draft::SessionDraft;
use prayer_app::edit::VariantRef;
use prayer_app::session::{
    ActionOutcome, DiskChange, Done, Notice, PendingAction, SelectOutcome, Session, SessionResult,
    UnsavedChoice,
};
use prayer_app::watch::LibraryWatcher;
use prayer_core::StyleMap;

use crate::editor::{DraftHost, PrayerEditor};

/// How often the watcher's queue is drained.
const WATCH_POLL: Duration = Duration::from_millis(150);

/// Something the window has to react to.
#[derive(Clone, Debug)]
pub enum AppEvent {
    /// Show a toast.
    Notice(Notice),
    /// Drafts have unsaved changes: show the "Unsaved changes" dialog.
    UnsavedChanges,
    /// The Session allowed closing the window.
    CloseWindow,
    /// The Session allowed installing the update.
    InstallUpdate,
}

pub struct AppState {
    pub session: Session,
    watcher: Option<LibraryWatcher>,
    _watch_task: Option<Task<()>>,
    scan_task: Option<Task<()>>,
    /// The selected prayer's visible columns.
    columns: Vec<VariantRef>,
    styles: StyleMap,
    extra_kinds: Vec<String>,
    /// One editor per opened prayer (keeps caret and scroll per prayer).
    editors: HashMap<String, Entity<PrayerEditor>>,
    /// Open prayers that hit "Changed on disk" / "Deleted on disk".
    pub disk: HashMap<String, DiskChange>,
    /// Every prayer path the user ever renamed, mapped to its new path, so
    /// editors follow a rename on save.
    scanning: bool,
}

impl EventEmitter<AppEvent> for AppState {}

impl AppState {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let mut state = Self {
            session: Session::load(),
            watcher: None,
            _watch_task: None,
            scan_task: None,
            columns: Vec::new(),
            styles: StyleMap::new(),
            extra_kinds: Vec::new(),
            editors: HashMap::new(),
            disk: HashMap::new(),
            scanning: false,
        };
        state.refresh_derived();
        // Development aid (like the Electron dev build opening examples/):
        // OPT_OPEN_LIBRARY opens a Library, OPT_SELECT a prayer in it.
        if let Some(path) = std::env::var_os("OPT_OPEN_LIBRARY") {
            state.open_library(PathBuf::from(path), cx);
            let _ = state.session.scan_all();
            if let Ok(prayer) = std::env::var("OPT_SELECT") {
                let _ = state.session.select_prayer(&prayer);
            }
            state.refresh_derived();
        }
        state
    }

    pub fn is_scanning(&self) -> bool {
        self.scanning
    }

    pub fn styles(&self) -> &StyleMap {
        &self.styles
    }

    pub fn columns(&self) -> &[VariantRef] {
        &self.columns
    }

    /// Recomputes what is derived from the Session (styles, Kinds, columns).
    pub fn refresh_derived(&mut self) {
        self.styles = self.session.resolved_styles();
        // Open drafts count with their current Kinds (the catalog only
        // knows what is on disk).
        self.extra_kinds = crate::dialogs::kind::known_kinds(self);
        self.columns = self.session.visible_variants();
    }

    /// Shows the notices of a finished operation; an error becomes a toast.
    pub fn report<T>(&mut self, result: SessionResult<T>, cx: &mut Context<Self>) -> Option<T> {
        match result {
            Ok(Done { value, notices }) => {
                for notice in notices {
                    cx.emit(AppEvent::Notice(notice));
                }
                Some(value)
            }
            Err(notice) => {
                cx.emit(AppEvent::Notice(notice));
                None
            }
        }
    }

    pub fn notify_all(&mut self, cx: &mut Context<Self>) {
        self.refresh_derived();
        cx.notify();
    }

    // -- Library ----------------------------------------------------------

    /// Asks for an action guarded by the unsaved-changes dialog.
    pub fn request(&mut self, action: PendingAction, cx: &mut Context<Self>) {
        let result = self.session.request(action);
        if let Some(outcome) = self.report(result, cx) {
            self.after_outcome(outcome, cx);
        }
    }

    pub fn open_library(&mut self, path: PathBuf, cx: &mut Context<Self>) {
        self.request(PendingAction::OpenLibrary(path), cx);
    }

    pub fn resolve_unsaved(&mut self, choice: UnsavedChoice, cx: &mut Context<Self>) {
        let result = self.session.resolve_unsaved(choice);
        if let Some(outcome) = self.report(result, cx) {
            self.after_outcome(outcome, cx);
        }
    }

    pub fn after_outcome(&mut self, outcome: ActionOutcome, cx: &mut Context<Self>) {
        match outcome {
            ActionOutcome::Performed(PendingAction::OpenLibrary(_))
            | ActionOutcome::Performed(PendingAction::Refresh) => self.library_changed(cx),
            ActionOutcome::Performed(PendingAction::CloseWindow) => cx.emit(AppEvent::CloseWindow),
            ActionOutcome::Performed(PendingAction::InstallUpdate) => {
                cx.emit(AppEvent::InstallUpdate)
            }
            ActionOutcome::NeedsDecision => cx.emit(AppEvent::UnsavedChanges),
            ActionOutcome::Cancelled => {}
        }
        self.notify_all(cx);
    }

    /// A Library was opened or re-read: restart the watcher and the scan,
    /// and drop editors of prayers that are no longer open.
    fn library_changed(&mut self, cx: &mut Context<Self>) {
        let open: Vec<String> = self.session.open_paths().map(str::to_owned).collect();
        self.editors.retain(|path, _| open.contains(path));
        self.disk.retain(|path, _| open.contains(path));
        self.start_watcher(cx);
        self.start_scan(cx);
    }

    fn start_watcher(&mut self, cx: &mut Context<Self>) {
        self.watcher = self
            .session
            .library()
            .and_then(|l| LibraryWatcher::start(l.root()).ok());
        self._watch_task = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(WATCH_POLL).await;
                let alive = this.update(cx, |this, cx| this.drain_watcher(cx)).is_ok();
                if !alive {
                    break;
                }
            }
        }));
    }

    fn drain_watcher(&mut self, cx: &mut Context<Self>) {
        let mut events = Vec::new();
        if let Some(watcher) = &self.watcher {
            while let Some(event) = watcher.try_recv() {
                events.push(event);
            }
        }
        if events.is_empty() {
            return;
        }
        let mut rescanned = false;
        for event in events {
            let report = self.session.handle_watch_event(&event);
            for change in report.changes {
                match change.change {
                    DiskChange::ChangedOnDisk | DiskChange::DeletedOnDisk => {
                        self.disk.insert(change.path, change.change);
                    }
                    DiskChange::Reloaded | DiskChange::SelectionUpdated => {
                        self.disk.remove(&change.path);
                    }
                    DiskChange::Closed => {
                        self.disk.remove(&change.path);
                        self.editors.remove(&change.path);
                    }
                }
            }
            for notice in report.notices {
                cx.emit(AppEvent::Notice(notice));
            }
            rescanned |= report.rescanned;
        }
        if rescanned {
            self.start_scan(cx);
        }
        self.notify_all(cx);
    }

    /// Reads the catalog in chunks, redrawing the list after each.
    fn start_scan(&mut self, cx: &mut Context<Self>) {
        self.scanning = true;
        self.scan_task = Some(cx.spawn(async move |this, cx| {
            loop {
                let done = this
                    .update(cx, |this, cx| {
                        let step = this.session.scan_step(CHUNK_SIZE);
                        for notice in step.notices {
                            cx.emit(AppEvent::Notice(notice));
                        }
                        let done = step.read == 0 || step.complete;
                        if done {
                            this.scanning = false;
                        }
                        this.notify_all(cx);
                        done
                    })
                    .unwrap_or(true);
                if done {
                    break;
                }
                cx.background_executor()
                    .timer(Duration::from_millis(1))
                    .await;
            }
        }));
    }

    // -- prayers ------------------------------------------------------------

    pub fn select(&mut self, path: &str, cx: &mut Context<Self>) -> Option<SelectOutcome> {
        let result = self.session.select_prayer(path);
        let outcome = self.report(result, cx);
        self.notify_all(cx);
        outcome
    }

    /// The editor of the selected prayer (created on first use).
    pub fn selected_editor(&mut self, cx: &mut Context<Self>) -> Option<Entity<PrayerEditor>> {
        let path = self.session.selected_path()?.to_owned();
        self.session.selected_draft()?;
        if let Some(editor) = self.editors.get(&path) {
            return Some(editor.clone());
        }
        let host: Rc<dyn DraftHost> = Rc::new(PrayerHost {
            state: cx.entity(),
            path: path.clone(),
        });
        let editor = cx.new(|cx| PrayerEditor::new(host, cx));
        self.editors.insert(path, editor.clone());
        Some(editor)
    }

    /// A prayer was saved under a new path (id rename): its editor follows.
    pub fn moved(&mut self, from: &str, to: &str, cx: &mut Context<Self>) {
        if from == to {
            return;
        }
        self.editors.remove(from);
        self.disk.remove(from);
        let _ = cx;
    }

    pub fn set_columns(&mut self, columns: Vec<VariantRef>, cx: &mut Context<Self>) {
        self.session.set_visible_variants(columns);
        self.notify_all(cx);
    }

    pub fn save_selected(&mut self, cx: &mut Context<Self>) {
        let Some(old) = self.session.selected_path().map(str::to_owned) else {
            return;
        };
        let result = self.session.save_selected();
        if let Some(new) = self.report(result, cx) {
            self.disk.remove(&old);
            self.moved(&old, &new, cx);
        }
        self.notify_all(cx);
    }

    pub fn undo(&mut self, cx: &mut Context<Self>) {
        if let Some(d) = self.session.selected_draft_mut() {
            d.undo();
        }
        self.notify_all(cx);
    }

    pub fn redo(&mut self, cx: &mut Context<Self>) {
        if let Some(d) = self.session.selected_draft_mut() {
            d.redo();
        }
        self.notify_all(cx);
    }

    /// "Changed on disk" → Reload (undoable).
    pub fn reload_from_disk(&mut self, path: &str, cx: &mut Context<Self>) {
        if let Some(d) = self.session.draft_mut(path) {
            d.reload_pending();
        }
        self.disk.remove(path);
        self.notify_all(cx);
    }

    /// "Changed on disk" → Keep mine.
    pub fn keep_mine(&mut self, path: &str, cx: &mut Context<Self>) {
        if let Some(d) = self.session.draft_mut(path) {
            d.keep_mine();
        }
        self.disk.remove(path);
        self.notify_all(cx);
    }
}

/// The editor's view of one open prayer.
struct PrayerHost {
    state: Entity<AppState>,
    path: String,
}

impl DraftHost for PrayerHost {
    fn draft<'a>(&self, cx: &'a App) -> Option<&'a SessionDraft> {
        self.state.read(cx).session.draft(&self.path)
    }

    fn update_draft(&self, cx: &mut App, f: &mut dyn FnMut(&mut SessionDraft)) {
        let path = self.path.clone();
        self.state.update(cx, |state, cx| {
            if let Some(draft) = state.session.draft_mut(&path) {
                f(draft);
            }
            state.refresh_derived();
            cx.notify();
        });
    }

    fn columns(&self, cx: &App) -> Vec<VariantRef> {
        let state = self.state.read(cx);
        if state.session.selected_path() == Some(self.path.as_str()) {
            state.columns.clone()
        } else {
            Vec::new()
        }
    }

    fn styles<'a>(&self, cx: &'a App) -> &'a StyleMap {
        &self.state.read(cx).styles
    }

    fn extra_kinds(&self, cx: &App) -> Vec<String> {
        self.state.read(cx).extra_kinds.clone()
    }
}
