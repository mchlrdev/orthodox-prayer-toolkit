//! Compares validate / validate_styles / kind id helpers with the golden
//! files written by `scripts/core-golden/validate.mjs` from the TypeScript
//! core.

use std::fs;
use std::path::PathBuf;

use prayer_core::model::ValidationError;
use prayer_core::validate::validate;
use prayer_core::validate_styles::{
    KIND_ID_MAX_LENGTH, is_valid_kind_id, sanitize_kind_id_input, sanitize_styles, validate_styles,
};
use serde_json::{Value, json};

fn golden(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden/validate")
        .join(name);
    let raw = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&raw).unwrap()
}

/// Cases where Rust's message differs from the TypeScript core on purpose:
/// `case-name<TAB>path<TAB>reason`, see `known-differences.tsv`.
fn known_differences() -> Vec<(String, String)> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden/validate/known-differences.tsv");
    fs::read_to_string(path)
        .unwrap()
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
        .map(|l| {
            let mut cols = l.split('\t');
            let case = cols.next().unwrap().to_owned();
            let path = cols.next().unwrap().to_owned();
            assert!(
                cols.next().is_some_and(|reason| !reason.trim().is_empty()),
                "known difference without a reason: {l}"
            );
            (case, path)
        })
        .collect()
}

fn errors_from(value: &Value) -> Vec<ValidationError> {
    serde_json::from_value(value.clone()).unwrap()
}

#[test]
fn prayer_cases_match_typescript() {
    let allowed = known_differences();
    let cases = golden("prayer-cases.json");
    let cases = cases.as_array().unwrap();
    assert!(cases.len() > 100);

    let mut failures = Vec::new();
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let expected = &case["expected"];
        let actual = validate(&case["input"]);

        if expected["ok"] == json!(true) {
            match actual {
                Ok(prayer) => {
                    if serde_json::to_value(&prayer).unwrap() != expected["prayer"] {
                        failures.push(format!("{name}: valid, but the prayer differs"));
                    }
                }
                Err(errors) => failures.push(format!("{name}: expected valid, got {errors:?}")),
            }
            continue;
        }

        let expected = errors_from(&expected["errors"]);
        let Err(actual) = actual else {
            failures.push(format!("{name}: expected errors, got a valid prayer"));
            continue;
        };
        let paths = |errors: &[ValidationError]| -> Vec<String> {
            errors.iter().map(|e| e.path.clone()).collect()
        };
        if paths(&expected) != paths(&actual) {
            failures.push(format!(
                "{name}: paths differ\n  ts:   {expected:?}\n  rust: {actual:?}"
            ));
            continue;
        }
        for (ts, rust) in expected.iter().zip(&actual) {
            let known = allowed.iter().any(|(c, p)| c == name && *p == ts.path);
            if ts.message != rust.message && !known {
                failures.push(format!(
                    "{name}: message differs at {}\n  ts:   {}\n  rust: {}",
                    ts.path, ts.message, rust.message
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}

#[test]
fn style_cases_match_typescript() {
    let cases = golden("styles-cases.json");
    let cases = cases.as_array().unwrap();
    assert!(cases.len() > 100);

    let mut failures = Vec::new();
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let input = &case["input"];

        let (styles, errors) = sanitize_styles(input);
        let sanitized = json!({
            "styles": serde_json::to_value(&styles).unwrap(),
            "errors": serde_json::to_value(&errors).unwrap(),
        });
        if sanitized != case["sanitize"] {
            failures.push(format!(
                "{name}: sanitize differs\n  ts:   {}\n  rust: {sanitized}",
                case["sanitize"]
            ));
        }

        let validated = match validate_styles(input) {
            Ok(styles) => json!({"ok": true, "styles": serde_json::to_value(styles).unwrap()}),
            Err(errors) => json!({"ok": false, "errors": serde_json::to_value(errors).unwrap()}),
        };
        if validated != case["validate"] {
            failures.push(format!(
                "{name}: validate differs\n  ts:   {}\n  rust: {validated}",
                case["validate"]
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn kind_id_cases_match_typescript() {
    let golden = golden("kind-ids.json");
    assert_eq!(golden["maxLength"], json!(KIND_ID_MAX_LENGTH));
    for case in golden["cases"].as_array().unwrap() {
        let input = case["input"].as_str().unwrap();
        assert_eq!(
            is_valid_kind_id(input),
            case["valid"].as_bool().unwrap(),
            "is_valid_kind_id({input:?})"
        );
        assert_eq!(
            sanitize_kind_id_input(input),
            case["sanitized"].as_str().unwrap(),
            "sanitize_kind_id_input({input:?})"
        );
    }
}
