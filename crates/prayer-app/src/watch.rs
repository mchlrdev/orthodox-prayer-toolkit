//! Watches the Library folder for outside changes.
//!
//! Uses `notify` with a debouncer and reports typed events for `.json` files
//! (prayers, `manifest.json`, `.orthodox-prayer-toolkit/styles.json`) over a
//! std channel. Changes the app made itself through [`LibraryRoot`] are
//! recognised via its [`WriteLog`] and not reported, so a save never looks like
//! an outside change. Paths in events are relative to the Library root with
//! `/` separators; use `prayer_core::library::is_prayer_filename` to tell
//! prayers from the manifest and styles file.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::fs::{LibraryRoot, WriteLog};

/// How long the folder must stay quiet before changes are reported.
pub const DEBOUNCE: Duration = Duration::from_millis(300);

/// A change in the Library folder not caused by this app.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WatchEvent {
    /// A `.json` file appeared.
    Created(String),
    /// A known `.json` file changed.
    Changed(String),
    /// A `.json` file disappeared (deleted or renamed away).
    Removed(String),
    /// Events were lost (backend overflow or error): rescan the Library.
    Rescan,
}

/// Watcher start failure.
#[derive(Debug, thiserror::Error)]
#[error("Could not watch library folder: {0}")]
pub struct WatchError(#[from] notify::Error);

/// Running watcher. Dropping it stops watching.
pub struct LibraryWatcher {
    _watcher: RecommendedWatcher,
    events: Receiver<WatchEvent>,
}

/// What the notify callback hands to the debounce thread.
enum Raw {
    Path(PathBuf),
    Rescan,
}

impl LibraryWatcher {
    /// Starts watching `root` recursively with the default [`DEBOUNCE`].
    pub fn start(root: &LibraryRoot) -> Result<Self, WatchError> {
        Self::start_with(root, DEBOUNCE)
    }

    /// Starts watching with a custom debounce time.
    ///
    /// Debouncing is done here rather than by a debouncer crate: reading a
    /// file to compare it with the app's own writes raises `Access` events,
    /// which must not restart the quiet period (or feed back into it).
    pub fn start_with(root: &LibraryRoot, debounce: Duration) -> Result<Self, WatchError> {
        let (raw_tx, raw_rx) = mpsc::channel();
        let (tx, events) = mpsc::channel();
        let state = State::new(root.clone(), tx);

        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                // The thread may have ended while the watcher shuts down.
                let _ = match result {
                    Ok(event) if event.need_rescan() => raw_tx.send(Raw::Rescan),
                    Ok(event) if matches!(event.kind, EventKind::Access(_)) => Ok(()),
                    Ok(event) => event
                        .paths
                        .into_iter()
                        .try_for_each(|path| raw_tx.send(Raw::Path(path))),
                    Err(_) => raw_tx.send(Raw::Rescan),
                };
            })?;
        // Watch the real path so event paths can be mapped back reliably.
        let watched = std::fs::canonicalize(root.path()).unwrap_or_else(|_| root.path().to_owned());
        watcher.watch(&watched, RecursiveMode::Recursive)?;

        std::thread::Builder::new()
            .name("library-watcher".into())
            .spawn(move || debounce_loop(state, raw_rx, debounce))
            .map_err(notify::Error::io)?;

        Ok(Self {
            _watcher: watcher,
            events,
        })
    }

    /// The event channel.
    pub fn events(&self) -> &Receiver<WatchEvent> {
        &self.events
    }

    /// Next event if one is ready.
    pub fn try_recv(&self) -> Option<WatchEvent> {
        self.events.try_recv().ok()
    }

    /// Waits up to `timeout` for the next event.
    pub fn recv_timeout(&self, timeout: Duration) -> Option<WatchEvent> {
        self.events.recv_timeout(timeout).ok()
    }
}

