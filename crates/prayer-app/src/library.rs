//! An open Library: root folder, manifest, Library styles and prayer catalog.
//!
//! Rewrite of `packages/app/src/library.ts`, the scan setup in
//! `catalog/scan.ts` and the Library parts of `session/operations.ts`. Error
//! `Display` texts are the toast messages of Electron; the toast titles are
//! named in the doc comment of each operation.

use std::path::Path;

use prayer_core::library::{normalize_library_manifest, parse_library_manifest, prayer_filename};
use prayer_core::validate_styles::{sanitize_styles, validate_styles};
use prayer_core::{DefaultVariant, LibraryManifest, StyleOverrides, ValidationError, VariantKey};

use crate::catalog::Catalog;
use crate::fs::{FsError, LibraryRoot};

/// `manifest.json` at the Library root.
pub const MANIFEST_PATH: &str = "manifest.json";
/// Library Kind styles.
pub const STYLES_PATH: &str = ".orthodox-prayer-toolkit/styles.json";
/// Title of the toast shown once when Library styles had to be cleaned.
pub const STYLES_CLEANED_TITLE: &str = "Library styles cleaned";

/// Errors of Library operations.
#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    /// Opening: toast "Could not open library".
    /// Saving settings: toast "Could not save library settings".
    #[error(transparent)]
    Fs(#[from] FsError),
    /// Creating a Library: toast "Could not create library".
    #[error("Library name is required")]
    NameRequired,
    #[error("Library name cannot contain path separators")]
    NameHasSeparator,
    #[error("Default language and variant must both be set or both empty")]
    DefaultsIncomplete,
    #[error("Folder already exists: {0}")]
    FolderExists(String),
    /// Saving styles: toast "Cannot save library styles".
    #[error("{}", join_messages(.0))]
    InvalidStyles(Vec<ValidationError>),
}

fn join_messages(errors: &[ValidationError]) -> String {
    errors
        .iter()
        .map(|e| e.message.as_str())
        .collect::<Vec<_>>()
        .join(" · ")
}

/// Input of the "New library" dialog.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewLibrary {
    /// Folder name (required, no `/` or `\`, not `.` or `..`).
    pub name: String,
    pub description: String,
    /// Default language; both-or-neither with `variant`.
    pub lang: String,
    pub variant: String,
}

impl Default for NewLibrary {
    fn default() -> Self {
        Self {
            name: String::new(),
            description: String::new(),
            lang: "de".into(),
            variant: "standard".into(),
        }
    }
}

impl NewLibrary {
    /// Checks the folder-name and default-variant rules of the dialog;
    /// returns the trimmed folder name.
    pub fn validate(&self) -> Result<&str, LibraryError> {
        let name = self.name.trim();
        if name.is_empty() {
            return Err(LibraryError::NameRequired);
        }
        if name.contains(['/', '\\']) || name == "." || name == ".." {
            return Err(LibraryError::NameHasSeparator);
        }
        if self.lang.trim().is_empty() != self.variant.trim().is_empty() {
            return Err(LibraryError::DefaultsIncomplete);
        }
        Ok(name)
    }

    /// The manifest this dialog input produces.
    pub fn manifest(&self) -> LibraryManifest {
        let description = self.description.trim();
        let (lang, variant) = (self.lang.trim(), self.variant.trim());
        normalize_library_manifest(LibraryManifest {
            description: (!description.is_empty()).then(|| description.to_owned()),
            default_variant: (!lang.is_empty() && !variant.is_empty()).then(|| DefaultVariant {
                lang: lang.to_owned(),
                variant: variant.to_owned(),
            }),
            style_prefix_stem: None,
        })
    }
}

/// An open Library.
#[derive(Debug)]
pub struct Library {
    root: LibraryRoot,
    manifest: Option<LibraryManifest>,
    styles: StyleOverrides,
    style_errors: Vec<ValidationError>,
    styles_notice_pending: bool,
    catalog: Catalog,
}

/// Reads `manifest.json`; missing, unreadable or invalid means no manifest.
fn load_manifest(root: &LibraryRoot) -> Option<LibraryManifest> {
    let value = root.read_json(MANIFEST_PATH).ok()?;
    parse_library_manifest(&value).ok()
}

