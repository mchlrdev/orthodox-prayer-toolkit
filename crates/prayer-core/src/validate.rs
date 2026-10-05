//! Validate unknown JSON as a prayer document.
//!
//! Two stages, like the TypeScript core: the JSON Schema first (every
//! violation is reported), then semantic rules (duplicate ids, text xor
//! lines, inline run rules) which only run once the schema passes.
//!
//! The TypeScript core reports Ajv's errors. To give both cores the same
//! `path` and `message`, [`ajv`] maps `jsonschema` errors onto Ajv's message
//! templates, flattens `oneOf`/`anyOf` branch errors the way Ajv does and
//! restores Ajv's order. Known wording gaps are listed in the golden test.

use std::borrow::Cow;
use std::collections::HashSet;
use std::sync::LazyLock;

use jsonschema::Validator;
use serde_json::{Map, Value};

use crate::model::{Block, InlineContent, Prayer, RunRole, ValidationError};
use crate::text_runs::normalize_runs;

struct Schema {
    document: Value,
    validator: Validator,
}

static SCHEMA: LazyLock<Schema> = LazyLock::new(|| {
    let document: Value =
        serde_json::from_str(crate::PRAYER_SCHEMA).expect("prayer.schema.json is valid JSON");
    let validator = jsonschema::draft202012::new(&document).expect("prayer.schema.json compiles");
    Schema {
        document,
        validator,
    }
});

/// Validate unknown JSON as a prayer document and return the typed
/// [`Prayer`].
///
/// Missing translations are allowed (omit the entry, never empty keys).
/// Legacy `meta.revised_at` is dropped before validation, so older files
/// still pass. The semantic rules run only when the schema passes.
pub fn validate(data: &Value) -> Result<Prayer, Vec<ValidationError>> {
    let prepared = strip_legacy_fields(data);
    let schema = &*SCHEMA;

    let errors = ajv::errors(
        &schema.document,
        &prepared,
        schema.validator.iter_errors(&prepared),
    );
    if !errors.is_empty() {
        return Err(errors);
    }

    let prayer: Prayer = serde_json::from_value(integral_tone(prepared).into_owned())
        .map_err(|e| vec![error("/", format!("Invalid prayer: {e}"))])?;

    let semantic = semantic_errors(&prayer);
    if semantic.is_empty() {
        Ok(prayer)
    } else {
        Err(semantic)
    }
}

fn error(path: impl Into<String>, message: impl Into<String>) -> ValidationError {
    ValidationError {
        path: path.into(),
        message: message.into(),
    }
}

/// Drop legacy fields so older prayer JSON still validates: `meta.revised_at`
/// goes, and a `meta` left empty goes with it.
fn strip_legacy_fields(data: &Value) -> Cow<'_, Value> {
    let has_legacy = data
        .get("meta")
        .and_then(Value::as_object)
        .is_some_and(|meta| meta.contains_key("revised_at"));
    if !has_legacy {
        return Cow::Borrowed(data);
    }

    let mut next = data.clone();
    if let Some(root) = next.as_object_mut() {
        let meta_is_empty = root
            .get_mut("meta")
            .and_then(Value::as_object_mut)
            .is_some_and(|meta| {
                meta.shift_remove("revised_at");
                meta.is_empty()
            });
        if meta_is_empty {
            root.shift_remove("meta");
        }
    }
    Cow::Owned(next)
}

