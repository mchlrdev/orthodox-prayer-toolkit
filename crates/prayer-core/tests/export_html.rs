//! Compares the HTML export, flat export, attribute parser, tag map and
//! display title against the golden files generated from the TypeScript core
//! (`scripts/core-golden/export_html.mjs`).

use std::path::PathBuf;

use indexmap::IndexMap;
use prayer_core::display_title::resolve_display_title;
use prayer_core::export_html::{ExportHtmlOptions, Wrapper, export_html};
use prayer_core::export_variant::{export_variant, flat_prayer_json};
use prayer_core::model::{Prayer, StyleMap, VariantKey, VariantMeta};
use prayer_core::parse_html_attributes::parse_html_attributes;
use prayer_core::tag_map::{TagMap, tag_map_from_styles};
use serde_json::Value;

fn golden(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/golden/export_html")
        .join(name)
}

fn read_json(name: &str) -> Value {
    let text = std::fs::read_to_string(golden(name)).unwrap();
    serde_json::from_str(&text).unwrap()
}

fn prayer(file: &str) -> Prayer {
    serde_json::from_value(read_json(&format!("prayers/{file}"))).unwrap()
}

fn str_map(value: &Value) -> IndexMap<String, String> {
    value
        .as_object()
        .map(|o| {
            o.iter()
                .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned()))
                .collect()
        })
        .unwrap_or_default()
}

fn key(options: &Value) -> VariantKey<'_> {
    VariantKey {
        lang: options["lang"].as_str().unwrap(),
        variant: options["variant"].as_str().unwrap(),
    }
}

fn include_empty(options: &Value) -> bool {
    options["includeBlocksWithoutTranslation"].as_bool() == Some(true)
}

#[test]
fn html_export_matches_ts() {
    let cases = read_json("html_cases.json");
    let cases = cases.as_array().unwrap();
    assert!(cases.len() > 100);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let options = &case["options"];
        let tag_map: TagMap = str_map(&options["tagMap"]);
        let wrapper = options.get("wrapper").and_then(|w| {
            (w["enabled"] == true).then(|| Wrapper {
                tag: w["tag"].as_str().map(str::to_owned),
                attributes: str_map(&w["attributes"]),
            })
        });
        let opts = ExportHtmlOptions {
            key: key(options),
            tag_map: &tag_map,
            wrapper,
            include_blocks_without_translation: include_empty(options),
        };
        let actual = export_html(&prayer(case["prayer"].as_str().unwrap()), &opts);
        let expected = &case["expected"];
        match (actual, expected.get("html"), expected.get("error")) {
            (Ok(html), Some(want), _) => assert_eq!(&html, want.as_str().unwrap(), "{name}"),
            (Err(err), _, Some(want)) => {
                assert_eq!(&err.to_string(), want.as_str().unwrap(), "{name}")
            }
            (actual, ..) => panic!("{name}: unexpected result {actual:?}"),
        }
    }
}

#[test]
fn flat_export_matches_ts() {
    let cases = read_json("flat_cases.json");
    for case in cases.as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let options = &case["options"];
        let actual = export_variant(
            &prayer(case["prayer"].as_str().unwrap()),
            key(options),
            include_empty(options),
        );
        let expected = &case["expected"];
        match (actual, expected.get("json"), expected.get("error")) {
            (Ok(flat), Some(want), _) => {
                assert_eq!(&flat_prayer_json(&flat), want.as_str().unwrap(), "{name}")
            }
            (Err(err), _, Some(want)) => {
                assert_eq!(&err.to_string(), want.as_str().unwrap(), "{name}")
            }
            (actual, ..) => panic!("{name}: unexpected result {actual:?}"),
        }
    }
}

#[test]
fn parse_html_attributes_matches_ts() {
    let cases = read_json("attribute_cases.json");
    for case in cases.as_array().unwrap() {
        let input = case["input"].as_str().unwrap();
        let expected = &case["expected"];
        match parse_html_attributes(input) {
            Ok(attrs) => {
                assert_eq!(expected["ok"], true, "{input:?}");
                // Order matters: compare the serialized entry lists.
                let want = str_map(&expected["attributes"]);
                assert_eq!(
                    attrs.iter().collect::<Vec<_>>(),
                    want.iter().collect::<Vec<_>>(),
                    "{input:?}"
                );
            }
            Err(errors) => {
                assert_eq!(expected["ok"], false, "{input:?}");
                let want: Vec<&str> = expected["errors"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|e| e.as_str().unwrap())
                    .collect();
                let got: Vec<String> = errors.iter().map(ToString::to_string).collect();
                assert_eq!(got, want, "{input:?}");
            }
        }
    }
}

#[test]
fn tag_map_from_styles_matches_ts() {
    let cases = read_json("tag_map_cases.json");
    for case in cases.as_array().unwrap() {
        let styles: StyleMap = serde_json::from_value(case["styles"].clone()).unwrap();
        let want = str_map(&case["expected"]);
        let got = tag_map_from_styles(&styles);
        assert_eq!(
            got.iter().collect::<Vec<_>>(),
            want.iter().collect::<Vec<_>>()
        );
    }
}

#[test]
fn display_title_matches_ts() {
    let cases = read_json("display_title_cases.json");
    for case in cases.as_array().unwrap() {
        let id = case["prayer"]["id"].as_str().unwrap();
        let variants: Vec<VariantMeta> =
            serde_json::from_value(case["prayer"]["variants"].clone()).unwrap();
        let preferred = case["preferred"].as_object().map(|p| VariantKey {
            lang: p["lang"].as_str().unwrap(),
            variant: p["variant"].as_str().unwrap(),
        });
        assert_eq!(
            resolve_display_title(id, &variants, preferred),
            case["expected"].as_str().unwrap(),
            "{case}"
        );
    }
}