/// Reads and sanitizes the Library styles.
fn load_styles(root: &LibraryRoot) -> (StyleOverrides, Vec<ValidationError>) {
    let invalid = |message: &str| {
        (
            StyleOverrides::new(),
            vec![ValidationError {
                path: "/".into(),
                message: message.into(),
            }],
        )
    };
    match root.read_json(STYLES_PATH) {
        Ok(value) => sanitize_styles(&value),
        Err(FsError::Json { .. }) => invalid("Invalid styles JSON"),
        Err(_) => (StyleOverrides::new(), Vec::new()),
    }
}

impl Library {
    /// Opens the folder at `path`: lists files, reads manifest and styles and
    /// builds a catalog of unscanned entries. Drive the rest with
    /// [`Library::scan_step`]. Toast title on failure: "Could not open library".
    pub fn open(path: impl AsRef<Path>) -> Result<Self, LibraryError> {
        let root = LibraryRoot::open(path)?;
        let mut library = Self {
            root,
            manifest: None,
            styles: StyleOverrides::new(),
            style_errors: Vec::new(),
            styles_notice_pending: false,
            catalog: Catalog::default(),
        };
        library.reload();
        Ok(library)
    }

    /// Creates `<parent>/<name>` with a `manifest.json` and opens it. Toast
    /// titles: "Could not create library" on failure, "Library created" /
    /// "manifest.json written" on success.
    pub fn create(parent: &Path, spec: &NewLibrary) -> Result<Self, LibraryError> {
        let name = spec.validate()?;
        let folder = parent.join(name);
        if folder.exists() {
            return Err(LibraryError::FolderExists(name.to_owned()));
        }
        std::fs::create_dir_all(&folder).map_err(|source| FsError::Io {
            path: name.to_owned(),
            source,
        })?;
        let root = LibraryRoot::open(&folder)?;
        root.write_json(MANIFEST_PATH, &spec.manifest())?;
        Self::open(folder)
    }

    /// Re-reads files, manifest and styles from disk (Refresh, and after an
    /// outside change). The catalog restarts with unscanned entries; callers
    /// keep Session drafts themselves.
    pub fn rescan(&mut self) {
        self.reload();
    }

    fn reload(&mut self) {
        let files = self.root.list_json_files();
        self.manifest = files
            .iter()
            .any(|f| f == MANIFEST_PATH)
            .then(|| load_manifest(&self.root))
            .flatten();
        let (styles, errors) = load_styles(&self.root);
        // Report only when errors appear, not on every rescan of the same file.
        self.styles_notice_pending = !errors.is_empty() && self.style_errors.is_empty();
        self.styles = styles;
        self.style_errors = errors;
        self.catalog = Catalog::from_files(files.iter().map(String::as_str));
    }

    /// Re-reads just the manifest and styles (watcher: those files changed).
    pub fn reload_config(&mut self) {
        self.manifest = load_manifest(&self.root);
        let (styles, errors) = load_styles(&self.root);
        self.styles_notice_pending = !errors.is_empty() && self.style_errors.is_empty();
        self.styles = styles;
        self.style_errors = errors;
    }

    pub fn root(&self) -> &LibraryRoot {
        &self.root
    }

    /// Absolute path of the Library folder.
    pub fn path(&self) -> &Path {
        self.root.path()
    }

