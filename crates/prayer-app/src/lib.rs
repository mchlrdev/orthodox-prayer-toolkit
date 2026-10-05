//! App logic without UI: Library catalog, Session drafts, dirty state, undo
//! and file I/O. Everything here is testable without a window.

pub mod catalog;
pub mod draft;
pub mod edit;
pub mod fs;
pub mod history;
pub mod library;
pub mod prefs;
pub mod watch;
