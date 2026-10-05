//! Library root file access: every path is confined to the Library folder.
//!
//! Rewrite of `packages/app/nodeFs.ts` plus the file handlers of the Electron
//! main process. Paths are relative `&str`s with `/` (or `\`) separators;
//! absolute paths, `..`, NUL bytes and symlinks that leave the Library root are
//! rejected. Writes are atomic (temp file + rename in the same folder) and are
//! recorded in a [`WriteLog`] so the folder watcher can tell the app's own
//! writes from outside changes.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;

/// Folders never scanned for prayer files.
const SKIPPED_DIRS: [&str; 2] = ["node_modules", ".git"];

/// File access errors. `Display` texts match the Electron messages.
#[derive(Debug, thiserror::Error)]
pub enum FsError {
    /// Path is empty or contains a NUL byte.
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    /// Path is absolute, uses `..`, or resolves outside the root via symlink.
    #[error("Path escapes library root: {0}")]
    EscapesRoot(String),
    /// The Library root folder does not exist or is not a folder.
    #[error("Folder not found")]
    RootNotFound,
    /// A rename or exclusive create would overwrite an existing file.
    #[error("Target already exists: {0}")]
    TargetExists(String),
    /// File content is not valid JSON.
    #[error("Invalid JSON in {path}: {source}")]
    Json {
        path: String,
        source: serde_json::Error,
    },
    /// Value could not be serialized.
    #[error("Could not serialize {path}: {source}")]
    Serialize {
        path: String,
        source: serde_json::Error,
    },
    /// Any other I/O failure.
    #[error("{path}: {source}")]
    Io {
        path: String,
        source: std::io::Error,
    },
}

impl FsError {
    fn io(path: &str, source: std::io::Error) -> Self {
        Self::Io {
            path: path.to_owned(),
            source,
        }
    }

    /// True if the underlying I/O error is "file not found".
    pub fn is_not_found(&self) -> bool {
        matches!(self, Self::Io { source, .. } if source.kind() == std::io::ErrorKind::NotFound)
    }
}

/// What the app last did to a path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Recorded {
    Wrote(u64),
    Deleted,
}

/// Remembers the app's own writes and deletes (path + content hash) so the
/// watcher can ignore the events they cause. Cheap to clone; clones share
/// state.
#[derive(Clone, Debug, Default)]
pub struct WriteLog {
    inner: Arc<Mutex<HashMap<String, Recorded>>>,
}

