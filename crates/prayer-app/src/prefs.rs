//! App preferences: one JSON file in the OS config folder.
//!
//! Replaces the Electron renderer's `localStorage` keys (appearance, sidebar,
//! recent libraries, per-prayer column views, per-prayer export prefs).
//! Everything is best effort: a missing or corrupt file gives defaults,
//! malformed entries are dropped, nothing here panics. The pure mutators take
//! the current time as an argument so tests need no clock.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use indexmap::IndexMap;
use prayer_core::html_tags::{is_allowed_html_tag, is_allowed_wrapper_tag};
use serde::Serialize;
use serde_json::{Map, Value};

use crate::catalog::VariantId;

/// App name for the config folder. Beta builds use their own folder so they
/// do not touch the released app's settings.
pub const APP_NAME: &str = "Orthodox Prayer Toolkit Beta";
/// Preferences file name inside the config folder.
pub const FILE_NAME: &str = "preferences.json";
/// Recent libraries kept.
pub const MAX_RECENT: usize = 10;

/// Colour scheme preference.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ColorScheme {
    Light,
    Dark,
    #[default]
    System,
}

impl ColorScheme {
    fn parse(value: &Value) -> Option<Self> {
        match value.as_str()? {
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            "system" => Some(Self::System),
            _ => None,
        }
    }
}

/// Which sidebars are collapsed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarPrefs {
    pub library_collapsed: bool,
    pub content_collapsed: bool,
}

impl Default for SidebarPrefs {
    fn default() -> Self {
        Self {
            library_collapsed: false,
            content_collapsed: true,
        }
    }
}

/// A recently opened Library.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentLibrary {
    pub path: String,
    /// Milliseconds since the Unix epoch.
    pub last_opened: i64,
}

impl RecentLibrary {
    /// Folder name for display (POSIX or Windows separators).
    pub fn label(&self) -> &str {
        self.path
            .rsplit(['/', '\\'])
            .find(|part| !part.is_empty())
            .unwrap_or(&self.path)
    }
}

/// Layout export format.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LayoutFormat {
    Docx,
    Rtf,
}

/// HTML export fields, remembered together after a successful HTML export.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HtmlExportPrefs {
    pub tag_map: IndexMap<String, String>,
    pub wrapper_enabled: bool,
    pub wrapper_tag: String,
    pub wrapper_attributes: String,
}

/// Per-prayer export preferences.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPrefs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_blocks_without_translation: Option<bool>,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    pub html: Option<HtmlExportPrefs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_format: Option<LayoutFormat>,
    /// Empty means bare Kind names (no prefix).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layout_prefix_stem: Option<String>,
}

/// Fields written after a successful export; merged onto existing prefs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportPrefsPatch {
    pub include_blocks_without_translation: bool,
    pub html: Option<HtmlExportPrefs>,
    /// `(format, prefix stem)`.
    pub layout: Option<(LayoutFormat, String)>,
}

impl ExportPrefs {
    fn is_empty(&self) -> bool {
        self.include_blocks_without_translation.is_none()
            && self.html.is_none()
            && self.layout_format.is_none()
            && self.layout_prefix_stem.is_none()
    }

    /// Parses one entry; `None` if any present field is malformed or nothing
    /// is set.
    fn parse(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let mut prefs = Self::default();
        if let Some(v) = object.get("includeBlocksWithoutTranslation") {
            prefs.include_blocks_without_translation = Some(v.as_bool()?);
        }
        if let Some(v) = object.get("layoutFormat") {
            prefs.layout_format = Some(match v.as_str()? {
                "docx" => LayoutFormat::Docx,
                "rtf" => LayoutFormat::Rtf,
                _ => return None,
            });
        }
        if let Some(v) = object.get("layoutPrefixStem") {
            prefs.layout_prefix_stem = Some(v.as_str()?.to_owned());
        }
        let html_keys = [
            "tagMap",
            "wrapperEnabled",
            "wrapperTag",
            "wrapperAttributes",
        ];
        if html_keys.iter().any(|k| object.contains_key(*k)) {
            prefs.html = Some(parse_html(object)?);
        }
        (!prefs.is_empty()).then_some(prefs)
    }
}