/// Collects raw events until the folder is quiet for `debounce`, then
/// processes each touched path once. Ends when the watcher is dropped.
fn debounce_loop(mut state: State, raw: Receiver<Raw>, debounce: Duration) {
    while let Ok(first) = raw.recv() {
        let mut paths = Vec::new();
        let mut rescan = false;
        let mut next = Some(first);
        while let Some(item) = next.take() {
            match item {
                Raw::Path(path) => {
                    if !paths.contains(&path) {
                        paths.push(path);
                    }
                }
                Raw::Rescan => rescan = true,
            }
            if let Ok(item) = raw.recv_timeout(debounce) {
                next = Some(item);
            }
        }
        if rescan {
            state.rescan();
        } else {
            state.handle_paths(&paths);
        }
    }
}

/// Paths under these folders are never reported.
fn is_skipped(relative: &str) -> bool {
    relative
        .split('/')
        .any(|part| part == "node_modules" || part == ".git")
}

fn is_json(relative: &str) -> bool {
    relative.ends_with(".json") && !is_skipped(relative)
}

/// Debouncer callback state: which files exist, so a write can be told
/// from a create.
struct State {
    root: LibraryRoot,
    log: WriteLog,
    known: HashSet<String>,
    tx: Sender<WatchEvent>,
}

impl State {
    fn new(root: LibraryRoot, tx: Sender<WatchEvent>) -> Self {
        let known = root.list_json_files().into_iter().collect();
        let log = root.write_log().clone();
        Self {
            root,
            log,
            known,
            tx,
        }
    }

    fn send(&self, event: WatchEvent) {
        // The receiver may be gone while the watcher shuts down.
        let _ = self.tx.send(event);
    }

    fn rescan(&mut self) {
        self.known = self.root.list_json_files().into_iter().collect();
        self.send(WatchEvent::Rescan);
    }

    fn handle_paths(&mut self, paths: &[PathBuf]) {
        for absolute in paths {
            if let Some(relative) = self.root.relative_path(absolute) {
                self.handle_path(absolute, &relative);
            }
        }
    }

    fn handle_path(&mut self, absolute: &Path, relative: &str) {
        if is_skipped(relative) {
            return;
        }
        if is_json(relative) {
            self.handle_file(absolute, relative);
        } else if absolute.is_dir() {
            self.handle_dir_appeared(relative);
        } else if !absolute.exists() {
            self.handle_dir_gone(relative);
        }
    }

    fn handle_file(&mut self, absolute: &Path, relative: &str) {
        let bytes = if absolute.is_file() {
            std::fs::read(absolute).ok()
        } else {
            None
        };
        let own = self.log.is_own_change(relative, bytes.as_deref());
        if bytes.is_none() {
            if self.known.remove(relative) && !own {
                self.send(WatchEvent::Removed(relative.to_owned()));
            }
        } else if self.known.insert(relative.to_owned()) {
            if !own {
                self.send(WatchEvent::Created(relative.to_owned()));
            }
        } else if !own {
            self.send(WatchEvent::Changed(relative.to_owned()));
        }
    }

    /// A folder moved or copied in: report the JSON files inside.
    fn handle_dir_appeared(&mut self, relative: &str) {
        let prefix = format!("{relative}/");
        for file in self.root.list_json_files() {
            if file.starts_with(&prefix) && self.known.insert(file.clone()) {
                self.send(WatchEvent::Created(file));
            }
        }
    }