/// JSON Schema accepts `4.0` as an integer, serde does not read it as `u8`:
/// rewrite a whole-number float `tone` as an integer.
fn integral_tone(data: Cow<'_, Value>) -> Cow<'_, Value> {
    let float_tone = data
        .get("tone")
        .and_then(Value::as_f64)
        .filter(|t| !data["tone"].is_i64() && !data["tone"].is_u64() && t.fract() == 0.0);
    match float_tone {
        Some(tone) => {
            let mut next = data.into_owned();
            next["tone"] = Value::from(tone as i64);
            Cow::Owned(next)
        }
        None => data,
    }
}

fn semantic_errors(prayer: &Prayer) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    let mut block_ids = HashSet::new();
    for (i, block) in prayer.structure.iter().enumerate() {
        if !block_ids.insert(block.id.as_str()) {
            errors.push(error(
                format!("/structure/{i}/id"),
                format!("Duplicate block id \"{}\"", block.id),
            ));
        }
        block_errors(block, i, &mut errors);
    }

    let mut variant_keys = HashSet::new();
    for (i, variant) in prayer.variants.iter().enumerate() {
        if !variant_keys.insert(variant.key()) {
            errors.push(error(
                format!("/variants/{i}"),
                format!(
                    "Duplicate variant lang=\"{}\" variant=\"{}\"",
                    variant.lang, variant.variant
                ),
            ));
        }
    }

    errors
}

fn block_errors(block: &Block, block_index: usize, errors: &mut Vec<ValidationError>) {
    let mut seen = HashSet::new();
    for (j, translation) in block.translations.iter().enumerate() {
        let path = format!("/structure/{block_index}/translations/{j}");

        if !seen.insert(translation.key()) {
            errors.push(error(
                path.as_str(),
                format!(
                    "Duplicate translation for lang=\"{}\" variant=\"{}\"",
                    translation.lang, translation.variant
                ),
            ));
        }
        if translation.text.is_some() && translation.lines.is_some() {
            errors.push(error(
                path.as_str(),
                "Translation must have either text or lines, not both",
            ));
        }
        if let Some(text) = &translation.text {
            inline_errors(text, format!("{path}/text"), errors);
        }
        for (k, line) in translation.lines.iter().flatten().enumerate() {
            inline_errors(line, format!("{path}/lines/{k}"), errors);
        }
    }
}

/// Run arrays must hold something after normalization, and at least one note
/// (otherwise a plain string says the same).
fn inline_errors(content: &InlineContent, path: String, errors: &mut Vec<ValidationError>) {
    let InlineContent::Runs(runs) = content else {
        return;
    };
    let normalized = normalize_runs(runs);
    if normalized.is_empty() {
        errors.push(error(path, "Inline runs must not be empty"));
    } else if normalized.iter().all(|run| run.role == RunRole::Text) {
        errors.push(error(
            path,
            "Run arrays must include at least one note (use a plain string otherwise)",
        ));
    }
}

/// `jsonschema` errors rendered the way Ajv reports them.
mod ajv {
    use jsonschema::error::{TypeKind, ValidationErrorKind as Kind};

    use super::{Map, ValidationError, Value, error};

    /// Sort key: one `(rank, position)` pair per step of the depth-first walk
    /// Ajv does, compared lexicographically.
    type Key = Vec<(u8, usize)>;

    /// A schema or data position Ajv visits, ranked by when it runs inside
    /// one schema object: `type` first, then keywords without a type
    /// (`enum`, `anyOf`, `oneOf`), then number, string, array and object
    /// keywords in vocabulary order. Children come after the keywords.
    mod rank {
        pub const TYPE: u8 = 0;
        pub const ENUM: u8 = 3;
        pub const ANY_OF: u8 = 5;
        pub const ONE_OF: u8 = 6;
        pub const MAXIMUM: u8 = 10;
        pub const MINIMUM: u8 = 11;
        pub const MIN_LENGTH: u8 = 21;
        pub const PATTERN: u8 = 22;
        pub const MIN_ITEMS: u8 = 31;
        pub const ITEMS: u8 = 33;
        pub const REQUIRED: u8 = 42;
        pub const PROPERTY_NAMES: u8 = 44;
        pub const ADDITIONAL_PROPERTIES: u8 = 45;
        pub const PROPERTIES: u8 = 46;
        pub const OTHER: u8 = 99;