fn parse_html(object: &Map<String, Value>) -> Option<HtmlExportPrefs> {
    let mut tag_map = IndexMap::new();
    for (kind, tag) in object.get("tagMap")?.as_object()? {
        let tag = tag.as_str().filter(|t| is_allowed_html_tag(t))?;
        tag_map.insert(kind.clone(), tag.to_owned());
    }
    let wrapper_tag = object
        .get("wrapperTag")?
        .as_str()
        .filter(|t| is_allowed_wrapper_tag(t))?;
    Some(HtmlExportPrefs {
        tag_map,
        wrapper_enabled: object.get("wrapperEnabled")?.as_bool()?,
        wrapper_tag: wrapper_tag.to_owned(),
        wrapper_attributes: object.get("wrapperAttributes")?.as_str()?.to_owned(),
    })
}

/// Values keyed by Library root path, then prayer path.
type ByRoot<T> = BTreeMap<String, BTreeMap<String, T>>;

/// All app preferences.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    pub color_scheme: ColorScheme,
    pub sidebar: SidebarPrefs,
    /// Newest first, at most [`MAX_RECENT`].
    pub recent_libraries: Vec<RecentLibrary>,
    prayer_views: ByRoot<Vec<VariantId>>,
    export_prefs: ByRoot<ExportPrefs>,
}

/// Milliseconds since the Unix epoch now (0 if the clock is before it).
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// Parses `{root: {path: T}}`, keeping well-formed entries only.
fn parse_by_root<T>(value: Option<&Value>, parse: impl Fn(&Value) -> Option<T>) -> ByRoot<T> {
    let mut out = ByRoot::new();
    let Some(roots) = value.and_then(Value::as_object) else {
        return out;
    };
    for (root, prayers) in roots {
        let Some(prayers) = prayers.as_object() else {
            continue;
        };
        let by_path: BTreeMap<String, T> = prayers
            .iter()
            .filter_map(|(path, v)| Some((path.clone(), parse(v)?)))
            .collect();
        if !by_path.is_empty() {
            out.insert(root.clone(), by_path);
        }
    }
    out
}

fn parse_columns(value: &Value) -> Option<Vec<VariantId>> {
    let columns: Vec<VariantId> = value
        .as_array()?
        .iter()
        .filter_map(|c| {
            let lang = c.get("lang")?.as_str().filter(|s| !s.is_empty())?;
            let variant = c.get("variant")?.as_str().filter(|s| !s.is_empty())?;
            Some(VariantId {
                lang: lang.to_owned(),
                variant: variant.to_owned(),
            })
        })
        .collect();
    (!columns.is_empty()).then_some(columns)
}

fn parse_recent(value: Option<&Value>) -> Vec<RecentLibrary> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let path = item.get("path")?.as_str().filter(|p| !p.is_empty())?;
            let last_opened = item.get("lastOpened")?;
            let last_opened = last_opened.as_i64().or_else(|| {
                last_opened
                    .as_f64()
                    .filter(|f| f.is_finite())
                    .map(|f| f as i64)
            })?;
            Some(RecentLibrary {
                path: path.to_owned(),
                last_opened,
            })
        })
        .take(MAX_RECENT)
        .collect()
}

/// Removes `path` from the inner map and drops the root if it became empty.
fn remove_entry<T>(map: &mut ByRoot<T>, root: &str, path: &str) {
    if let Some(by_path) = map.get_mut(root) {
        by_path.remove(path);
        if by_path.is_empty() {
            map.remove(root);
        }
    }
}

fn move_entry<T>(map: &mut ByRoot<T>, root: &str, from: &str, to: &str) {
    if from == to {
        return;
    }
    if let Some(by_path) = map.get_mut(root)
        && let Some(value) = by_path.remove(from)
    {
        by_path.insert(to.to_owned(), value);
    }
}

