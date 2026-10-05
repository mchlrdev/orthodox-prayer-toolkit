//! Library catalog: an index of the prayer files in a Library.
//!
//! The catalog is derived from the files and never the source of truth: a
//! prayer file is self-contained. It is built progressively (a stub per file
//! first, then metadata read in chunks of [`CHUNK_SIZE`]) so a UI can show the
//! list at once and drive the rest from its own loop with [`Catalog::scan_step`].
//! Rewrite of `packages/app/src/catalog/*`.

use prayer_core::kinds::compare_locale;
use std::collections::BTreeSet;

use prayer_core::library::{filename_matches_id, find_id_collisions, is_prayer_filename};
use prayer_core::{IdCollision, Prayer, ValidationError, VariantKey, VariantMeta};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::fs::LibraryRoot;

/// Files read per [`Catalog::scan_step`] (same as Electron).
pub const CHUNK_SIZE: usize = 25;

/// What the catalog knows about one prayer file.
#[derive(Clone, Debug, PartialEq)]
pub enum EntryStatus {
    /// Not read yet; only the path (and an id guessed from it) is known.
    Unscanned,
    /// Valid prayer.
    Valid(PrayerSummary),
    /// The file is not JSON.
    InvalidJson,
    /// JSON that fails the prayer schema or semantic rules.
    InvalidSchema(Vec<ValidationError>),
    /// The file could not be read (removed meanwhile, permissions, ...).
    Unreadable(String),
}

/// Index data of a valid prayer.
#[derive(Clone, Debug, PartialEq)]
pub struct PrayerSummary {
    pub description: Option<String>,
    /// Variants with their titles, in file order.
    pub variants: Vec<VariantMeta>,
    /// Block Kinds used, sorted.
    pub kinds: Vec<String>,
}

/// One prayer file in the catalog.
#[derive(Clone, Debug, PartialEq)]
pub struct CatalogEntry {
    /// Path relative to the Library root, `/` separated.
    pub path: String,
    /// The prayer's id; for unscanned files guessed from the file name, for
    /// invalid ones whatever string `id` the JSON had.
    pub id: Option<String>,
    /// The file name is not `{id}.json`.
    pub filename_mismatch: bool,
    pub status: EntryStatus,
}