    /// Folder name for the sidebar header.
    pub fn folder_name(&self) -> String {
        self.root
            .path()
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.root.path().to_string_lossy().into_owned())
    }

    pub fn manifest(&self) -> Option<&LibraryManifest> {
        self.manifest.as_ref()
    }

    /// The Library default Variant, used for list titles and initial columns.
    pub fn preferred_variant(&self) -> Option<VariantKey<'_>> {
        self.manifest
            .as_ref()?
            .default_variant
            .as_ref()
            .map(|d| VariantKey {
                lang: &d.lang,
                variant: &d.variant,
            })
    }

    /// Library Kind styles (sanitized).
    pub fn styles(&self) -> &StyleOverrides {
        &self.styles
    }

    /// Problems found (and dropped) while reading the styles file.
    pub fn style_errors(&self) -> &[ValidationError] {
        &self.style_errors
    }

    /// Message of the one-time "Library styles cleaned" toast (title
    /// [`STYLES_CLEANED_TITLE`]): the first three problems. Returns it once per
    /// time the file goes from clean to unclean.
    pub fn take_styles_notice(&mut self) -> Option<String> {
        if !std::mem::take(&mut self.styles_notice_pending) {
            return None;
        }
        Some(
            self.style_errors
                .iter()
                .take(3)
                .map(|e| e.message.as_str())
                .collect::<Vec<_>>()
                .join(" · "),
        )
    }

    pub fn catalog(&self) -> &Catalog {
        &self.catalog
    }

    pub fn catalog_mut(&mut self) -> &mut Catalog {
        &mut self.catalog
    }

    /// Reads the next chunk of the catalog; see [`Catalog::scan_step`].
    pub fn scan_step(&mut self, chunk_size: usize) -> usize {
        self.catalog.scan_step(&self.root, chunk_size)
    }

    /// Re-reads one prayer file into the catalog (after a save or an outside
    /// change).
    pub fn refresh_path(&mut self, path: &str) {
        self.catalog.refresh_path(&self.root, path);
    }

    /// Writes `manifest.json` (Library settings; normalized first) and keeps
    /// it as the current manifest. Toast titles: "Library updated" /
    /// "manifest.json saved", failure "Could not save library settings".
    pub fn save_manifest(&mut self, manifest: LibraryManifest) -> Result<(), LibraryError> {
        let manifest = normalize_library_manifest(manifest);
        self.root.write_json(MANIFEST_PATH, &manifest)?;
        self.manifest = Some(manifest);
        Ok(())
    }

    /// Validates and writes the Library styles. Failure title: "Cannot save
    /// library styles", message the joined validation messages. Nothing is
    /// written if validation fails.
    pub fn save_styles(&mut self, next: &StyleOverrides) -> Result<(), LibraryError> {
        let value = serde_json::to_value(next).map_err(|e| {
            LibraryError::InvalidStyles(vec![ValidationError {
                path: "/".into(),
                message: e.to_string(),
            }])
        })?;
        let checked = validate_styles(&value).map_err(LibraryError::InvalidStyles)?;
        self.root.write_json(STYLES_PATH, &checked)?;
        self.styles = checked;
        self.style_errors.clear();
        self.styles_notice_pending = false;
        Ok(())
    }

    /// First `new-prayer-N` (N from 1) with no file of that name on disk and
    /// no catalog entry using that id.
    pub fn new_prayer_id(&self) -> Result<String, LibraryError> {
        for n in 1.. {
            let id = format!("new-prayer-{n}");
            let taken_in_catalog = self
                .catalog
                .entries()
                .iter()
                .any(|e| e.id.as_deref() == Some(&id));
            if !taken_in_catalog && !self.root.exists(&prayer_filename(&id))? {
                return Ok(id);
            }
        }
        unreachable!("unbounded range")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn temp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn style(size: &str) -> Value {
        json!({"fontSize": size, "color": "base", "fontWeight": "400", "fontStyle": "normal"})
    }

    // Checklist 3: manifest read and normalised if valid; invalid manifest
    // silently treated as absent.
    #[test]
    fn manifest_valid_normalized_or_absent() {
        let dir = temp();
        std::fs::write(
            dir.path().join("manifest.json"),
            r#"{"name":"legacy","description":"Hi","defaultVariant":{"lang":"de","variant":"standard"},"stylePrefixStem":""}"#,
        )
        .unwrap();
        let library = Library::open(dir.path()).unwrap();
        let manifest = library.manifest().unwrap();
        assert_eq!(manifest.description.as_deref(), Some("Hi"));
        assert_eq!(manifest.style_prefix_stem, None);
        assert_eq!(
            library.preferred_variant(),
            Some(VariantKey {
                lang: "de",
                variant: "standard"
            })
        );

        std::fs::write(dir.path().join("manifest.json"), r#"{"description": 3}"#).unwrap();
        assert!(Library::open(dir.path()).unwrap().manifest().is_none());
        std::fs::write(dir.path().join("manifest.json"), "{nope").unwrap();
        assert!(Library::open(dir.path()).unwrap().manifest().is_none());
    }

    #[test]
    fn open_missing_folder_fails() {
        let dir = temp();
        let err = Library::open(dir.path().join("gone")).unwrap_err();
        assert_eq!(err.to_string(), "Folder not found");
    }

    #[test]
    fn open_lists_prayers_unscanned_and_scans() {
        let dir = temp();
        std::fs::write(dir.path().join("a.json"), "{}").unwrap();
        std::fs::write(dir.path().join("manifest.json"), "{}").unwrap();
        let mut library = Library::open(dir.path()).unwrap();
        assert_eq!(library.catalog().entries().len(), 1);
        assert!(!library.catalog().scan_complete());
        assert_eq!(library.scan_step(25), 1);
        assert!(library.catalog().scan_complete());
        assert_eq!(
            library.folder_name(),
            dir.path().file_name().unwrap().to_string_lossy()
        );
    }

    // Checklist 3: styles read and sanitised; "Library styles cleaned" once.
    #[test]
    fn styles_are_sanitized_and_reported_once() {
        let dir = temp();
        std::fs::create_dir_all(dir.path().join(".orthodox-prayer-toolkit")).unwrap();
        let styles = json!({"verse": style("1rem"), "Bad Kind": style("1rem")});
        std::fs::write(
            dir.path().join(STYLES_PATH),
            serde_json::to_string(&styles).unwrap(),
        )
        .unwrap();
        let mut library = Library::open(dir.path()).unwrap();
        assert_eq!(library.styles().len(), 1);
        assert_eq!(library.style_errors().len(), 1);
        assert_eq!(
            library.take_styles_notice().as_deref(),
            Some("invalid kind name")
        );
        assert_eq!(library.take_styles_notice(), None);
        // Rescanning the same unclean file does not report again.
        library.rescan();
        assert_eq!(library.take_styles_notice(), None);

        // Invalid JSON.
        std::fs::write(dir.path().join(STYLES_PATH), "{nope").unwrap();
        let mut library = Library::open(dir.path()).unwrap();
        assert!(library.styles().is_empty());
        assert_eq!(library.style_errors()[0].message, "Invalid styles JSON");
        assert_eq!(
            library.take_styles_notice().as_deref(),
            Some("Invalid styles JSON")
        );

        // Fixing the file and breaking it again reports again.
        std::fs::write(dir.path().join(STYLES_PATH), "{}").unwrap();
        library.reload_config();
        assert!(library.style_errors().is_empty());
        std::fs::write(dir.path().join(STYLES_PATH), "[]").unwrap();
        library.reload_config();
        assert!(library.take_styles_notice().is_some());
    }

    #[test]
    fn missing_styles_file_is_clean() {
        let dir = temp();
        let mut library = Library::open(dir.path()).unwrap();
        assert!(library.styles().is_empty());
        assert!(library.style_errors().is_empty());
        assert_eq!(library.take_styles_notice(), None);
    }

    // Checklist 3: new library flow and its folder-name rules.
    #[test]
    fn create_writes_manifest_and_opens() {
        let parent = temp();
        let spec = NewLibrary {
            name: " Mine ".into(),
            description: " My prayers ".into(),
            ..NewLibrary::default()
        };
        let library = Library::create(parent.path(), &spec).unwrap();
        assert_eq!(library.path(), parent.path().join("Mine"));
        assert_eq!(
            std::fs::read_to_string(parent.path().join("Mine/manifest.json")).unwrap(),
            "{\n  \"description\": \"My prayers\",\n  \"defaultVariant\": {\n    \"lang\": \"de\",\n    \"variant\": \"standard\"\n  }\n}\n"
        );
        assert_eq!(
            library.manifest().unwrap().description.as_deref(),
            Some("My prayers")
        );

        let err = Library::create(parent.path(), &spec).unwrap_err();
        assert_eq!(err.to_string(), "Folder already exists: Mine");
    }

    #[test]
    fn create_without_defaults_writes_empty_manifest() {
        let parent = temp();
        let spec = NewLibrary {
            name: "x".into(),
            lang: " ".into(),
            variant: "".into(),
            ..NewLibrary::default()
        };
        Library::create(parent.path(), &spec).unwrap();
        assert_eq!(
            std::fs::read_to_string(parent.path().join("x/manifest.json")).unwrap(),
            "{}\n"
        );
    }

    #[test]
    fn new_library_validation() {
        let ok = |name: &str| NewLibrary {
            name: name.into(),
            ..NewLibrary::default()
        };
        assert!(ok("a").validate().is_ok());
        assert!(matches!(
            ok("  ").validate(),
            Err(LibraryError::NameRequired)
        ));
        for bad in ["a/b", "a\\b", ".", ".."] {
            assert!(
                matches!(ok(bad).validate(), Err(LibraryError::NameHasSeparator)),
                "{bad}"
            );
        }
        let half = NewLibrary {
            lang: "de".into(),
            variant: "".into(),
            ..ok("a")
        };
        assert!(matches!(
            half.validate(),
            Err(LibraryError::DefaultsIncomplete)
        ));
        let half = NewLibrary {
            lang: "".into(),
            variant: "x".into(),
            ..ok("a")
        };
        assert!(matches!(
            half.validate(),
            Err(LibraryError::DefaultsIncomplete)
        ));
        let parent = temp();
        assert!(Library::create(parent.path(), &ok("a/b")).is_err());
        assert!(std::fs::read_dir(parent.path()).unwrap().next().is_none());
    }

    // Checklist 15: save writes manifest.json (pretty, newline).
    #[test]
    fn save_manifest_writes_and_updates() {
        let dir = temp();
        let mut library = Library::open(dir.path()).unwrap();
        library
            .save_manifest(LibraryManifest {
                description: Some("D".into()),
                default_variant: None,
                style_prefix_stem: Some(String::new()),
            })
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("manifest.json")).unwrap(),
            "{\n  \"description\": \"D\"\n}\n"
        );
        assert_eq!(library.manifest().unwrap().style_prefix_stem, None);
    }

    // Checklist 14/19: styles saved validated; "Cannot save library styles".
    #[test]
    fn save_styles_validates_first() {
        let dir = temp();
        let mut library = Library::open(dir.path()).unwrap();
        let good: StyleOverrides =
            serde_json::from_value(json!({"verse": style("1.2rem")})).unwrap();
        library.save_styles(&good).unwrap();
        let written = std::fs::read_to_string(dir.path().join(STYLES_PATH)).unwrap();
        assert!(written.ends_with("}\n"));
        assert_eq!(library.styles(), &good);
        assert_eq!(Library::open(dir.path()).unwrap().styles(), &good);

        let bad: StyleOverrides =
            serde_json::from_value(json!({"verse": style("huge"), "Bad": style("1rem")})).unwrap();
        let err = library.save_styles(&bad).unwrap_err();
        assert!(matches!(err, LibraryError::InvalidStyles(ref e) if !e.is_empty()));
        let two = LibraryError::InvalidStyles(vec![
            ValidationError {
                path: "/a".into(),
                message: "one".into(),
            },
            ValidationError {
                path: "/b".into(),
                message: "two".into(),
            },
        ]);
        assert_eq!(two.to_string(), "one · two");
        // Disk and memory untouched.
        assert_eq!(
            std::fs::read_to_string(dir.path().join(STYLES_PATH)).unwrap(),
            written
        );
        assert_eq!(library.styles(), &good);
    }

    // Checklist 5: new prayer id is the first free new-prayer-N.
    #[test]
    fn new_prayer_id_is_first_free() {
        let dir = temp();
        let mut library = Library::open(dir.path()).unwrap();
        assert_eq!(library.new_prayer_id().unwrap(), "new-prayer-1");
        std::fs::write(dir.path().join("new-prayer-1.json"), "{}").unwrap();
        std::fs::write(dir.path().join("new-prayer-3.json"), "{}").unwrap();
        assert_eq!(library.new_prayer_id().unwrap(), "new-prayer-2");
        std::fs::write(dir.path().join("new-prayer-2.json"), "{}").unwrap();
        assert_eq!(library.new_prayer_id().unwrap(), "new-prayer-4");
        // An id claimed by a differently named file also counts.
        std::fs::write(
            dir.path().join("other.json"),
            serde_json::to_string(&json!({"id": "new-prayer-4"})).unwrap(),
        )
        .unwrap();
        library.rescan();
        library
            .catalog_mut()
            .scan_all(&LibraryRoot::open(dir.path()).unwrap());
        assert_eq!(library.new_prayer_id().unwrap(), "new-prayer-5");
    }

    // Checklist 3: refresh rescans from disk.
    #[test]
    fn rescan_picks_up_new_files_and_manifest() {
        let dir = temp();
        let mut library = Library::open(dir.path()).unwrap();
        assert!(library.catalog().entries().is_empty());
        std::fs::write(dir.path().join("a.json"), "{}").unwrap();
        std::fs::write(dir.path().join("manifest.json"), r#"{"description":"n"}"#).unwrap();
        library.rescan();
        assert_eq!(library.catalog().entries().len(), 1);
        assert_eq!(
            library.manifest().unwrap().description.as_deref(),
            Some("n")
        );
    }
}