        pub fn of_keyword(keyword: &str) -> u8 {
            match keyword {
                "type" => TYPE,
                "enum" => ENUM,
                "anyOf" => ANY_OF,
                "oneOf" => ONE_OF,
                "maximum" => MAXIMUM,
                "minimum" => MINIMUM,
                "minLength" => MIN_LENGTH,
                "pattern" => PATTERN,
                "minItems" => MIN_ITEMS,
                "items" => ITEMS,
                "required" => REQUIRED,
                "propertyNames" => PROPERTY_NAMES,
                "additionalProperties" => ADDITIONAL_PROPERTIES,
                "properties" => PROPERTIES,
                _ => OTHER,
            }
        }
    }

    /// One reported violation (or several, in Ajv's order) with its sort key.
    struct Entry {
        key: Key,
        flat: Vec<ValidationError>,
    }

    /// All violations as Ajv lists them for `instance`.
    pub fn errors<'a>(
        schema: &Value,
        instance: &Value,
        raw: impl IntoIterator<Item = jsonschema::ValidationError<'a>>,
    ) -> Vec<ValidationError> {
        let raw: Vec<_> = raw.into_iter().collect();
        ordered(schema, instance, raw.iter())
    }

    fn ordered<'a, 'e: 'a>(
        schema: &Value,
        instance: &Value,
        raw: impl IntoIterator<Item = &'a jsonschema::ValidationError<'e>>,
    ) -> Vec<ValidationError> {
        let mut entries: Vec<Entry> = raw
            .into_iter()
            .flat_map(|e| entries(schema, instance, e))
            .collect();
        entries.sort_by(|a, b| a.key.cmp(&b.key));
        entries.into_iter().flat_map(|e| e.flat).collect()
    }

    fn entries(
        schema: &Value,
        instance: &Value,
        err: &jsonschema::ValidationError<'_>,
    ) -> Vec<Entry> {
        let path = location_path(err.instance_path().as_str());
        let base = key_of(schema, instance, err);
        let single = |message: String| {
            vec![Entry {
                key: base.clone(),
                flat: vec![error(path.as_str(), message)],
            }]
        };

        match err.kind() {
            Kind::AdditionalProperties { unexpected } => {
                // Ajv reports each extra property on its own, in data order.
                let object = object_at(instance, err.instance_path().as_str());
                unexpected
                    .iter()
                    .map(|name| {
                        let mut key = base.clone();
                        if let Some(last) = key.last_mut() {
                            last.1 = object.map_or(0, |o| data_position(o, name));
                        }
                        Entry {
                            key,
                            flat: vec![error(
                                path.as_str(),
                                format!("Unexpected property \"{name}\""),
                            )],
                        }
                    })
                    .collect()
            }
            Kind::Required { property } => {
                let name = property.as_str().unwrap_or_default();
                single(format!("Missing required property \"{name}\""))
            }
            Kind::AnyOf { context }
            | Kind::OneOfNotValid { context }
            | Kind::OneOfMultipleValid { context } => {
                // Ajv keeps the errors of every branch, then reports the union.
                let mut flat: Vec<ValidationError> = context
                    .iter()
                    .flat_map(|branch| ordered(schema, instance, branch))
                    .collect();
                flat.push(error(path.as_str(), message(schema, err)));
                vec![Entry { key: base, flat }]
            }
            Kind::PropertyNames { error: inner } => {
                let mut flat = ordered(schema, instance, [&**inner]);
                flat.push(error(path.as_str(), "property name must be valid"));
                vec![Entry { key: base, flat }]
            }
            _ => single(message(schema, err)),
        }
    }

    /// Ajv's message template for the keywords `prayer.schema.json` uses.
    fn message(schema: &Value, err: &jsonschema::ValidationError<'_>) -> String {
        match err.kind() {
            Kind::Type { kind } => {
                let declared = schema.pointer(err.schema_path().as_str());
                let names = match declared {
                    Some(Value::String(name)) => name.clone(),
                    Some(Value::Array(names)) => names
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(","),
                    // Unreachable for this schema: fall back to the type set.
                    _ => match kind {
                        TypeKind::Single(t) => t.to_string(),
                        TypeKind::Multiple(set) => set
                            .iter()
                            .map(|t| t.to_string())
                            .collect::<Vec<_>>()
                            .join(","),
                    },
                };
                format!("must be {names}")
            }
            Kind::Pattern { pattern } => format!("must match pattern \"{pattern}\""),
            Kind::MinLength { limit } => format!("must NOT have fewer than {limit} characters"),
            Kind::MinItems { limit } => format!("must NOT have fewer than {limit} items"),
            Kind::Minimum { limit } => format!("must be >= {limit}"),
            Kind::Maximum { limit } => format!("must be <= {limit}"),
            Kind::Enum { .. } => "must be equal to one of the allowed values".into(),
            Kind::AnyOf { .. } => "must match a schema in anyOf".into(),
            Kind::OneOfNotValid { .. } | Kind::OneOfMultipleValid { .. } => {
                "must match exactly one schema in oneOf".into()
            }
            // Keywords the schema does not use; Ajv would have its own text.
            _ => "Invalid value".into(),
        }
    }

    /// `instancePath || "/"` as in the TypeScript core.
    fn location_path(pointer: &str) -> String {
        if pointer.is_empty() {
            "/".into()
        } else {
            pointer.into()
        }
    }

    /// Where Ajv would run this error, as a sort key. Walks the evaluation
    /// path (which includes `$ref` hops) beside the instance path.
    fn key_of(schema: &Value, instance: &Value, err: &jsonschema::ValidationError<'_>) -> Key {
        let eval = pointer_segments(err.evaluation_path().as_str());
        let inst = pointer_segments(err.instance_path().as_str());

        let mut key = Key::new();
        let mut node = schema;
        let mut depth = 0; // instance segments consumed
        let mut i = 0;
        while i < eval.len() {
            let keyword = eval[i].as_str();
            let terminal = i + 1 == eval.len();
            match keyword {
                "$ref" => node = resolve_ref(schema, node),
                "properties" if !terminal => {
                    let name = &eval[i + 1];
                    let position = node["properties"]
                        .as_object()
                        .and_then(|p| p.keys().position(|k| k == name))
                        .unwrap_or(0);
                    key.push((rank::PROPERTIES, position));
                    node = &node["properties"][name.as_str()];
                    i += 1;
                    depth += 1;
                }
                "items" if !terminal => {
                    let index = inst.get(depth).and_then(|s| s.parse().ok()).unwrap_or(0);
                    key.push((rank::ITEMS, index));
                    node = &node["items"];
                    depth += 1;
                }
                "additionalProperties" if !terminal => {
                    let object = object_at(instance, &pointer_of(&inst[..depth]));
                    let position = match (object, inst.get(depth)) {
                        (Some(o), Some(name)) => data_position(o, name),
                        _ => 0,
                    };
                    key.push((rank::ADDITIONAL_PROPERTIES, position));
                    node = &node["additionalProperties"];
                    depth += 1;
                }
                "propertyNames" if !terminal => {
                    let object = object_at(instance, &pointer_of(&inst[..depth]));
                    let position = match (object, err.kind()) {
                        (Some(o), Kind::PropertyNames { error }) => error
                            .instance()
                            .as_str()
                            .map_or(0, |name| data_position(o, name)),
                        _ => 0,
                    };
                    key.push((rank::PROPERTY_NAMES, position));
                    node = &node["propertyNames"];
                }
                "anyOf" | "oneOf" if !terminal => {
                    let branch: usize = eval[i + 1].parse().unwrap_or(0);
                    key.push((rank::of_keyword(keyword), branch));
                    node = &node[keyword][branch];
                    i += 1;
                }
                _ if terminal => {
                    let position = match (keyword, err.kind()) {
                        ("required", Kind::Required { property }) => node["required"]
                            .as_array()
                            .and_then(|r| r.iter().position(|n| n == property))
                            .unwrap_or(0),
                        _ => 0,
                    };
                    key.push((rank::of_keyword(keyword), position));
                }
                _ => {}
            }
            i += 1;
        }
        key
    }

    fn resolve_ref<'s>(schema: &'s Value, node: &'s Value) -> &'s Value {
        node.get("$ref")
            .and_then(Value::as_str)
            .and_then(|r| r.strip_prefix('#'))
            .and_then(|pointer| schema.pointer(pointer))
            .unwrap_or(node)
    }

    fn pointer_segments(pointer: &str) -> Vec<String> {
        pointer
            .split('/')
            .skip(1)
            .map(|s| s.replace("~1", "/").replace("~0", "~"))
            .collect()
    }

    fn escape(segment: &str) -> String {
        segment.replace('~', "~0").replace('/', "~1")
    }

    fn object_at<'v>(instance: &'v Value, pointer: &str) -> Option<&'v Map<String, Value>> {
        instance.pointer(pointer)?.as_object()
    }

    /// Index of `name` in the order JavaScript enumerates the keys.
    fn data_position(object: &Map<String, Value>, name: &str) -> usize {
        super::js_key_order(object)
            .iter()
            .position(|key| *key == name)
            .unwrap_or(0)
    }

    fn pointer_of(segments: &[String]) -> String {
        segments.iter().map(|s| format!("/{}", escape(s))).collect()
    }
}