/// Prayer id pattern from the schema, used for ids guessed from file names.
fn is_id_like(stem: &str) -> bool {
    !stem.is_empty()
        && stem.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

fn id_from_path(path: &str) -> Option<String> {
    let base = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let stem = base.strip_suffix(".json")?;
    is_id_like(stem).then(|| stem.to_owned())
}

impl CatalogEntry {
    /// Entry for a file not read yet; id comes from the file name.
    pub fn stub(path: &str) -> Self {
        Self {
            path: path.to_owned(),
            id: id_from_path(path),
            filename_mismatch: false,
            status: EntryStatus::Unscanned,
        }
    }

    /// Entry for a valid, parsed prayer.
    pub fn from_prayer(path: &str, prayer: &Prayer) -> Self {
        let kinds = prayer_core::kinds::index_kinds([prayer])
            .into_iter()
            .map(str::to_owned)
            .collect();
        Self {
            path: path.to_owned(),
            id: Some(prayer.id.clone()),
            filename_mismatch: !filename_matches_id(path, &prayer.id),
            status: EntryStatus::Valid(PrayerSummary {
                description: prayer.description.clone(),
                variants: prayer.variants.clone(),
                kinds,
            }),
        }
    }

    /// Entry from file text: valid, invalid JSON or invalid schema.
    pub fn from_text(path: &str, text: &str) -> Self {
        let Ok(data) = serde_json::from_str::<Value>(text) else {
            return Self {
                path: path.to_owned(),
                id: None,
                filename_mismatch: false,
                status: EntryStatus::InvalidJson,
            };
        };
        match prayer_core::validate::validate(&data) {
            Ok(prayer) => Self::from_prayer(path, &prayer),
            Err(errors) => {
                let id = data.get("id").and_then(Value::as_str).map(str::to_owned);
                Self {
                    path: path.to_owned(),
                    filename_mismatch: id.as_deref().is_some_and(|i| !filename_matches_id(path, i)),
                    id,
                    status: EntryStatus::InvalidSchema(errors),
                }
            }
        }
    }

    /// Entry for a file that could not be read.
    pub fn unreadable(path: &str, message: String) -> Self {
        Self {
            path: path.to_owned(),
            id: id_from_path(path),
            filename_mismatch: false,
            status: EntryStatus::Unreadable(message),
        }
    }

    pub fn is_scanned(&self) -> bool {
        self.status != EntryStatus::Unscanned
    }

    pub fn is_valid(&self) -> bool {
        matches!(self.status, EntryStatus::Valid(_))
    }

    /// Validation errors; "Invalid JSON" at `/` for files that are not JSON.
    pub fn errors(&self) -> Vec<ValidationError> {
        match &self.status {
            EntryStatus::InvalidJson => vec![ValidationError {
                path: "/".into(),
                message: "Invalid JSON".into(),
            }],
            EntryStatus::InvalidSchema(errors) => errors.clone(),
            EntryStatus::Unreadable(message) => vec![ValidationError {
                path: "/".into(),
                message: message.clone(),
            }],
            EntryStatus::Unscanned | EntryStatus::Valid(_) => Vec::new(),
        }
    }

    /// Title for the list: the `preferred` Variant (Library default) if the
    /// prayer has it, else its first Variant, else the id. `None` for entries
    /// that are not valid (the UI shows the path then).
    pub fn display_title(&self, preferred: Option<VariantKey<'_>>) -> Option<&str> {
        let EntryStatus::Valid(summary) = &self.status else {
            return None;
        };
        let id = self.id.as_deref().unwrap_or(&self.path);
        Some(prayer_core::display_title::resolve_display_title(
            id,
            &summary.variants,
            preferred,
        ))
    }

    fn matches(&self, needle: &str, preferred: Option<VariantKey<'_>>) -> bool {
        let contains = |hay: &str| hay.to_lowercase().contains(needle);
        let description = match &self.status {
            EntryStatus::Valid(s) => s.description.as_deref(),
            _ => None,
        };
        self.id.as_deref().is_some_and(contains)
            || self.display_title(preferred).is_some_and(contains)
            || description.is_some_and(contains)
            || contains(&self.path)
    }
}

/// Owned Variant key (`lang` + `variant`).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct VariantId {
    pub lang: String,
    pub variant: String,
}

impl VariantId {
    pub fn key(&self) -> VariantKey<'_> {
        VariantKey {
            lang: &self.lang,
            variant: &self.variant,
        }
    }
}

/// The prayer index of one Library.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Catalog {
    entries: Vec<CatalogEntry>,
    collisions: Vec<IdCollision>,
    kinds: Vec<String>,
    variants: Vec<VariantId>,
}