impl Prefs {
    /// Parses preferences from JSON text; anything unusable falls back to the
    /// default for that part.
    pub fn from_json(text: &str) -> Self {
        let Ok(Value::Object(object)) = serde_json::from_str::<Value>(text) else {
            return Self::default();
        };
        let defaults = SidebarPrefs::default();
        let sidebar = object.get("sidebar");
        let flag = |key: &str, default: bool| {
            sidebar
                .and_then(|s| s.get(key))
                .and_then(Value::as_bool)
                .unwrap_or(default)
        };
        Self {
            color_scheme: object
                .get("colorScheme")
                .and_then(ColorScheme::parse)
                .unwrap_or_default(),
            sidebar: SidebarPrefs {
                library_collapsed: flag("libraryCollapsed", defaults.library_collapsed),
                content_collapsed: flag("contentCollapsed", defaults.content_collapsed),
            },
            recent_libraries: parse_recent(object.get("recentLibraries")),
            prayer_views: parse_by_root(object.get("prayerViews"), parse_columns),
            export_prefs: parse_by_root(object.get("exportPrefs"), ExportPrefs::parse),
        }
    }

    /// Default preferences file: `<OS config dir>/<APP_NAME>/preferences.json`.
    pub fn default_path() -> Option<PathBuf> {
        // Like Electron's `userData`: the app name as is, on every platform
        // (`ProjectDirs` would rewrite it per OS).
        let dirs = directories::BaseDirs::new()?;
        Some(dirs.config_dir().join(APP_NAME).join(FILE_NAME))
    }

    /// Loads from `path`; missing or corrupt file gives defaults.
    pub fn load_from(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .map(|text| Self::from_json(&text))
            .unwrap_or_default()
    }

    /// Loads from [`Prefs::default_path`].
    pub fn load() -> Self {
        Self::default_path().map_or_else(Self::default, |p| Self::load_from(&p))
    }

    /// Saves atomically to `path`, creating the folder.
    pub fn save_to(&self, path: &Path) -> std::io::Result<()> {
        let text = crate::fs::to_pretty_json(self).map_err(std::io::Error::other)?;
        crate::fs::write_atomic(path, text.as_bytes())
    }

    /// Saves to [`Prefs::default_path`]; a missing config dir is an error.
    pub fn save(&self) -> std::io::Result<()> {
        let path = Self::default_path()
            .ok_or_else(|| std::io::Error::other("no config directory for this user"))?;
        self.save_to(&path)
    }

    /// Moves `path` to the front of the recent list (de-duplicated by exact
    /// path, capped at [`MAX_RECENT`]). Blank paths are ignored.
    pub fn push_recent(&mut self, path: &str, now_ms: i64) {
        let path = path.trim();
        if path.is_empty() {
            return;
        }
        self.recent_libraries.retain(|r| r.path != path);
        self.recent_libraries.insert(
            0,
            RecentLibrary {
                path: path.to_owned(),
                last_opened: now_ms,
            },
        );
        self.recent_libraries.truncate(MAX_RECENT);
    }

    /// Drops a recent library (e.g. folder gone).
    pub fn remove_recent(&mut self, path: &str) {
        self.recent_libraries.retain(|r| r.path != path);
    }

    /// Saved column layout of a prayer (visible Variants).
    pub fn prayer_view(&self, root: &str, path: &str) -> Option<&[VariantId]> {
        self.prayer_views.get(root)?.get(path).map(Vec::as_slice)
    }

    /// Remembers the visible columns; an empty list is ignored.
    pub fn set_prayer_view(&mut self, root: &str, path: &str, columns: Vec<VariantId>) {
        if columns.is_empty() {
            return;
        }
        self.prayer_views
            .entry(root.to_owned())
            .or_default()
            .insert(path.to_owned(), columns);
    }

    pub fn remove_prayer_view(&mut self, root: &str, path: &str) {
        remove_entry(&mut self.prayer_views, root, path);
    }

    /// Moves the saved view with a renamed prayer file.
    pub fn move_prayer_view(&mut self, root: &str, from: &str, to: &str) {
        move_entry(&mut self.prayer_views, root, from, to);
    }

    /// Export preferences remembered for a prayer.
    pub fn export_prefs(&self, root: &str, path: &str) -> Option<&ExportPrefs> {
        self.export_prefs.get(root)?.get(path)
    }

    /// Merges a successful-export patch: the include-empty flag is always
    /// written; HTML and Layout fields only when present in the patch.
    pub fn save_export_prefs(&mut self, root: &str, path: &str, patch: ExportPrefsPatch) {
        let by_path = self.export_prefs.entry(root.to_owned()).or_default();
        let prefs = by_path.entry(path.to_owned()).or_default();
        prefs.include_blocks_without_translation = Some(patch.include_blocks_without_translation);
        if let Some(html) = patch.html {
            prefs.html = Some(html);
        }
        if let Some((format, stem)) = patch.layout {
            prefs.layout_format = Some(format);
            prefs.layout_prefix_stem = Some(stem);
        }
    }