/// Keys in the order JavaScript enumerates them: integer-like keys ascending
/// first, then the rest in insertion order. Ajv and the TypeScript style
/// checks iterate objects that way.
pub(crate) fn js_key_order(object: &Map<String, Value>) -> Vec<&str> {
    let mut indexed: Vec<(u32, &str)> = object
        .keys()
        .filter_map(|k| array_index(k).map(|n| (n, k.as_str())))
        .collect();
    indexed.sort_unstable();
    let named = object.keys().filter(|k| array_index(k).is_none());
    indexed
        .into_iter()
        .map(|(_, k)| k)
        .chain(named.map(String::as_str))
        .collect()
}

/// Canonical array index (`"0"`, `"17"`, no leading zeros, below 2^32 - 1).
fn array_index(key: &str) -> Option<u32> {
    let canonical = key == "0" || !key.starts_with('0');
    if canonical && !key.is_empty() && key.bytes().all(|b| b.is_ascii_digit()) {
        key.parse::<u32>().ok().filter(|&n| n != u32::MAX)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn variant(lang: &str, variant: &str) -> Value {
        json!({"lang": lang, "variant": variant, "title": "T", "license": "unknown", "source": "draft"})
    }

    fn minimal() -> Value {
        json!({
            "id": "x",
            "type": "prayer",
            "variants": [variant("de", "standard")],
            "structure": [{"id": "b1", "kind": "verse", "translations": []}],
        })
    }

    fn with_translation(translation: Value) -> Value {
        let mut doc = minimal();
        doc["structure"][0]["translations"] = json!([translation]);
        doc
    }

    fn errors_of(doc: &Value) -> Vec<(String, String)> {
        validate(doc)
            .expect_err("expected validation errors")
            .into_iter()
            .map(|e| (e.path, e.message))
            .collect()
    }

    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../packages/core/tests/fixtures/valid-tropar-prokopios.json"
        ))
        .unwrap()
    }

    #[test]
    fn accepts_a_valid_multilingual_prayer() {
        let prayer = validate(&fixture()).unwrap();
        assert_eq!(prayer.id, "tropar-prokopios");
        assert_eq!(prayer.variants.len(), 2);
    }

    #[test]
    fn rejects_missing_required_identity_fields() {
        let mut doc = minimal();
        doc.as_object_mut().unwrap().remove("id");
        let errors = errors_of(&doc);
        assert_eq!(
            errors,
            [(
                "/".to_owned(),
                "Missing required property \"id\"".to_owned()
            )]
        );
    }

    #[test]
    fn rejects_empty_translation_text() {
        let doc = with_translation(json!({"lang": "de", "variant": "standard", "text": ""}));
        let errors = errors_of(&doc);
        assert!(errors.iter().any(|(path, message)| {
            path == "/structure/0/translations/0/text"
                && message == "must NOT have fewer than 1 characters"
        }));
    }

    #[test]
    fn allows_blocks_with_no_translations() {
        let mut doc = minimal();
        doc["variants"] = json!([variant("de", "standard"), variant("en", "standard")]);
        doc["structure"][0]["translations"] =
            json!([{"lang": "de", "variant": "standard", "text": "Nur Deutsch"}]);
        assert!(validate(&doc).is_ok());
    }

    #[test]
    fn rejects_duplicate_block_ids() {
        let mut doc = minimal();
        doc["structure"] = json!([
            {"id": "same", "kind": "verse", "translations": []},
            {"id": "same", "kind": "heading", "translations": []},
        ]);
        assert_eq!(
            errors_of(&doc),
            [(
                "/structure/1/id".to_owned(),
                "Duplicate block id \"same\"".to_owned()
            )]
        );
    }

    #[test]
    fn rejects_an_empty_kind() {
        let mut doc = minimal();
        doc["structure"][0]["kind"] = json!("");
        assert!(validate(&doc).is_err());
    }

    #[test]
    fn accepts_description_and_meta_custom() {
        let mut doc = minimal();
        doc["description"] = json!("Morning prayers before the hours");
        doc["meta"] =
            json!({"custom": {"saint_id": "p", "rank": 3, "published": true, "note": null}});
        let prayer = validate(&doc).unwrap();
        assert_eq!(
            prayer.description.as_deref(),
            Some("Morning prayers before the hours")
        );
        let custom = prayer.meta.unwrap().custom.unwrap();
        assert_eq!(custom["saint_id"], json!("p"));
    }

    #[test]
    fn strips_legacy_meta_revised_at() {
        let mut doc = minimal();
        doc["meta"] = json!({"revised_at": "2026-08-09"});
        assert_eq!(validate(&doc).unwrap().meta, None);

        doc["meta"] = json!({"revised_at": "2026-08-09", "custom": {"a": "b"}});
        assert!(validate(&doc).unwrap().meta.unwrap().custom.is_some());
    }

    #[test]
    fn rejects_unexpected_top_level_properties() {
        let mut doc = minimal();
        doc["links"] = json!({"saint_id": "x"});
        assert_eq!(
            errors_of(&doc),
            [("/".to_owned(), "Unexpected property \"links\"".to_owned())]
        );
        let mut doc = minimal();
        doc["title"] = json!("Should not be here");
        assert!(validate(&doc).is_err());
    }

    #[test]
    fn semantic_rules_run_only_after_the_schema_passes() {
        let mut doc = minimal();
        doc["variants"] = json!([variant("de", "s"), variant("de", "s")]);
        doc["structure"][0]["translations"] =
            json!([{"lang": "de", "variant": "s", "text": "a", "lines": ["b"]}]);
        let semantic = errors_of(&doc);
        assert_eq!(semantic.len(), 2);
        doc["id"] = json!("Bad_Id");
        assert_eq!(errors_of(&doc).len(), 1);
    }

    #[test]
    fn reports_duplicate_translations_and_variants() {
        let mut doc = minimal();
        doc["variants"] = json!([variant("de", "standard"), variant("de", "standard")]);
        doc["structure"][0]["translations"] = json!([
            {"lang": "de", "variant": "standard", "text": "a"},
            {"lang": "de", "variant": "standard", "text": "b"},
        ]);
        assert_eq!(
            errors_of(&doc),
            [
                (
                    "/structure/0/translations/1".to_owned(),
                    "Duplicate translation for lang=\"de\" variant=\"standard\"".to_owned()
                ),
                (
                    "/variants/1".to_owned(),
                    "Duplicate variant lang=\"de\" variant=\"standard\"".to_owned()
                ),
            ]
        );
    }

    #[test]
    fn rejects_text_and_lines_together() {
        let doc = with_translation(
            json!({"lang": "de", "variant": "standard", "text": "a", "lines": ["b"]}),
        );
        assert_eq!(
            errors_of(&doc),
            [(
                "/structure/0/translations/0".to_owned(),
                "Translation must have either text or lines, not both".to_owned()
            )]
        );
    }

    #[test]
    fn run_arrays_need_a_note_after_normalization() {
        let all_text = with_translation(json!({
            "lang": "de", "variant": "standard",
            "text": [{"t": "text", "v": "a"}, {"t": "text", "v": "b"}],
        }));
        assert_eq!(
            errors_of(&all_text),
            [(
                "/structure/0/translations/0/text".to_owned(),
                "Run arrays must include at least one note (use a plain string otherwise)"
                    .to_owned()
            )]
        );

        let zero_width = with_translation(json!({
            "lang": "de", "variant": "standard",
            "text": [{"t": "note", "v": "\u{200b}"}, {"t": "text", "v": "\u{200d}"}],
        }));
        assert_eq!(errors_of(&zero_width)[0].1, "Inline runs must not be empty");

        let with_note = with_translation(json!({
            "lang": "de", "variant": "standard",
            "lines": ["a", [{"t": "text", "v": "x "}, {"t": "note", "v": "(n)"}]],
        }));
        assert!(validate(&with_note).is_ok());
    }

    #[test]
    fn schema_messages_follow_ajv_wording() {
        let mut doc = minimal();
        doc["id"] = json!("Bad_Id");
        doc["tone"] = json!(9);
        doc["variants"] = json!([]);
        doc["extra"] = json!(true);
        assert_eq!(
            errors_of(&doc),
            [
                ("/", "Unexpected property \"extra\""),
                ("/id", "must match pattern \"^[a-z0-9]+(?:-[a-z0-9]+)*$\""),
                ("/tone", "must be <= 8"),
                ("/variants", "must NOT have fewer than 1 items"),
            ]
            .map(|(p, m)| (p.to_owned(), m.to_owned()))
        );
    }

    #[test]
    fn one_of_branch_errors_come_before_the_one_of_error() {
        let doc = with_translation(json!({
            "lang": "de", "variant": "standard", "text": [{"t": "bold", "v": ""}],
        }));
        let base = "/structure/0/translations/0/text";
        assert_eq!(
            errors_of(&doc),
            [
                (base.to_owned(), "must be string".to_owned()),
                (
                    format!("{base}/0/t"),
                    "must be equal to one of the allowed values".to_owned()
                ),
                (
                    format!("{base}/0/v"),
                    "must NOT have fewer than 1 characters".to_owned()
                ),
                (
                    base.to_owned(),
                    "must match exactly one schema in oneOf".to_owned()
                ),
            ]
        );
    }

    #[test]
    fn integral_float_tone_is_accepted() {
        let mut doc = minimal();
        doc["tone"] = serde_json::from_str("4.0").unwrap();
        assert_eq!(validate(&doc).unwrap().tone, Some(Some(4)));
    }

    #[test]
    fn array_index_keys_follow_javascript() {
        assert_eq!(array_index("0"), Some(0));
        assert_eq!(array_index("17"), Some(17));
        assert_eq!(array_index("01"), None);
        assert_eq!(array_index(""), None);
        assert_eq!(array_index("-1"), None);
        assert_eq!(array_index("4294967295"), None);
    }
}