impl Catalog {
    /// Catalog of stubs for the prayer files among `files` (relative paths as
    /// from [`LibraryRoot::list_json_files`]); manifest, styles and toolkit
    /// files are skipped.
    pub fn from_files<'a>(files: impl IntoIterator<Item = &'a str>) -> Self {
        let mut catalog = Self {
            entries: files
                .into_iter()
                .filter(|path| is_prayer_filename(path))
                .map(CatalogEntry::stub)
                .collect(),
            ..Self::default()
        };
        catalog.reindex();
        catalog
    }

    /// Entries sorted by id (file path where the id is unknown).
    pub fn entries(&self) -> &[CatalogEntry] {
        &self.entries
    }

    pub fn entry(&self, path: &str) -> Option<&CatalogEntry> {
        self.entries.iter().find(|e| e.path == path)
    }

    /// Ids claimed by more than one file.
    pub fn collisions(&self) -> &[IdCollision] {
        &self.collisions
    }

    /// Union of Kinds of scanned prayers, sorted.
    pub fn kinds(&self) -> &[String] {
        &self.kinds
    }

    /// Union of Variants of scanned prayers, sorted by lang then variant.
    pub fn variants(&self) -> &[VariantId] {
        &self.variants
    }

    /// True once every entry has been read.
    pub fn scan_complete(&self) -> bool {
        self.entries.iter().all(CatalogEntry::is_scanned)
    }

    /// Paths of entries still unscanned.
    pub fn unscanned_paths(&self) -> impl Iterator<Item = &str> {
        self.entries
            .iter()
            .filter(|e| !e.is_scanned())
            .map(|e| e.path.as_str())
    }

    /// Reads the next (at most `chunk_size`) unscanned files and updates the
    /// index. Returns how many files were read; `0` means the scan is done.
    /// Call it in a loop (or on a worker) and refresh the list after each step.
    pub fn scan_step(&mut self, root: &LibraryRoot, chunk_size: usize) -> usize {
        let chunk: Vec<String> = self
            .unscanned_paths()
            .take(chunk_size.max(1))
            .map(str::to_owned)
            .collect();
        for path in &chunk {
            let entry = match root.read_text(path) {
                Ok(text) => CatalogEntry::from_text(path, &text),
                Err(err) => CatalogEntry::unreadable(path, err.to_string()),
            };
            self.replace_entry(entry);
        }
        if !chunk.is_empty() {
            self.reindex();
        }
        chunk.len()
    }

    /// Scans everything (tests, small Libraries, headless use).
    pub fn scan_all(&mut self, root: &LibraryRoot) {
        while self.scan_step(root, CHUNK_SIZE) > 0 {}
    }

    /// Insert or replace the entry for `entry.path` and reindex.
    pub fn upsert(&mut self, entry: CatalogEntry) {
        self.replace_entry(entry);
        self.reindex();
    }

    /// Re-read one file after it changed (save, import, outside change).
    pub fn refresh_path(&mut self, root: &LibraryRoot, path: &str) {
        if !is_prayer_filename(path) {
            return;
        }
        let entry = match root.read_text(path) {
            Ok(text) => CatalogEntry::from_text(path, &text),
            Err(err) if err.is_not_found() => {
                self.remove(path);
                return;
            }
            Err(err) => CatalogEntry::unreadable(path, err.to_string()),
        };
        self.upsert(entry);
    }

    /// Update from a prayer just saved by the app.
    pub fn upsert_prayer(&mut self, path: &str, prayer: &Prayer) {
        self.upsert(CatalogEntry::from_prayer(path, prayer));
    }

    /// Drop an entry (file deleted or renamed).
    pub fn remove(&mut self, path: &str) {
        self.entries.retain(|e| e.path != path);
        self.reindex();
    }

    /// Scanned valid entries that use `kind` (for Kind rename and delete).
    pub fn entries_using_kind<'a>(
        &'a self,
        kind: &'a str,
    ) -> impl Iterator<Item = &'a CatalogEntry> {
        self.entries.iter().filter(move |e| match &e.status {
            EntryStatus::Valid(s) => s.kinds.iter().any(|k| k == kind),
            _ => false,
        })
    }

    /// Entries matching `query`: case-insensitive substring over id, display
    /// title, description and path. An empty query matches everything.
    pub fn filter(&self, query: &str, preferred: Option<VariantKey<'_>>) -> Vec<&CatalogEntry> {
        let needle = query.trim().to_lowercase();
        self.entries
            .iter()
            .filter(|e| needle.is_empty() || e.matches(&needle, preferred))
            .collect()
    }

    fn replace_entry(&mut self, entry: CatalogEntry) {
        match self.entries.iter_mut().find(|e| e.path == entry.path) {
            Some(slot) => *slot = entry,
            None => self.entries.push(entry),
        }
    }

    fn reindex(&mut self) {
        self.entries.sort_by(|a, b| {
            let key = |e: &CatalogEntry| e.id.clone().unwrap_or_else(|| e.path.clone());
            compare_locale(&key(a), &key(b)).then_with(|| a.path.cmp(&b.path))
        });
        self.collisions = find_id_collisions(
            self.entries
                .iter()
                .map(|e| (e.path.as_str(), e.id.as_deref())),
        );
        let mut kinds = BTreeSet::new();
        let mut variants = BTreeSet::new();
        for entry in &self.entries {
            if let EntryStatus::Valid(summary) = &entry.status {
                kinds.extend(summary.kinds.iter().cloned());
                variants.extend(summary.variants.iter().map(|v| VariantId {
                    lang: v.lang.clone(),
                    variant: v.variant.clone(),
                }));
            }
        }
        self.kinds = kinds.into_iter().collect();
        self.kinds.sort_by(|a, b| compare_locale(a, b));
        self.variants = variants.into_iter().collect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn prayer_json(id: &str, titles: &[(&str, &str, &str)], kinds: &[&str]) -> Value {
        json!({
            "id": id,
            "type": "prayer",
            "description": format!("About {id}"),
            "variants": titles.iter().map(|(l, v, t)| json!({
                "lang": l, "variant": v, "title": t, "license": "unknown", "source": "draft"
            })).collect::<Vec<_>>(),
            "structure": kinds.iter().enumerate().map(|(i, k)| json!({
                "id": format!("b{}", i + 1), "kind": k, "translations": []
            })).collect::<Vec<_>>(),
        })
    }

    fn write(root: &LibraryRoot, path: &str, value: &Value) {
        root.write_json(path, value).unwrap();
    }

    fn fixture() -> (tempfile::TempDir, LibraryRoot) {
        let dir = tempfile::tempdir().unwrap();
        let root = LibraryRoot::open(dir.path()).unwrap();
        write(
            &root,
            "our-father.json",
            &prayer_json(
                "our-father",
                &[
                    ("de", "standard", "Vaterunser"),
                    ("en", "standard", "Our Father"),
                ],
                &["heading", "verse"],
            ),
        );
        write(
            &root,
            "creed.json",
            &prayer_json(
                "creed",
                &[("en", "standard", "Creed")],
                &["verse", "custom"],
            ),
        );
        root.write_text("broken.json", "{nope").unwrap();
        write(&root, "bad-schema.json", &json!({"id": "bad-schema"}));
        write(&root, "manifest.json", &json!({"description": "x"}));
        write(&root, ".orthodox-prayer-toolkit/styles.json", &json!({}));
        (dir, root)
    }

    // Checklist 3: only prayer files are listed; manifest/styles are not.
    // Checklist 4: not-yet-scanned files appear at once with an id from the
    // file name; sorted by id.
    #[test]
    fn starts_with_sorted_stubs() {
        let (_dir, root) = fixture();
        let files = root.list_json_files();
        let catalog = Catalog::from_files(files.iter().map(String::as_str));
        let paths: Vec<_> = catalog.entries().iter().map(|e| e.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "bad-schema.json",
                "broken.json",
                "creed.json",
                "our-father.json"
            ]
        );
        let creed = catalog.entry("creed.json").unwrap();
        assert_eq!(creed.id.as_deref(), Some("creed"));
        assert_eq!(creed.status, EntryStatus::Unscanned);
        assert!(!catalog.scan_complete());
        assert!(catalog.kinds().is_empty());
    }

    #[test]
    fn stub_id_needs_id_shape() {
        assert_eq!(CatalogEntry::stub("Not_An_Id.json").id, None);
        assert_eq!(
            CatalogEntry::stub("sub/a-b-1.json").id.as_deref(),
            Some("a-b-1")
        );
        assert_eq!(CatalogEntry::stub("a--b.json").id, None);
    }

    // Checklist 3: catalog built progressively in chunks.
    #[test]
    fn scans_in_chunks() {
        let (_dir, root) = fixture();
        let files = root.list_json_files();
        let mut catalog = Catalog::from_files(files.iter().map(String::as_str));
        assert_eq!(catalog.scan_step(&root, 3), 3);
        assert!(!catalog.scan_complete());
        assert_eq!(catalog.unscanned_paths().count(), 1);
        assert_eq!(catalog.scan_step(&root, 3), 1);
        assert!(catalog.scan_complete());
        assert_eq!(catalog.scan_step(&root, 3), 0);
        // chunk size 0 still makes progress
        let mut again = Catalog::from_files(files.iter().map(String::as_str));
        assert_eq!(again.scan_step(&root, 0), 1);
    }

    #[test]
    fn default_chunk_size_is_25() {
        assert_eq!(CHUNK_SIZE, 25);
        let dir = tempfile::tempdir().unwrap();
        let root = LibraryRoot::open(dir.path()).unwrap();
        for i in 0..30 {
            let id = format!("p-{i:02}");
            write(
                &root,
                &format!("{id}.json"),
                &prayer_json(&id, &[("de", "standard", "T")], &["verse"]),
            );
        }
        let files = root.list_json_files();
        let mut catalog = Catalog::from_files(files.iter().map(String::as_str));
        assert_eq!(catalog.scan_step(&root, CHUNK_SIZE), 25);
        assert_eq!(catalog.scan_step(&root, CHUNK_SIZE), 5);
        assert!(catalog.scan_complete());
    }

    // Checklist 3/4: entry statuses, union of kinds and variants.
    #[test]
    fn scan_fills_statuses_and_unions() {
        let (_dir, root) = fixture();
        let files = root.list_json_files();
        let mut catalog = Catalog::from_files(files.iter().map(String::as_str));
        catalog.scan_all(&root);

        let broken = catalog.entry("broken.json").unwrap();
        assert_eq!(broken.status, EntryStatus::InvalidJson);
        assert_eq!(broken.id, None);
        assert_eq!(broken.errors()[0].message, "Invalid JSON");
        assert_eq!(broken.errors()[0].path, "/");

        let bad = catalog.entry("bad-schema.json").unwrap();
        assert!(matches!(bad.status, EntryStatus::InvalidSchema(ref e) if !e.is_empty()));
        assert_eq!(bad.id.as_deref(), Some("bad-schema"));
        assert!(!bad.is_valid());

        let father = catalog.entry("our-father.json").unwrap();
        let EntryStatus::Valid(summary) = &father.status else {
            panic!("valid")
        };
        assert_eq!(summary.description.as_deref(), Some("About our-father"));
        assert_eq!(summary.kinds, ["heading", "verse"]);
        assert_eq!(summary.variants.len(), 2);

        assert_eq!(catalog.kinds(), ["custom", "heading", "verse"]);
        let variants: Vec<_> = catalog
            .variants()
            .iter()
            .map(|v| (v.lang.as_str(), v.variant.as_str()))
            .collect();
        assert_eq!(variants, [("de", "standard"), ("en", "standard")]);
        assert!(catalog.scan_complete());
    }

    // Checklist 4: display title uses the manifest default variant, else the
    // first variant.
    #[test]
    fn display_title_prefers_default_variant() {
        let (_dir, root) = fixture();
        let files = root.list_json_files();
        let mut catalog = Catalog::from_files(files.iter().map(String::as_str));
        catalog.scan_all(&root);
        let father = catalog.entry("our-father.json").unwrap();
        assert_eq!(father.display_title(None), Some("Vaterunser"));
        let en = VariantKey {
            lang: "en",
            variant: "standard",
        };
        assert_eq!(father.display_title(Some(en)), Some("Our Father"));
        let missing = VariantKey {
            lang: "fr",
            variant: "standard",
        };
        assert_eq!(father.display_title(Some(missing)), Some("Vaterunser"));
        assert_eq!(
            catalog.entry("broken.json").unwrap().display_title(None),
            None
        );
    }

    // Checklist 4: filter matches id, title, description, path; case-insensitive.
    #[test]
    fn filter_matches_all_fields() {
        let (_dir, root) = fixture();
        let files = root.list_json_files();
        let mut catalog = Catalog::from_files(files.iter().map(String::as_str));
        catalog.scan_all(&root);
        let ids = |q: &str, p| {
            catalog
                .filter(q, p)
                .iter()
                .map(|e| e.path.clone())
                .collect::<Vec<_>>()
        };
        assert_eq!(ids("", None).len(), 4);
        assert_eq!(ids("  ", None).len(), 4);
        assert_eq!(ids("CREED", None), ["creed.json"]); // id
        assert_eq!(ids("vaterunser", None), ["our-father.json"]); // title
        assert_eq!(ids("our father", None), Vec::<String>::new()); // en title not shown by default
        let en = VariantKey {
            lang: "en",
            variant: "standard",
        };
        assert_eq!(ids("our father", Some(en)), ["our-father.json"]);
        assert_eq!(ids("about creed", None), ["creed.json"]); // description
        assert_eq!(ids("broken.JSON", None), ["broken.json"]); // path
        assert!(ids("zzz", None).is_empty());
    }

    // Checklist 8 / sidebar alert: id collisions.
    #[test]
    fn finds_id_collisions() {
        let (_dir, root) = fixture();
        write(
            &root,
            "copy-of-creed.json",
            &prayer_json("creed", &[("en", "standard", "Creed 2")], &["verse"]),
        );
        let files = root.list_json_files();
        let mut catalog = Catalog::from_files(files.iter().map(String::as_str));
        catalog.scan_all(&root);
        assert_eq!(
            catalog.collisions(),
            [IdCollision {
                id: "creed".into(),
                paths: vec!["copy-of-creed.json".into(), "creed.json".into()]
            }]
        );
        assert!(
            catalog
                .entry("copy-of-creed.json")
                .unwrap()
                .filename_mismatch
        );
        assert!(!catalog.entry("creed.json").unwrap().filename_mismatch);
    }

    #[test]
    fn patching_entries_keeps_index_current() {
        let (_dir, root) = fixture();
        let files = root.list_json_files();
        let mut catalog = Catalog::from_files(files.iter().map(String::as_str));
        catalog.scan_all(&root);

        write(
            &root,
            "creed.json",
            &prayer_json("creed", &[("fr", "standard", "Credo")], &["quote"]),
        );
        catalog.refresh_path(&root, "creed.json");
        assert!(catalog.kinds().contains(&"quote".to_owned()));
        assert!(!catalog.kinds().contains(&"custom".to_owned()));
        assert!(catalog.variants().iter().any(|v| v.lang == "fr"));

        // New file appears, sorted in.
        write(
            &root,
            "a-new.json",
            &prayer_json("a-new", &[("de", "standard", "N")], &["verse"]),
        );
        catalog.refresh_path(&root, "a-new.json");
        assert_eq!(catalog.entries()[0].path, "a-new.json");

        // Deleted file disappears.
        root.delete("creed.json").unwrap();
        catalog.refresh_path(&root, "creed.json");
        assert!(catalog.entry("creed.json").is_none());

        // Non-prayer files are ignored.
        catalog.refresh_path(&root, "manifest.json");
        assert!(catalog.entry("manifest.json").is_none());

        catalog.remove("a-new.json");
        assert!(catalog.entry("a-new.json").is_none());
        assert_eq!(catalog.entries_using_kind("heading").count(), 1);
    }

    #[test]
    fn unreadable_file_is_marked_not_fatal() {
        let (_dir, root) = fixture();
        let files = root.list_json_files();
        let mut catalog = Catalog::from_files(files.iter().map(String::as_str));
        root.delete("creed.json").unwrap();
        catalog.scan_all(&root);
        assert!(matches!(
            catalog.entry("creed.json").unwrap().status,
            EntryStatus::Unreadable(_)
        ));
        assert!(catalog.scan_complete());
    }

    #[test]
    fn empty_library_is_complete() {
        let catalog = Catalog::from_files(["manifest.json"]);
        assert!(catalog.entries().is_empty());
        assert!(catalog.scan_complete());
    }
}
