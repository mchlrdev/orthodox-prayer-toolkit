//! Compares kinds.rs, resolve_styles.rs and library.rs with the TypeScript
//! core's output (`scripts/core-golden/kinds.mjs`). Each golden file holds
//! cases with an `expected` value; the whole file is recomputed in Rust,
//! pretty-printed and compared byte for byte, which also checks key order.

use std::fs;
use std::path::PathBuf;

use prayer_core::kinds::{
    DEFAULT_DELETE_FALLBACK, delete_kind, index_kinds, index_variants, rename_kind,
};
use prayer_core::library::{
    filename_matches_id, find_id_collisions, is_prayer_filename, parse_library_manifest,
    prayer_filename,
};
use prayer_core::resolve_styles::{
    DEFAULT_KIND_STYLES, FALLBACK_KIND_STYLE, ResolveStylesOptions, StyleOverrides, resolve_styles,
};
use prayer_core::{KindStyle, Prayer};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

fn golden(name: &str) -> (String, Value) {
    let path: PathBuf = [env!("CARGO_MANIFEST_DIR"), "tests/golden/kinds", name]
        .iter()
        .collect();
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let value = serde_json::from_str(&text).unwrap();
    (text, value)
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap() + "\n"
}

/// Replaces `expected` of every case with `compute(case)` (`None` removes
/// it), checking each case on its own for a readable failure.
fn recompute(cases: &mut Value, compute: impl Fn(&Value) -> Option<Value>) {
    for case in cases.as_array_mut().unwrap() {
        let name = case["name"].as_str().unwrap_or("<unnamed>").to_owned();
        let object = case.as_object_mut().unwrap();
        let before = object.get("expected").cloned();
        let actual = compute(&Value::Object(object.clone()));
        assert_eq!(
            before.as_ref().map(pretty),
            actual.as_ref().map(pretty),
            "case: {name}"
        );
        match actual {
            Some(value) => object.insert("expected".into(), value),
            None => object.remove("expected"),
        };
    }
}

fn check(file: &str, compute: impl Fn(&Value) -> Option<Value>) {
    let (text, mut cases) = golden(file);
    recompute(&mut cases, compute);
    assert_eq!(pretty(&cases), text, "{file} differs byte for byte");
}

fn field<T: DeserializeOwned>(case: &Value, key: &str) -> T {
    serde_json::from_value(case[key].clone()).unwrap_or_else(|e| panic!("{key}: {e}"))
}

fn strings(items: &[&str]) -> Value {
    json!(items)
}

#[test]
fn index_kinds_matches_golden() {
    check("index_kinds.json", |case| {
        let prayers: Vec<Prayer> = field(case, "prayers");
        Some(strings(&index_kinds(&prayers)))
    });
}

#[test]
fn index_variants_matches_golden() {
    check("index_variants.json", |case| {
        let prayers: Vec<Prayer> = field(case, "prayers");
        let keys: Vec<Value> = index_variants(&prayers)
            .iter()
            .map(|k| json!({"lang": k.lang, "variant": k.variant}))
            .collect();
        Some(Value::Array(keys))
    });
}

#[test]
fn rename_kind_matches_golden() {
    check("rename_kind.json", |case| {
        let mut prayer: Prayer = field(case, "prayer");
        let (from, to): (String, String) = (field(case, "from"), field(case, "to"));
        rename_kind(&mut prayer, &from, &to);
        Some(serde_json::to_value(prayer).unwrap())
    });
}

#[test]
fn delete_kind_matches_golden() {
    check("delete_kind.json", |case| {
        let mut prayer: Prayer = field(case, "prayer");
        let kind: String = field(case, "kind");
        let fallback = case
            .get("fallback")
            .map_or(DEFAULT_DELETE_FALLBACK, |f| f.as_str().unwrap());
        delete_kind(&mut prayer, &kind, fallback);
        Some(serde_json::to_value(prayer).unwrap())
    });
}

#[test]
fn default_styles_match_golden() {
    let (text, _) = golden("default_styles.json");
    let actual = json!({
        "defaults": &*DEFAULT_KIND_STYLES,
        "fallback": &*FALLBACK_KIND_STYLE,
    });
    assert_eq!(pretty(&actual), text);
}

#[test]
fn resolve_styles_matches_golden() {
    check("resolve_styles.json", |case| {
        let discovered: Vec<String> = field(case, "discoveredKinds");
        let overrides = |key: &str| -> Option<StyleOverrides> {
            case.get(key)
                .map(|v| serde_json::from_value(v.clone()).unwrap())
        };
        let (app, library) = (overrides("appDefaults"), overrides("libraryOverrides"));
        let preset: Option<KindStyle> = case
            .get("defaultPreset")
            .map(|v| serde_json::from_value(v.clone()).unwrap());
        let options = ResolveStylesOptions {
            app_defaults: app.as_ref(),
            library_overrides: library.as_ref(),
            default_preset: preset.as_ref(),
        };
        Some(serde_json::to_value(resolve_styles(&discovered, &options)).unwrap())
    });
}

#[test]
fn library_filenames_match_golden() {
    let (text, mut sections) = golden("library_filenames.json");

    recompute(&mut sections["isPrayerFilename"], |case| {
        Some(json!(is_prayer_filename(case["path"].as_str().unwrap())))
    });
    recompute(&mut sections["prayerFilename"], |case| {
        Some(json!(prayer_filename(case["id"].as_str().unwrap())))
    });
    recompute(&mut sections["filenameMatchesId"], |case| {
        Some(json!(filename_matches_id(
            case["path"].as_str().unwrap(),
            case["id"].as_str().unwrap()
        )))
    });
    recompute(&mut sections["findIdCollisions"], |case| {
        let entries = case["entries"].as_array().unwrap();
        let collisions = find_id_collisions(
            entries
                .iter()
                .map(|e| (e["path"].as_str().unwrap(), e["id"].as_str())),
        );
        let items: Vec<Value> = collisions
            .into_iter()
            .map(|c| json!({"id": c.id, "paths": c.paths}))
            .collect();
        Some(Value::Array(items))
    });

    assert_eq!(pretty(&sections), text, "library_filenames.json differs");
}

#[test]
fn manifest_matches_golden() {
    check("manifest.json", |case| {
        let parsed = parse_library_manifest(&case["input"]);
        assert_eq!(
            parsed.is_ok(),
            case["valid"].as_bool().unwrap(),
            "validity of {}",
            case["name"]
        );
        parsed.ok().map(|m| serde_json::to_value(m).unwrap())
    });
}
