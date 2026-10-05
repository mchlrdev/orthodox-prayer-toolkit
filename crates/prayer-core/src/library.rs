//! Library helpers: prayer filename rules, id collisions and `manifest.json`.
//!
//! Paths are plain `&str` relative to the Library root, with `/` or `\`
//! separators (Windows paths are accepted).

use std::fmt;

use indexmap::IndexMap;
use serde_json::Value;

use crate::kinds::compare_locale;
use crate::model::{DefaultVariant, IdCollision, LibraryManifest};
use crate::style_prefix::is_valid_style_prefix_stem;

/// Files in a Library that are JSON but not prayers.
const NON_PRAYER_BASENAMES: [&str; 2] = ["manifest.json", "styles.json"];

/// Folder holding toolkit config such as `styles.json`.
const TOOLKIT_DIR: &str = ".orthodox-prayer-toolkit";

/// Last path segment, splitting on both `/` and `\`.
fn basename(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// True if a relative path points at a prayer JSON file (excludes
/// `manifest.json`, `styles.json` and anything in the toolkit folder).
pub fn is_prayer_filename(relative_path: &str) -> bool {
    let normalized = relative_path.replace('\\', "/");
    let base = basename(&normalized);
    base.ends_with(".json")
        && !NON_PRAYER_BASENAMES.contains(&base)
        && !normalized.contains(&format!("/{TOOLKIT_DIR}/"))
        && !normalized.starts_with(&format!("{TOOLKIT_DIR}/"))
}

/// Expected filename for a prayer id (flat layout): `{id}.json`.
pub fn prayer_filename(id: &str) -> String {
    format!("{id}.json")
}

/// True if the file name of `path` is `{id}.json`.
pub fn filename_matches_id(path: &str, id: &str) -> bool {
    basename(path) == prayer_filename(id)
}

/// Finds ids claimed by more than one file, sorted by id; the paths of each
/// collision are sorted too.
///
/// `entries` pairs a relative path with the id read from the file, or `None`
/// when the file is unparseable (such files cannot collide).
pub fn find_id_collisions<'a>(
    entries: impl IntoIterator<Item = (&'a str, Option<&'a str>)>,
) -> Vec<IdCollision> {
    let mut by_id: IndexMap<&str, Vec<&str>> = IndexMap::new();
    for (path, id) in entries {
        if let Some(id) = id {
            by_id.entry(id).or_default().push(path);
        }
    }

    let mut collisions: Vec<IdCollision> = by_id
        .into_iter()
        .filter(|(_, paths)| paths.len() > 1)
        .map(|(id, mut paths)| {
            // JS `Array.sort()` compares UTF-16 code units, not code points.
            paths.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            IdCollision {
                id: id.to_owned(),
                paths: paths.into_iter().map(str::to_owned).collect(),
            }
        })
        .collect();
    collisions.sort_by(|a, b| compare_locale(&a.id, &b.id));
    collisions
}

/// Why a JSON value is not a valid `manifest.json`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ManifestError {
    NotAnObject,
    InvalidDescription,
    InvalidDefaultVariant,
    InvalidStylePrefixStem,
}

impl fmt::Display for ManifestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::NotAnObject => "manifest must be a JSON object",
            Self::InvalidDescription => "description must be a string",
            Self::InvalidDefaultVariant => {
                "defaultVariant must be an object with string lang and variant"
            }
            Self::InvalidStylePrefixStem => {
                "stylePrefixStem must be empty or a letter followed by letters and digits"
            }
        })
    }
}

impl std::error::Error for ManifestError {}

/// Validates and normalizes a parsed `manifest.json`: unknown keys (legacy
/// `name`, `version`) are dropped, an empty `stylePrefixStem` is dropped.
pub fn parse_library_manifest(value: &Value) -> Result<LibraryManifest, ManifestError> {
    let object = value.as_object().ok_or(ManifestError::NotAnObject)?;

    let description = match object.get("description") {
        None => None,
        Some(Value::String(text)) => Some(text.clone()),
        Some(_) => return Err(ManifestError::InvalidDescription),
    };

    let default_variant = match object.get("defaultVariant") {
        None => None,
        Some(Value::Object(dv)) => match (dv.get("lang"), dv.get("variant")) {
            (Some(Value::String(lang)), Some(Value::String(variant))) => Some(DefaultVariant {
                lang: lang.clone(),
                variant: variant.clone(),
            }),
            _ => return Err(ManifestError::InvalidDefaultVariant),
        },
        Some(_) => return Err(ManifestError::InvalidDefaultVariant),
    };

    let style_prefix_stem = match object.get("stylePrefixStem") {
        None => None,
        Some(Value::String(stem)) if is_valid_style_prefix_stem(stem) => Some(stem.clone()),
        Some(_) => return Err(ManifestError::InvalidStylePrefixStem),
    };

    Ok(normalize_library_manifest(LibraryManifest {
        description,
        default_variant,
        style_prefix_stem,
    }))
}