fn content_hash(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

impl WriteLog {
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Recorded>> {
        // A poisoned log only means another thread panicked mid-insert; the
        // map is still usable.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn record_write(&self, path: &str, bytes: &[u8]) {
        self.lock()
            .insert(path.to_owned(), Recorded::Wrote(content_hash(bytes)));
    }

    fn record_delete(&self, path: &str) {
        self.lock().insert(path.to_owned(), Recorded::Deleted);
    }

    /// True if the file's current state (`None` = missing) is exactly what the
    /// app last wrote or deleted at `path`. A write record stays while the
    /// content still matches (one write can raise several events); a
    /// mismatching state clears the record, so a later outside change back to
    /// the same bytes is reported.
    pub fn is_own_change(&self, path: &str, current: Option<&[u8]>) -> bool {
        let mut log = self.lock();
        let Some(&recorded) = log.get(path) else {
            return false;
        };
        match (recorded, current) {
            (Recorded::Wrote(hash), Some(bytes)) if hash == content_hash(bytes) => true,
            (Recorded::Deleted, None) => {
                log.remove(path);
                true
            }
            _ => {
                log.remove(path);
                false
            }
        }
    }
}

/// A Library folder on disk. All file access goes through this type.
#[derive(Clone, Debug)]
pub struct LibraryRoot {
    path: PathBuf,
    log: WriteLog,
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Writes `bytes` to `target` atomically: temp file in the same folder, then
/// rename. Creates missing parent folders. No confinement check; use
/// [`LibraryRoot::write_bytes`] for Library paths.
pub fn write_atomic(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = target.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let temp = dir.join(format!(
        ".{name}.{}-{}.tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        std::fs::rename(&temp, target)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

/// Pretty JSON (2-space indent) plus a trailing newline: the bytes
/// `JSON.stringify(value, null, 2) + "\n"` produces.
pub fn to_pretty_json<T: Serialize + ?Sized>(value: &T) -> Result<String, serde_json::Error> {
    let mut text = serde_json::to_string_pretty(value)?;
    text.push('\n');
    Ok(text)
}

impl LibraryRoot {
    /// Opens an existing folder as a Library root.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, FsError> {
        let path = std::path::absolute(path.as_ref()).map_err(|_| FsError::RootNotFound)?;
        if !path.is_dir() {
            return Err(FsError::RootNotFound);
        }
        Ok(Self {
            path,
            log: WriteLog::default(),
        })
    }

    /// Absolute path of the root folder.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The log of this app's own writes, shared with the watcher.
    pub fn write_log(&self) -> &WriteLog {
        &self.log
    }

    /// Validates a relative path and returns its normalized `/`-separated
    /// form plus the absolute path. Checks symlinks against the real root.
    fn resolve(&self, relative: &str) -> Result<(String, PathBuf), FsError> {
        if relative.contains('\0') {
            return Err(FsError::InvalidPath(relative.to_owned()));
        }
        let escapes = || FsError::EscapesRoot(relative.to_owned());
        if relative.starts_with(['/', '\\']) || Path::new(relative).is_absolute() {
            return Err(escapes());
        }
        let mut parts = Vec::new();
        for part in relative.split(['/', '\\']) {
            match part {
                "" | "." => {}
                ".." => return Err(escapes()),
                // Windows drive or UNC prefix such as `C:`.
                p if p.len() == 2 && p.ends_with(':') => return Err(escapes()),
                p => parts.push(p),
            }
        }
        if parts.is_empty() {
            return Err(FsError::InvalidPath(relative.to_owned()));
        }
        let normalized = parts.join("/");
        let full = parts.iter().fold(self.path.clone(), |p, part| p.join(part));
        if !self.is_confined(&full) {
            return Err(escapes());
        }
        Ok((normalized, full))
    }

    /// Symlink-aware: the deepest existing ancestor of `full` (links not
    /// followed while probing) must resolve inside the real root.
    fn is_confined(&self, full: &Path) -> bool {
        let real_root = std::fs::canonicalize(&self.path).unwrap_or_else(|_| self.path.clone());
        let mut probe = full;
        while std::fs::symlink_metadata(probe).is_err() {
            match probe.parent() {
                Some(parent) => probe = parent,
                None => return false,
            }
        }
        // A dangling symlink cannot be resolved: treat as escaping.
        match std::fs::canonicalize(probe) {
            Ok(real) => real.starts_with(&real_root),
            Err(_) => false,
        }
    }

    /// Recursively lists `.json` files as `/`-separated relative paths,
    /// skipping `node_modules` and `.git`, sorted like JS `Array.sort()`
    /// (UTF-16 code units). Unreadable folders are skipped; symlinks are not
    /// followed.
    pub fn list_json_files(&self) -> Vec<String> {
        fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                let name = entry.file_name().to_string_lossy().into_owned();
                let relative = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}/{name}")
                };
                if file_type.is_dir() {
                    if !SKIPPED_DIRS.contains(&name.as_str()) {
                        walk(&entry.path(), &relative, out);
                    }
                } else if file_type.is_file() && name.ends_with(".json") {
                    out.push(relative);
                }
            }
        }
        let mut files = Vec::new();
        walk(&self.path, "", &mut files);
        files.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
        files
    }

    /// True if a file or folder exists at `relative`.
    pub fn exists(&self, relative: &str) -> Result<bool, FsError> {
        let (_, full) = self.resolve(relative)?;
        Ok(full.exists())
    }

    /// Reads a file as bytes.
    pub fn read_bytes(&self, relative: &str) -> Result<Vec<u8>, FsError> {
        let (name, full) = self.resolve(relative)?;
        std::fs::read(full).map_err(|e| FsError::io(&name, e))
    }

    /// Reads a file as UTF-8 text (invalid bytes are replaced, like Node).
    pub fn read_text(&self, relative: &str) -> Result<String, FsError> {
        let bytes = self.read_bytes(relative)?;
        Ok(match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
        })
    }

    /// Reads and parses a JSON file.
    pub fn read_json(&self, relative: &str) -> Result<Value, FsError> {
        let text = self.read_text(relative)?;
        serde_json::from_str(&text).map_err(|source| FsError::Json {
            path: relative.to_owned(),
            source,
        })
    }

    /// Atomically writes bytes (creating parent folders) and records the write.
    pub fn write_bytes(&self, relative: &str, bytes: &[u8]) -> Result<(), FsError> {
        let (name, full) = self.resolve(relative)?;
        write_atomic(&full, bytes).map_err(|e| FsError::io(&name, e))?;
        self.log.record_write(&name, bytes);
        Ok(())
    }

    /// Atomically writes text.
    pub fn write_text(&self, relative: &str, text: &str) -> Result<(), FsError> {
        self.write_bytes(relative, text.as_bytes())
    }

    /// Writes `value` as pretty JSON plus a trailing newline (the bytes
    /// Electron writes).
    pub fn write_json<T: Serialize + ?Sized>(
        &self,
        relative: &str,
        value: &T,
    ) -> Result<(), FsError> {
        let text = to_pretty_json(value).map_err(|source| FsError::Serialize {
            path: relative.to_owned(),
            source,
        })?;
        self.write_text(relative, &text)
    }

    /// Deletes a file; a missing file is not an error (`rmSync` with force).
    pub fn delete(&self, relative: &str) -> Result<(), FsError> {
        let (name, full) = self.resolve(relative)?;
        match std::fs::remove_file(full) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(FsError::io(&name, e)),
        }
        self.log.record_delete(&name);
        Ok(())
    }

    /// Renames a file within the Library; never overwrites an existing target.
    pub fn rename(&self, from: &str, to: &str) -> Result<(), FsError> {
        let (from_name, from_full) = self.resolve(from)?;
        let (to_name, to_full) = self.resolve(to)?;
        if to_full.exists() {
            return Err(FsError::TargetExists(to.to_owned()));
        }
        let bytes = std::fs::read(&from_full).map_err(|e| FsError::io(&from_name, e))?;
        if let Some(dir) = to_full.parent() {
            std::fs::create_dir_all(dir).map_err(|e| FsError::io(&to_name, e))?;
        }
        std::fs::rename(&from_full, &to_full).map_err(|e| FsError::io(&from_name, e))?;
        self.log.record_delete(&from_name);
        self.log.record_write(&to_name, &bytes);
        Ok(())
    }

    /// Path relative to the root with `/` separators, if `absolute` is inside.
    pub fn relative_path(&self, absolute: &Path) -> Option<String> {
        let rel = absolute.strip_prefix(&self.path).ok().or_else(|| {
            let real = std::fs::canonicalize(&self.path).ok()?;
            absolute.strip_prefix(real).ok()
        })?;
        let parts: Vec<_> = rel
            .components()
            .map(|c| match c {
                Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect::<Option<_>>()?;
        (!parts.is_empty()).then(|| parts.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn root() -> (tempfile::TempDir, LibraryRoot) {
        let dir = tempfile::tempdir().unwrap();
        let root = LibraryRoot::open(dir.path()).unwrap();
        (dir, root)
    }

    #[test]
    fn open_requires_existing_folder() {
        let dir = tempfile::tempdir().unwrap();
        let err = LibraryRoot::open(dir.path().join("missing")).unwrap_err();
        assert_eq!(err.to_string(), "Folder not found");
    }

    // Checklist 3: all file paths are confined to the library root.
    #[test]
    fn rejects_escaping_and_invalid_paths() {
        let (_dir, root) = root();
        for bad in [
            "../x.json",
            "a/../../x.json",
            "/etc/passwd",
            "\\x",
            "C:/x",
            "a/../b",
        ] {
            assert!(
                matches!(root.read_bytes(bad), Err(FsError::EscapesRoot(_))),
                "{bad}"
            );
        }
        assert!(matches!(
            root.read_bytes("a\0b"),
            Err(FsError::InvalidPath(_))
        ));
        assert!(matches!(root.exists(""), Err(FsError::InvalidPath(_))));
        assert_eq!(
            root.exists("../x").unwrap_err().to_string(),
            "Path escapes library root: ../x"
        );
        assert!(matches!(
            root.write_text("../x.json", "{}"),
            Err(FsError::EscapesRoot(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let (dir, root) = root();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.json"), "{}").unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("nope"), dir.path().join("dangling"))
            .unwrap();
        assert!(matches!(
            root.read_bytes("link/secret.json"),
            Err(FsError::EscapesRoot(_))
        ));
        assert!(matches!(
            root.write_text("link/new.json", "{}"),
            Err(FsError::EscapesRoot(_))
        ));
        assert!(!outside.path().join("new.json").exists());
        assert!(matches!(
            root.write_text("dangling", "{}"),
            Err(FsError::EscapesRoot(_))
        ));
        // A symlink to a folder inside the root is fine.
        std::fs::create_dir(dir.path().join("real")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("real"), dir.path().join("inner")).unwrap();
        root.write_text("inner/a.json", "{}").unwrap();
        assert!(dir.path().join("real/a.json").exists());
    }

    // Checklist 3: scan lists every .json recursively, skips node_modules and
    // .git, sorted.
    #[test]
    fn lists_json_files_recursively_sorted() {
        let (dir, root) = root();
        let touch = |p: &str| {
            let full = dir.path().join(p);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, "{}").unwrap();
        };
        for p in [
            "b.json",
            "a.json",
            // Not "B.json": macOS and Windows file systems ignore case.
            "Z.json",
            "sub/c.json",
            "node_modules/x/y.json",
            ".git/z.json",
            ".orthodox-prayer-toolkit/styles.json",
            "note.txt",
            "manifest.json",
        ] {
            touch(p);
        }
        assert_eq!(
            root.list_json_files(),
            [
                ".orthodox-prayer-toolkit/styles.json",
                "Z.json",
                "a.json",
                "b.json",
                "manifest.json",
                "sub/c.json",
            ]
        );
    }

    // Checklist 5: JSON is written as JSON.stringify(x, null, 2) + "\n".
    #[test]
    fn writes_pretty_json_with_trailing_newline() {
        let (dir, root) = root();
        root.write_json(
            "sub/p.json",
            &json!({"id": "a", "list": [1, 2], "empty": []}),
        )
        .unwrap();
        let bytes = std::fs::read_to_string(dir.path().join("sub/p.json")).unwrap();
        assert_eq!(
            bytes,
            "{\n  \"id\": \"a\",\n  \"list\": [\n    1,\n    2\n  ],\n  \"empty\": []\n}\n"
        );
        assert_eq!(root.read_json("sub/p.json").unwrap()["id"], "a");
    }

    #[test]
    fn atomic_write_leaves_no_temp_files_and_overwrites() {
        let (dir, root) = root();
        root.write_text("a.json", "one").unwrap();
        root.write_text("a.json", "two").unwrap();
        assert_eq!(root.read_text("a.json").unwrap(), "two");
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        assert_eq!(names, ["a.json"]);
    }

    #[test]
    fn read_errors() {
        let (dir, root) = root();
        assert!(root.read_bytes("missing.json").unwrap_err().is_not_found());
        std::fs::write(dir.path().join("bad.json"), "{nope").unwrap();
        assert!(matches!(
            root.read_json("bad.json"),
            Err(FsError::Json { .. })
        ));
        std::fs::write(dir.path().join("latin.json"), [0x61, 0xff]).unwrap();
        assert_eq!(root.read_text("latin.json").unwrap(), "a\u{fffd}");
    }

    #[test]
    fn delete_is_forgiving_and_exists_reports() {
        let (_dir, root) = root();
        root.write_text("a.json", "{}").unwrap();
        assert!(root.exists("a.json").unwrap());
        root.delete("a.json").unwrap();
        assert!(!root.exists("a.json").unwrap());
        root.delete("a.json").unwrap();
    }

    // Checklist 5: rename never silently overwrites.
    #[test]
    fn rename_refuses_to_overwrite() {
        let (_dir, root) = root();
        root.write_text("a.json", "A").unwrap();
        root.write_text("b.json", "B").unwrap();
        let err = root.rename("a.json", "b.json").unwrap_err();
        assert_eq!(err.to_string(), "Target already exists: b.json");
        assert_eq!(root.read_text("b.json").unwrap(), "B");
        root.rename("a.json", "c.json").unwrap();
        assert!(!root.exists("a.json").unwrap());
        assert_eq!(root.read_text("c.json").unwrap(), "A");
    }

    #[test]
    fn write_log_recognizes_own_changes_only() {
        let (_dir, root) = root();
        let log = root.write_log();
        assert!(!log.is_own_change("a.json", Some(b"x")));
        root.write_text("a.json", "x").unwrap();
        // Several events for one write all match.
        assert!(log.is_own_change("a.json", Some(b"x")));
        assert!(log.is_own_change("a.json", Some(b"x")));
        // Outside change: reported, and the record is gone.
        assert!(!log.is_own_change("a.json", Some(b"y")));
        assert!(!log.is_own_change("a.json", Some(b"x")));
        root.delete("a.json").unwrap();
        assert!(log.is_own_change("a.json", None));
        assert!(!log.is_own_change("a.json", None));
        // Own write, then outside delete.
        root.write_text("b.json", "x").unwrap();
        assert!(!log.is_own_change("b.json", None));
    }

    #[test]
    fn relative_path_strips_root() {
        let (dir, root) = root();
        assert_eq!(
            root.relative_path(&dir.path().join("sub").join("a.json")),
            Some("sub/a.json".into())
        );
        assert_eq!(root.relative_path(Path::new("/elsewhere/a.json")), None);
        assert_eq!(root.relative_path(dir.path()), None);
    }
}
