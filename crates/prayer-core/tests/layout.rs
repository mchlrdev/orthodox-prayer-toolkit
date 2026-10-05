//! Golden tests for the layout story, RTF and DOCX exports.
//!
//! Layout JSON and RTF are compared exactly. DOCX bytes differ from the TS
//! writer, so both sides are reduced to the same normalized content summary
//! (paragraph styles and runs, plus the style definitions); see
//! `scripts/core-golden/layout.mjs` for the TS side of that reduction.

use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::sync::LazyLock;

use prayer_core::export_docx::export_layout_docx;
use prayer_core::export_rtf::export_layout_rtf;
use prayer_core::layout::{LayoutOptions, LayoutStory, build_layout_story};
use prayer_core::model::Prayer;
use regex::{Captures, Regex};
use serde_json::{Map, Value, json};

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/layout")
}

fn read_json(path: &PathBuf) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

// ---- XML reduction (mirrors summarizeDocx in layout.mjs) ----

enum Token {
    Text(String),
    Start {
        name: String,
        attrs: Map<String, Value>,
        empty: bool,
    },
    End(String),
}

static ENTITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);").unwrap());
static TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"<(/?)([A-Za-z][\w:.-]*)([^>]*?)(/?)>|<[?!][^>]*>|([^<]+)").unwrap()
});
static ATTR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"([\w:.-]+)="([^"]*)""#).unwrap());

fn unescape_xml(s: &str) -> String {
    ENTITY
        .replace_all(s, |caps: &Captures| match &caps[1] {
            "lt" => "<".to_owned(),
            "gt" => ">".to_owned(),
            "amp" => "&".to_owned(),
            "quot" => "\"".to_owned(),
            "apos" => "'".to_owned(),
            numeric => {
                let code = match numeric.strip_prefix("#x") {
                    Some(hex) => u32::from_str_radix(hex, 16),
                    None => numeric[1..].parse(),
                };
                char::from_u32(code.unwrap()).unwrap().to_string()
            }
        })
        .into_owned()
}

fn xml_tokens(xml: &str) -> Vec<Token> {
    TOKEN
        .captures_iter(xml)
        .filter_map(|caps| {
            if let Some(text) = caps.get(5) {
                return Some(Token::Text(unescape_xml(text.as_str())));
            }
            let name = caps.get(2)?.as_str().to_owned();
            if !caps[1].is_empty() {
                return Some(Token::End(name));
            }
            let attrs = ATTR
                .captures_iter(&caps[3])
                .map(|a| (a[1].to_owned(), Value::String(unescape_xml(&a[2]))))
                .collect();
            Some(Token::Start {
                name,
                attrs,
                empty: &caps[4] == "/",
            })
        })
        .collect()
}

fn attr(attrs: &Map<String, Value>, key: &str) -> Value {
    attrs.get(key).cloned().unwrap_or(Value::Null)
}

/// Paragraphs: style id plus runs (text with character style, or a break).
fn summarize_document(xml: &str) -> Value {
    let mut paragraphs: Vec<Value> = Vec::new();
    let mut para: Option<(Value, Vec<Value>)> = None;
    let mut run: Option<(Value, Vec<Value>)> = None;
    let mut text: Option<String> = None;
    for token in xml_tokens(xml) {
        match token {
            Token::Start { name, .. } if name == "w:p" => para = Some((Value::Null, Vec::new())),
            Token::End(name) if name == "w:p" => {
                if let Some((style, runs)) = para.take() {
                    paragraphs.push(json!({ "style": style, "runs": runs }));
                }
            }
            _ if para.is_none() => {}
            Token::Start { name, attrs, empty } => match name.as_str() {
                "w:pStyle" => para.as_mut().unwrap().0 = attr(&attrs, "w:val"),
                "w:r" if !empty => run = Some((Value::Null, Vec::new())),
                _ if run.is_none() => {}
                "w:rStyle" => run.as_mut().unwrap().0 = attr(&attrs, "w:val"),
                "w:br" => run.as_mut().unwrap().1.push(json!({ "break": true })),
                "w:t" if empty => run.as_mut().unwrap().1.push(json!({ "text": "" })),
                "w:t" => text = Some(String::new()),
                _ => {}
            },
            Token::End(name) => match name.as_str() {
                "w:r" => {
                    let (style, items) = run.take().expect("run open");
                    let runs = &mut para.as_mut().unwrap().1;
                    for item in items {
                        runs.push(if item.get("break").is_some() {
                            item
                        } else {
                            json!({ "text": item["text"], "style": style })
                        });
                    }
                }
                "w:t" => {
                    let value = text.take().unwrap_or_default();
                    if let Some((_, items)) = run.as_mut() {
                        items.push(json!({ "text": value }));
                    }
                }
                _ => {}
            },
            Token::Text(chunk) => {
                if let Some(text) = text.as_mut() {
                    text.push_str(&chunk);
                }
            }
        }
    }
    Value::Array(paragraphs)
}

/// Styles with the given ids: name, type, basedOn, next, run properties.
fn summarize_styles(xml: &str, ids: &[&str]) -> Value {
    let mut styles: Vec<Map<String, Value>> = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut in_style = false;
    for token in xml_tokens(xml) {
        match token {
            Token::Start { name, attrs, empty } => {
                let parent = stack.last().map(String::as_str);
                let grandparent = stack.len().checked_sub(2).map(|i| stack[i].as_str());
                if name == "w:style" {
                    in_style = true;
                    let mut style = Map::new();
                    style.insert("id".into(), attr(&attrs, "w:styleId"));
                    style.insert("name".into(), Value::Null);
                    style.insert("type".into(), attr(&attrs, "w:type"));
                    style.insert("basedOn".into(), Value::Null);
                    style.insert("next".into(), Value::Null);
                    style.insert("runProps".into(), Value::Object(Map::new()));
                    styles.push(style);
                } else if in_style && parent == Some("w:style") {
                    let key = match name.as_str() {
                        "w:name" => Some("name"),
                        "w:basedOn" => Some("basedOn"),
                        "w:next" => Some("next"),
                        _ => None,
                    };
                    if let Some(key) = key {
                        styles
                            .last_mut()
                            .unwrap()
                            .insert(key.into(), attr(&attrs, "w:val"));
                    }
                } else if in_style && parent == Some("w:rPr") && grandparent == Some("w:style") {
                    let value = attrs.get("w:val").cloned().unwrap_or(Value::Bool(true));
                    let props = styles.last_mut().unwrap()["runProps"]
                        .as_object_mut()
                        .unwrap();
                    props.insert(name.trim_start_matches("w:").to_owned(), value);
                }
                if !empty {
                    stack.push(name);
                }
            }
            Token::End(name) => {
                stack.pop();
                if name == "w:style" {
                    in_style = false;
                }
            }
            Token::Text(_) => {}
        }
    }
    Value::Array(
        styles
            .into_iter()
            .filter(|s| ids.contains(&s["id"].as_str().unwrap_or_default()))
            .map(Value::Object)
            .collect(),
    )
}

fn summarize_docx(bytes: &[u8], story: &LayoutStory) -> Value {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).expect("DOCX is a zip");
    let mut read = |name: &str| {
        let mut out = String::new();
        archive
            .by_name(name)
            .unwrap()
            .read_to_string(&mut out)
            .unwrap();
        out
    };
    let document = read("word/document.xml");
    let styles = read("word/styles.xml");
    let mut ids: Vec<&str> = vec![story.note_style_name.as_str()];
    ids.extend(story.paragraphs.iter().map(|p| p.style_name.as_str()));
    json!({
        "paragraphs": summarize_document(&document),
        "styles": summarize_styles(&styles, &ids),
    })
}

// ---- golden cases ----

fn options_from(value: &Value) -> LayoutOptions<'_> {
    LayoutOptions::new(
        value["lang"].as_str().unwrap(),
        value["variant"].as_str().unwrap(),
    )
    .with_prefix_stem(value["prefixStem"].as_str().unwrap_or(""))
    .with_blocks_without_translation(
        value["includeBlocksWithoutTranslation"]
            .as_bool()
            .unwrap_or(false),
    )
}