    pub fn remove_export_prefs(&mut self, root: &str, path: &str) {
        remove_entry(&mut self.export_prefs, root, path);
    }

    /// Moves export preferences with a renamed prayer file.
    pub fn move_export_prefs(&mut self, root: &str, from: &str, to: &str) {
        move_entry(&mut self.export_prefs, root, from, to);
    }

    /// Forgets everything stored for a prayer (view and export prefs).
    pub fn remove_prayer(&mut self, root: &str, path: &str) {
        self.remove_prayer_view(root, path);
        self.remove_export_prefs(root, path);
    }

    /// Moves everything stored for a prayer to its new path.
    pub fn rename_prayer(&mut self, root: &str, from: &str, to: &str) {
        self.move_prayer_view(root, from, to);
        self.move_export_prefs(root, from, to);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn column(lang: &str, variant: &str) -> VariantId {
        VariantId {
            lang: lang.into(),
            variant: variant.into(),
        }
    }

    fn html() -> HtmlExportPrefs {
        HtmlExportPrefs {
            tag_map: IndexMap::from([("verse".to_owned(), "p".to_owned())]),
            wrapper_enabled: true,
            wrapper_tag: "article".into(),
            wrapper_attributes: "class=\"x\"".into(),
        }
    }

    // Checklist 18: best effort, corrupt or missing file gives defaults.
    #[test]
    fn missing_or_corrupt_file_gives_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.json");
        assert_eq!(Prefs::load_from(&path), Prefs::default());
        for text in ["", "{nope", "[]", "null", "42", "\"x\""] {
            std::fs::write(&path, text).unwrap();
            assert_eq!(Prefs::load_from(&path), Prefs::default(), "{text}");
        }
        let defaults = Prefs::default();
        assert_eq!(defaults.color_scheme, ColorScheme::System);
        assert!(!defaults.sidebar.library_collapsed);
        assert!(defaults.sidebar.content_collapsed);
    }