    /// A folder was removed or moved away: its JSON files are gone.
    fn handle_dir_gone(&mut self, relative: &str) {
        let prefix = format!("{relative}/");
        let mut gone: Vec<String> = self
            .known
            .iter()
            .filter(|f| f.starts_with(&prefix))
            .cloned()
            .collect();
        gone.sort();
        for file in gone {
            self.known.remove(&file);
            self.send(WatchEvent::Removed(file));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    const WAIT: Duration = Duration::from_secs(15);
    const SHORT_DEBOUNCE: Duration = Duration::from_millis(100);

    fn setup() -> (tempfile::TempDir, LibraryRoot, LibraryWatcher) {
        let dir = tempfile::tempdir().unwrap();
        let root = LibraryRoot::open(dir.path()).unwrap();
        let watcher = LibraryWatcher::start_with(&root, SHORT_DEBOUNCE).unwrap();
        (dir, root, watcher)
    }

    /// Collects events until `done` says so or the wait runs out.
    fn collect_until(
        watcher: &LibraryWatcher,
        done: impl Fn(&[WatchEvent]) -> bool,
    ) -> Vec<WatchEvent> {
        let deadline = Instant::now() + WAIT;
        let mut events = Vec::new();
        while Instant::now() < deadline && !done(&events) {
            if let Some(event) = watcher.recv_timeout(Duration::from_millis(200)) {
                events.push(event);
            }
        }
        events
    }

    /// Drains whatever arrives in the next `quiet` period.
    fn drain(watcher: &LibraryWatcher, quiet: Duration) -> Vec<WatchEvent> {
        let mut events = Vec::new();
        while let Some(event) = watcher.recv_timeout(quiet) {
            events.push(event);
        }
        events
    }

    fn has(events: &[WatchEvent], wanted: &WatchEvent) -> bool {
        events.contains(wanted)
    }

    // Outside create / change / delete of a prayer file.
    #[test]
    fn reports_outside_create_change_and_remove() {
        let (dir, _root, watcher) = setup();
        let file = dir.path().join("a.json");

        std::fs::write(&file, "{}").unwrap();
        let created = WatchEvent::Created("a.json".into());
        let events = collect_until(&watcher, |e| has(e, &created));
        assert!(has(&events, &created), "{events:?}");
        drain(&watcher, Duration::from_millis(700));

        std::fs::write(&file, r#"{"changed": true}"#).unwrap();
        let changed = WatchEvent::Changed("a.json".into());
        let events = collect_until(&watcher, |e| has(e, &changed));
        assert!(has(&events, &changed), "{events:?}");
        drain(&watcher, Duration::from_millis(700));

        std::fs::remove_file(&file).unwrap();
        let removed = WatchEvent::Removed("a.json".into());
        let events = collect_until(&watcher, |e| has(e, &removed));
        assert!(has(&events, &removed), "{events:?}");
    }

    // Own writes (recorded by LibraryRoot) are suppressed; an outside write
    // to another file right after is still seen.
    #[test]
    fn ignores_own_writes_and_deletes() {
        let (dir, root, watcher) = setup();
        root.write_text("mine.json", "{}").unwrap();
        root.write_text("mine.json", r#"{"v": 2}"#).unwrap();
        std::fs::write(dir.path().join("theirs.json"), "{}").unwrap();

        let theirs = WatchEvent::Created("theirs.json".into());
        let mut events = collect_until(&watcher, |e| has(e, &theirs));
        events.extend(drain(&watcher, Duration::from_millis(700)));
        assert!(has(&events, &theirs), "{events:?}");
        assert!(
            events.iter().all(|e| !matches!(e,
                WatchEvent::Created(p) | WatchEvent::Changed(p) | WatchEvent::Removed(p) if p == "mine.json")),
            "own write reported: {events:?}"
        );

        root.delete("mine.json").unwrap();
        std::fs::remove_file(dir.path().join("theirs.json")).unwrap();
        let theirs_gone = WatchEvent::Removed("theirs.json".into());
        let mut events = collect_until(&watcher, |e| has(e, &theirs_gone));
        events.extend(drain(&watcher, Duration::from_millis(700)));
        assert!(has(&events, &theirs_gone), "{events:?}");
        assert!(
            !events.contains(&WatchEvent::Removed("mine.json".into())),
            "own delete reported: {events:?}"
        );
    }

    // After an own write, an outside edit of the same file is reported.
    #[test]
    fn reports_outside_edit_after_own_write() {
        let (dir, root, watcher) = setup();
        root.write_text("p.json", "{}").unwrap();
        drain(&watcher, Duration::from_millis(800));
        std::fs::write(dir.path().join("p.json"), r#"{"outside": 1}"#).unwrap();
        let changed = WatchEvent::Changed("p.json".into());
        let events = collect_until(&watcher, |e| has(e, &changed));
        assert!(has(&events, &changed), "{events:?}");
    }

    // Manifest and styles files are reported; other file types are not.
    #[test]
    fn reports_manifest_and_styles_but_not_other_files() {
        let (dir, _root, watcher) = setup();
        std::fs::create_dir_all(dir.path().join(".orthodox-prayer-toolkit")).unwrap();
        std::fs::write(dir.path().join("notes.txt"), "x").unwrap();
        std::fs::write(dir.path().join("manifest.json"), "{}").unwrap();
        std::fs::write(
            dir.path().join(".orthodox-prayer-toolkit/styles.json"),
            "{}",
        )
        .unwrap();
        let manifest = WatchEvent::Created("manifest.json".into());
        let styles = WatchEvent::Created(".orthodox-prayer-toolkit/styles.json".into());
        let mut events = collect_until(&watcher, |e| has(e, &manifest) && has(e, &styles));
        events.extend(drain(&watcher, Duration::from_millis(700)));
        assert!(has(&events, &manifest), "{events:?}");
        assert!(has(&events, &styles), "{events:?}");
        assert!(
            events
                .iter()
                .all(|e| !matches!(e, WatchEvent::Created(p) if p == "notes.txt")),
            "{events:?}"
        );
    }

    // Subfolder files and removal of a whole folder.
    #[test]
    fn reports_files_in_subfolders_and_folder_removal() {
        let (dir, _root, watcher) = setup();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/x.json"), "{}").unwrap();
        let created = WatchEvent::Created("sub/x.json".into());
        let events = collect_until(&watcher, |e| has(e, &created));
        assert!(has(&events, &created), "{events:?}");
        drain(&watcher, Duration::from_millis(700));

        std::fs::remove_dir_all(dir.path().join("sub")).unwrap();
        let removed = WatchEvent::Removed("sub/x.json".into());
        let events = collect_until(&watcher, |e| has(e, &removed));
        assert!(has(&events, &removed), "{events:?}");
    }

    // Files already present at start count as known, so an edit is Changed,
    // not Created.
    #[test]
    fn existing_files_report_changed_not_created() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("old.json"), "{}").unwrap();
        let root = LibraryRoot::open(dir.path()).unwrap();
        let watcher = LibraryWatcher::start_with(&root, SHORT_DEBOUNCE).unwrap();
        std::fs::write(dir.path().join("old.json"), r#"{"n": 1}"#).unwrap();
        let changed = WatchEvent::Changed("old.json".into());
        let mut events = collect_until(&watcher, |e| has(e, &changed));
        events.extend(drain(&watcher, Duration::from_millis(500)));
        assert!(has(&events, &changed), "{events:?}");
        assert!(!has(&events, &WatchEvent::Created("old.json".into())));
    }

    #[test]
    fn skip_rules() {
        assert!(is_json("a.json"));
        assert!(is_json(".orthodox-prayer-toolkit/styles.json"));
        assert!(!is_json("a.json.tmp"));
        assert!(!is_json("node_modules/x/a.json"));
        assert!(!is_json(".git/a.json"));
        assert!(!is_json("a.txt"));
    }

    // Overflow / backend errors become Rescan (see `rescan`) and refresh the known files.
    #[test]
    fn backend_error_becomes_rescan() {
        let dir = tempfile::tempdir().unwrap();
        let root = LibraryRoot::open(dir.path()).unwrap();
        let (tx, rx) = mpsc::channel();
        let mut state = State::new(root, tx);
        std::fs::write(dir.path().join("late.json"), "{}").unwrap();
        state.rescan();
        assert_eq!(rx.try_recv().unwrap(), WatchEvent::Rescan);
        assert!(state.known.contains("late.json"));
    }
}