/// Drops an empty or invalid `stylePrefixStem`; everything else is kept.
pub fn normalize_library_manifest(mut manifest: LibraryManifest) -> LibraryManifest {
    manifest
        .style_prefix_stem
        .take_if(|stem| stem.is_empty() || !is_valid_style_prefix_stem(stem));
    manifest
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn excludes_manifest_and_toolkit_files() {
        assert!(is_prayer_filename("trisagion.json"));
        assert!(is_prayer_filename("sub/dir/trisagion.json"));
        assert!(!is_prayer_filename("manifest.json"));
        assert!(!is_prayer_filename("sub\\styles.json"));
        assert!(!is_prayer_filename(".orthodox-prayer-toolkit/styles.json"));
        assert!(!is_prayer_filename("a/.orthodox-prayer-toolkit/x.json"));
        assert!(!is_prayer_filename("notes.txt"));
        assert!(!is_prayer_filename("dir.json/"));
    }

    #[test]
    fn finds_duplicate_ids() {
        let collisions = find_id_collisions([
            ("b/foo.json", Some("foo")),
            ("a/foo.json", Some("foo")),
            ("bar.json", Some("bar")),
            ("broken.json", None),
        ]);
        assert_eq!(
            collisions,
            [IdCollision {
                id: "foo".into(),
                paths: vec!["a/foo.json".into(), "b/foo.json".into()],
            }]
        );
    }

    #[test]
    fn checks_filename_matches_id() {
        assert!(filename_matches_id(
            "tropar-prokopios.json",
            "tropar-prokopios"
        ));
        assert!(filename_matches_id(
            "a\\tropar-prokopios.json",
            "tropar-prokopios"
        ));
        assert!(!filename_matches_id("wrong.json", "tropar-prokopios"));
    }

    #[test]
    fn accepts_optional_manifest_shape() {
        let ok = |v: Value| parse_library_manifest(&v).is_ok();
        assert!(ok(json!({"description": "Examples",
            "defaultVariant": {"lang": "de", "variant": "standard"}})));
        assert!(ok(json!({})));
        assert!(ok(json!({"stylePrefixStem": "lit"})));
        assert!(ok(json!({"stylePrefixStem": ""})));
        assert_eq!(
            parse_library_manifest(&json!({"description": 1})),
            Err(ManifestError::InvalidDescription)
        );
        assert_eq!(
            parse_library_manifest(&Value::Null),
            Err(ManifestError::NotAnObject)
        );
        assert_eq!(
            parse_library_manifest(&json!({"stylePrefixStem": "1bad"})),
            Err(ManifestError::InvalidStylePrefixStem)
        );
        assert_eq!(
            parse_library_manifest(&json!({"stylePrefixStem": "bad_stem"})),
            Err(ManifestError::InvalidStylePrefixStem)
        );
        assert_eq!(
            parse_library_manifest(&json!({"defaultVariant": {"lang": "de"}})),
            Err(ManifestError::InvalidDefaultVariant)
        );
    }

    #[test]
    fn strips_legacy_keys_and_empty_stem() {
        let manifest = parse_library_manifest(&json!({
            "description": "Examples",
            "defaultVariant": {"lang": "de", "variant": "standard"},
            "name": "Old Title",
            "version": "0.1.0",
            "stylePrefixStem": "",
        }))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&manifest).unwrap(),
            json!({"description": "Examples",
                "defaultVariant": {"lang": "de", "variant": "standard"}})
        );
        let kept = parse_library_manifest(&json!({"stylePrefixStem": "liturgy"})).unwrap();
        assert_eq!(kept.style_prefix_stem.as_deref(), Some("liturgy"));
    }
}