    // Checklist 18: round trip of every preference.
    #[test]
    fn round_trips_through_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/cfg/p.json");
        let mut prefs = Prefs {
            color_scheme: ColorScheme::Dark,
            sidebar: SidebarPrefs {
                library_collapsed: true,
                content_collapsed: false,
            },
            ..Prefs::default()
        };
        prefs.push_recent("/a/lib", 5);
        prefs.set_prayer_view("/a/lib", "x.json", vec![column("de", "standard")]);
        prefs.save_export_prefs(
            "/a/lib",
            "x.json",
            ExportPrefsPatch {
                include_blocks_without_translation: true,
                html: Some(html()),
                layout: Some((LayoutFormat::Rtf, "Stem".into())),
            },
        );
        prefs.save_to(&path).unwrap();
        assert_eq!(Prefs::load_from(&path), prefs);
        assert!(std::fs::read_to_string(&path).unwrap().ends_with("}\n"));
    }

    #[test]
    fn invalid_values_fall_back_individually() {
        let prefs = Prefs::from_json(
            &json!({
                "colorScheme": "purple",
                "sidebar": {"libraryCollapsed": "yes", "contentCollapsed": false},
            })
            .to_string(),
        );
        assert_eq!(prefs.color_scheme, ColorScheme::System);
        assert!(!prefs.sidebar.library_collapsed);
        assert!(!prefs.sidebar.content_collapsed);
        let prefs = Prefs::from_json(r#"{"colorScheme":"light"}"#);
        assert_eq!(prefs.color_scheme, ColorScheme::Light);
    }

    // Checklist 3: recent libraries max 10, newest first, de-duplicated.
    #[test]
    fn recent_libraries_rules() {
        let mut prefs = Prefs::default();
        for i in 0..12 {
            prefs.push_recent(&format!("/lib/{i}"), i);
        }
        assert_eq!(prefs.recent_libraries.len(), MAX_RECENT);
        assert_eq!(prefs.recent_libraries[0].path, "/lib/11");
        prefs.push_recent("/lib/5", 100);
        assert_eq!(
            prefs.recent_libraries[0],
            RecentLibrary {
                path: "/lib/5".into(),
                last_opened: 100
            }
        );
        assert_eq!(
            prefs
                .recent_libraries
                .iter()
                .filter(|r| r.path == "/lib/5")
                .count(),
            1
        );
        assert_eq!(prefs.recent_libraries.len(), MAX_RECENT);
        prefs.push_recent("  ", 1);
        assert_eq!(prefs.recent_libraries.len(), MAX_RECENT);
        prefs.push_recent(" /lib/new ", 200);
        assert_eq!(prefs.recent_libraries[0].path, "/lib/new");
        prefs.remove_recent("/lib/new");
        assert_eq!(prefs.recent_libraries[0].path, "/lib/5");
        prefs.remove_recent("/missing");
    }

    #[test]
    fn recent_label_is_folder_name() {
        let r = |p: &str| RecentLibrary {
            path: p.into(),
            last_opened: 0,
        };
        assert_eq!(r("/home/me/Prayers").label(), "Prayers");
        assert_eq!(r("C:\\Users\\me\\Prayers\\").label(), "Prayers");
        assert_eq!(r("/").label(), "/");
    }

    // Checklist 18: malformed entries are filtered.
    #[test]
    fn malformed_entries_are_dropped() {
        let prefs = Prefs::from_json(
            &json!({
                "recentLibraries": [
                    {"path": "/ok", "lastOpened": 3},
                    {"path": "", "lastOpened": 3},
                    {"path": "/nots", "lastOpened": "x"},
                    {"lastOpened": 3},
                    "junk",
                    {"path": "/float", "lastOpened": 4.0}
                ],
                "prayerViews": {
                    "/lib": {
                        "a.json": [{"lang": "de", "variant": "standard"}, {"lang": "", "variant": "x"}, {"lang": 1}],
                        "b.json": [{"lang": "", "variant": ""}],
                        "c.json": "nope"
                    },
                    "/empty": {"a.json": []},
                    "/bad": 5
                },
                "exportPrefs": {
                    "/lib": {
                        "ok.json": {"includeBlocksWithoutTranslation": false},
                        "wrong-type.json": {"includeBlocksWithoutTranslation": "no"},
                        "bad-tag.json": {"tagMap": {"verse": "script"}, "wrapperEnabled": true, "wrapperTag": "article", "wrapperAttributes": ""},
                        "partial-html.json": {"tagMap": {}, "wrapperEnabled": true},
                        "bad-format.json": {"layoutFormat": "pdf"},
                        "empty.json": {},
                        "full.json": {"tagMap": {"verse": "p"}, "wrapperEnabled": false, "wrapperTag": "article", "wrapperAttributes": "", "layoutFormat": "docx", "layoutPrefixStem": ""}
                    }
                }
            })
            .to_string(),
        );
        let paths: Vec<_> = prefs
            .recent_libraries
            .iter()
            .map(|r| r.path.as_str())
            .collect();
        assert_eq!(paths, ["/ok", "/float"]);
        assert_eq!(
            prefs.prayer_view("/lib", "a.json"),
            Some(&[column("de", "standard")][..])
        );
        assert_eq!(prefs.prayer_view("/lib", "b.json"), None);
        assert_eq!(prefs.prayer_view("/lib", "c.json"), None);
        assert_eq!(prefs.prayer_view("/empty", "a.json"), None);
        assert!(prefs.export_prefs("/lib", "ok.json").is_some());
        for gone in [
            "wrong-type",
            "bad-tag",
            "partial-html",
            "bad-format",
            "empty",
        ] {
            assert!(
                prefs
                    .export_prefs("/lib", &format!("{gone}.json"))
                    .is_none(),
                "{gone}"
            );
        }
        let full = prefs.export_prefs("/lib", "full.json").unwrap();
        assert_eq!(full.layout_format, Some(LayoutFormat::Docx));
        assert_eq!(full.layout_prefix_stem.as_deref(), Some(""));
        assert_eq!(full.html.as_ref().unwrap().tag_map["verse"], "p");
    }

    #[test]
    fn recent_list_capped_on_load() {
        let items: Vec<_> = (0..15)
            .map(|i| json!({"path": format!("/l{i}"), "lastOpened": i}))
            .collect();
        let prefs = Prefs::from_json(&json!({"recentLibraries": items}).to_string());
        assert_eq!(prefs.recent_libraries.len(), MAX_RECENT);
    }

    // Checklist 4/18: per-prayer columns, with remove and move helpers.
    #[test]
    fn prayer_view_helpers() {
        let mut prefs = Prefs::default();
        prefs.set_prayer_view("/r", "a.json", vec![]);
        assert_eq!(prefs.prayer_view("/r", "a.json"), None);
        prefs.set_prayer_view(
            "/r",
            "a.json",
            vec![column("de", "standard"), column("en", "kjv")],
        );
        prefs.set_prayer_view("/other", "a.json", vec![column("fr", "x")]);
        prefs.move_prayer_view("/r", "a.json", "b.json");
        assert_eq!(prefs.prayer_view("/r", "a.json"), None);
        assert_eq!(prefs.prayer_view("/r", "b.json").unwrap().len(), 2);
        prefs.move_prayer_view("/r", "missing.json", "c.json");
        prefs.move_prayer_view("/r", "b.json", "b.json");
        assert!(prefs.prayer_view("/r", "b.json").is_some());
        prefs.remove_prayer_view("/r", "b.json");
        assert_eq!(prefs.prayer_view("/r", "b.json"), None);
        assert!(prefs.prayer_view("/other", "a.json").is_some());
        prefs.remove_prayer_view("/r", "b.json");
    }

    // Checklist 16/18: export prefs merge like Electron's saveExportPrefs.
    #[test]
    fn export_prefs_merge_and_helpers() {
        let mut prefs = Prefs::default();
        prefs.save_export_prefs(
            "/r",
            "a.json",
            ExportPrefsPatch {
                include_blocks_without_translation: false,
                html: Some(html()),
                layout: None,
            },
        );
        // A later layout export keeps the HTML fields.
        prefs.save_export_prefs(
            "/r",
            "a.json",
            ExportPrefsPatch {
                include_blocks_without_translation: true,
                html: None,
                layout: Some((LayoutFormat::Docx, String::new())),
            },
        );
        let stored = prefs.export_prefs("/r", "a.json").unwrap();
        assert_eq!(stored.include_blocks_without_translation, Some(true));
        assert_eq!(stored.html, Some(html()));
        assert_eq!(stored.layout_format, Some(LayoutFormat::Docx));
        assert_eq!(stored.layout_prefix_stem.as_deref(), Some(""));

        prefs.set_prayer_view("/r", "a.json", vec![column("de", "standard")]);
        prefs.rename_prayer("/r", "a.json", "b.json");
        assert!(prefs.export_prefs("/r", "b.json").is_some());
        assert!(prefs.export_prefs("/r", "a.json").is_none());
        assert!(prefs.prayer_view("/r", "b.json").is_some());
        prefs.remove_prayer("/r", "b.json");
        assert!(prefs.export_prefs("/r", "b.json").is_none());
        assert!(prefs.prayer_view("/r", "b.json").is_none());
        assert_eq!(prefs, Prefs::default());
    }

    #[test]
    fn export_prefs_serialize_flat_like_electron() {
        let prefs = ExportPrefs {
            include_blocks_without_translation: Some(true),
            html: Some(html()),
            layout_format: Some(LayoutFormat::Rtf),
            layout_prefix_stem: Some("S".into()),
        };
        let value = serde_json::to_value(&prefs).unwrap();
        assert_eq!(
            value,
            json!({
                "includeBlocksWithoutTranslation": true,
                "tagMap": {"verse": "p"},
                "wrapperEnabled": true,
                "wrapperTag": "article",
                "wrapperAttributes": "class=\"x\"",
                "layoutFormat": "rtf",
                "layoutPrefixStem": "S"
            })
        );
    }

    #[test]
    fn default_path_uses_app_name() {
        if let Some(path) = Prefs::default_path() {
            assert!(path.ends_with(FILE_NAME));
            assert!(path.parent().unwrap().ends_with(APP_NAME));
        }
    }

    #[test]
    fn save_to_unwritable_path_errors_without_panic() {
        let dir = tempfile::tempdir().unwrap();
        let blocker = dir.path().join("file");
        std::fs::write(&blocker, "x").unwrap();
        assert!(Prefs::default().save_to(&blocker.join("p.json")).is_err());
    }
}