#[test]
fn golden_layout_rtf_and_docx() {
    let dir = golden_dir();
    let mut checked = 0;
    for entry in std::fs::read_dir(dir.join("cases")).unwrap() {
        let path = entry.unwrap().path();
        let file = read_json(&path);
        let prayer_json =
            std::fs::read_to_string(dir.join(file["prayer"].as_str().unwrap())).unwrap();
        let prayer: Prayer = serde_json::from_str(&prayer_json).unwrap();
        for case in file["cases"].as_array().unwrap() {
            let label = format!("{} {}", path.display(), case["options"]);
            let options = options_from(&case["options"]);

            if let Some(error) = case.get("error") {
                let err = build_layout_story(&prayer, &options).unwrap_err();
                assert_eq!(&Value::from(err.to_string()), error, "{label}");
                assert!(export_layout_rtf(&prayer, &options).is_err(), "{label}");
                assert!(export_layout_docx(&prayer, &options).is_err(), "{label}");
                checked += 1;
                continue;
            }

            let story = build_layout_story(&prayer, &options).unwrap();
            assert_eq!(
                serde_json::to_value(&story).unwrap(),
                case["layout"],
                "{label}"
            );

            if let Some(expected) = case["rtf"].as_str() {
                assert_eq!(
                    export_layout_rtf(&prayer, &options).unwrap(),
                    expected,
                    "{label}"
                );
            }

            let bytes = export_layout_docx(&prayer, &options).unwrap();
            assert_eq!(summarize_docx(&bytes, &story), case["docx"], "{label}");
            checked += 1;
        }
    }
    assert!(checked > 50, "only {checked} cases ran");
}
