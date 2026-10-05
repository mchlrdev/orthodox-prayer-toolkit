//! Validation of Kind style maps (`styles.json`) and Kind ids.
//!
//! Style values are CSS-like strings that end up in exports, so only a small
//! allowlist per field passes. [`sanitize_styles`] keeps whatever is valid,
//! [`validate_styles`] is the strict form to use before persisting.

use serde_json::{Map, Value};

use crate::html_tags::is_allowed_html_tag;
use crate::model::{KindStyleOverride, StyleOverrides, ValidationError};
use crate::style_color::normalize_style_color;
use crate::text_runs::is_js_whitespace;
use crate::validate::js_key_order;

/// A Kind id has at most this many characters.
pub const KIND_ID_MAX_LENGTH: usize = 64;

/// Longest accepted style value, in UTF-16 code units like the TypeScript
/// core counts them.
const MAX_VALUE_UNITS: usize = 64;

/// Whether `kind` is a letter followed by letters, digits, `_` or `-`, at most
/// [`KIND_ID_MAX_LENGTH`] characters.
pub fn is_valid_kind_id(kind: &str) -> bool {
    let mut chars = kind.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic())
        && kind.chars().count() <= KIND_ID_MAX_LENGTH
        && chars.all(is_kind_id_char)
}

fn is_kind_id_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

/// Strip characters that cannot appear in a Kind id; used while typing.
pub fn sanitize_kind_id_input(raw: &str) -> String {
    raw.chars()
        .filter(|&c| is_kind_id_char(c))
        .skip_while(|c| !c.is_ascii_alphabetic())
        .take(KIND_ID_MAX_LENGTH)
        .collect()
}

/// The style fields a Kind may set.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Field {
    FontSize,
    Color,
    FontWeight,
    FontStyle,
    InitialCap,
    Indicate,
    HtmlTag,
    TextAlign,
}

impl Field {
    fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "fontSize" => Self::FontSize,
            "color" => Self::Color,
            "fontWeight" => Self::FontWeight,
            "fontStyle" => Self::FontStyle,
            "initialCap" => Self::InitialCap,
            "indicate" => Self::Indicate,
            "htmlTag" => Self::HtmlTag,
            "textAlign" => Self::TextAlign,
            _ => return None,
        })
    }

    /// The sanitized value, or why `value` is not acceptable.
    fn check(self, value: &str) -> Result<String, &'static str> {
        let trimmed = value.trim_matches(is_js_whitespace);
        match self {
            Self::FontSize if is_safe_css_length(trimmed) => Ok(trimmed.to_owned()),
            Self::FontSize => Err("expected a length like 1rem or 16px"),
            // Trimmed here with JS whitespace (U+FEFF included) so legacy
            // values behave as they did in the TypeScript core.
            Self::Color => normalize_style_color(trimmed)
                .map(|token| token.as_str().to_owned())
                .ok_or("expected \"base\", \"accent\", or a legacy hex"),
            Self::FontWeight if is_safe_font_weight(trimmed) => Ok(trimmed.to_owned()),
            Self::FontWeight => Err("expected normal, bold, or 100\u{2013}900"),
            Self::FontStyle if is_one_of(trimmed, &["normal", "italic", "oblique"]) => {
                Ok(trimmed.to_owned())
            }
            Self::FontStyle => Err("expected normal, italic, or oblique"),
            Self::InitialCap | Self::Indicate if value == "true" || value == "false" => {
                Ok(value.to_owned())
            }
            Self::InitialCap | Self::Indicate => Err("expected \"true\" or \"false\""),
            Self::HtmlTag if is_allowed_html_tag(trimmed) => Ok(trimmed.to_owned()),
            Self::HtmlTag => Err(
                "expected an allowlisted HTML tag (h1\u{2013}h6, p, div, aside, section, blockquote, span)",
            ),
            Self::TextAlign if is_one_of(trimmed, &["left", "center", "justify"]) => {
                Ok(trimmed.to_ascii_lowercase())
            }
            Self::TextAlign => Err("expected left, center, or justify"),
        }
    }
}

/// Case-insensitive (ASCII) membership.
fn is_one_of(value: &str, options: &[&str]) -> bool {
    options.iter().any(|o| value.eq_ignore_ascii_case(o))
}

/// `0`, or an optionally negative number followed by `px`, `rem`, `em` or `%`.
fn is_safe_css_length(value: &str) -> bool {
    if value == "0" {
        return true;
    }
    let Some(number) = ["px", "rem", "em", "%"].iter().find_map(|unit| {
        let split = value.len().checked_sub(unit.len())?;
        (value.is_char_boundary(split) && value[split..].eq_ignore_ascii_case(unit))
            .then(|| &value[..split])
    }) else {
        return false;
    };
    let number = number.strip_prefix('-').unwrap_or(number);
    let (whole, fraction) = match number.split_once('.') {
        Some((whole, fraction)) => (whole, Some(fraction)),
        None => (number, None),
    };
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    digits(whole) && fraction.is_none_or(digits)
}

/// A CSS keyword or `100` to `900` in steps of 100.
fn is_safe_font_weight(value: &str) -> bool {
    if is_one_of(value, &["normal", "bold", "bolder", "lighter"]) {
        return true;
    }
    matches!(value.as_bytes(), [b'1'..=b'9', b'0', b'0'])
}

/// Values that could smuggle in a URL, script or markup.
fn is_dangerous(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("javascript:")
        || lower.contains("@import")
        || lower.contains('<')
        || has_call(&lower, "url")
        || has_call(&lower, "expression")
}

/// `name`, optional whitespace, then `(` somewhere in `text`.
fn has_call(text: &str, name: &str) -> bool {
    text.match_indices(name).any(|(at, _)| {
        text[at + name.len()..]
            .trim_start_matches(is_js_whitespace)
            .starts_with('(')
    })
}

impl KindStyleOverride {
    fn slot(&mut self, field: Field) -> &mut Option<String> {
        match field {
            Field::FontSize => &mut self.font_size,
            Field::Color => &mut self.color,
            Field::FontWeight => &mut self.font_weight,
            Field::FontStyle => &mut self.font_style,
            Field::InitialCap => &mut self.initial_cap,
            Field::Indicate => &mut self.indicate,
            Field::HtmlTag => &mut self.html_tag,
            Field::TextAlign => &mut self.text_align,
        }
    }

    fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

fn error(path: String, message: &str) -> ValidationError {
    ValidationError {
        path,
        message: message.to_owned(),
    }
}

/// Check one field value, collecting an error for `/kind/field` on failure.
fn check_field(
    kind: &str,
    name: &str,
    field: Field,
    value: &Value,
    errors: &mut Vec<ValidationError>,
) -> Option<String> {
    let path = || format!("/{kind}/{name}");
    let Some(text) = value.as_str() else {
        errors.push(error(path(), "must be a string"));
        return None;
    };
    if text.encode_utf16().count() > MAX_VALUE_UNITS {
        errors.push(error(path(), "value too long"));
        return None;
    }
    if is_dangerous(text) {
        errors.push(error(path(), "disallowed CSS value"));
        return None;
    }
    match field.check(text) {
        Ok(safe) => Some(safe),
        Err(message) => {
            errors.push(error(path(), message));
            None
        }
    }
}

fn sanitize_kind(
    kind: &str,
    raw: &Map<String, Value>,
    errors: &mut Vec<ValidationError>,
) -> Option<KindStyleOverride> {
    let mut entry = KindStyleOverride::default();
    for name in js_key_order(raw) {
        let Some(field) = Field::from_name(name) else {
            errors.push(error(format!("/{kind}/{name}"), "unknown style field"));
            continue;
        };
        if let Some(safe) = check_field(kind, name, field, &raw[name], errors) {
            *entry.slot(field) = Some(safe);
        }
    }
    if entry.is_empty() {
        errors.push(error(format!("/{kind}"), "kind style has no valid fields"));
        return None;
    }
    Some(entry)
}

/// Best-effort parse: keep valid Kind entries, collect errors for the rest.
/// Partial entries only include the fields that passed.
pub fn sanitize_styles(data: &Value) -> (StyleOverrides, Vec<ValidationError>) {
    let Some(kinds) = data.as_object() else {
        return (
            StyleOverrides::new(),
            vec![error("/".into(), "styles must be a JSON object")],
        );
    };

    let mut errors = Vec::new();
    let mut styles = StyleOverrides::new();
    for kind in js_key_order(kinds) {
        if !is_valid_kind_id(kind) {
            errors.push(error(format!("/{kind}"), "invalid kind name"));
            continue;
        }
        let Some(raw) = kinds[kind].as_object() else {
            errors.push(error(format!("/{kind}"), "kind style must be an object"));
            continue;
        };
        if let Some(entry) = sanitize_kind(kind, raw, &mut errors) {
            styles.insert(kind.to_owned(), entry);
        }
    }
    (styles, errors)
}

/// Strict style-map validation (same shape as prayer `validate`): fails if any
/// Kind or field is invalid. Use before persisting styles.
pub fn validate_styles(data: &Value) -> Result<StyleOverrides, Vec<ValidationError>> {
    match sanitize_styles(data) {
        (styles, errors) if errors.is_empty() => Ok(styles),
        (_, errors) => Err(errors),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn base() -> Value {
        json!({"fontSize": "1rem", "color": "base", "fontWeight": "400", "fontStyle": "normal"})
    }

    fn with(extra: &[(&str, Value)]) -> Value {
        let mut style = base();
        for (k, v) in extra {
            style[*k] = v.clone();
        }
        json!({ "verse": style })
    }

    fn paths(errors: &[ValidationError]) -> Vec<&str> {
        errors.iter().map(|e| e.path.as_str()).collect()
    }

    #[test]
    fn accepts_text_align_left_center_justify_and_rejects_others() {
        let ok = validate_styles(&json!({
            "verse": {"fontSize": "1rem", "color": "base", "fontWeight": "400",
                      "fontStyle": "normal", "textAlign": "justify"},
            "heading": {"fontSize": "1rem", "color": "accent", "fontWeight": "400",
                        "fontStyle": "normal", "textAlign": "Center"},
        }))
        .unwrap();
        assert_eq!(ok["verse"].text_align.as_deref(), Some("justify"));
        assert_eq!(ok["heading"].text_align.as_deref(), Some("center"));

        let errors = validate_styles(&with(&[("textAlign", json!("right"))])).unwrap_err();
        assert_eq!(paths(&errors), ["/verse/textAlign"]);
    }

    #[test]
    fn accepts_allowlisted_html_tag_and_rejects_others() {
        let ok = validate_styles(&with(&[("htmlTag", json!("blockquote"))])).unwrap();
        assert_eq!(ok["verse"].html_tag.as_deref(), Some("blockquote"));

        let errors = validate_styles(&with(&[("htmlTag", json!("script"))])).unwrap_err();
        assert_eq!(paths(&errors), ["/verse/htmlTag"]);
    }

    #[test]
    fn rejects_url_and_unknown_fields() {
        let errors = validate_styles(&with(&[
            ("color", json!("url(javascript:alert(1))")),
            ("evil", json!("x")),
        ]))
        .unwrap_err();
        assert_eq!(paths(&errors), ["/verse/color", "/verse/evil"]);
        assert_eq!(errors[0].message, "disallowed CSS value");
        assert_eq!(errors[1].message, "unknown style field");
    }

    #[test]
    fn sanitize_normalizes_legacy_hex_colors_to_tokens() {
        let (styles, errors) = sanitize_styles(&json!({
            "verse": {"color": "#1a1a1a"},
            "heading": {"color": "#8b2942"},
            "other": {"color": "#112233"},
            "bad": {"color": "url(http://x)"},
        }));
        assert_eq!(styles["verse"].color.as_deref(), Some("base"));
        assert_eq!(styles["heading"].color.as_deref(), Some("accent"));
        assert_eq!(styles["other"].color.as_deref(), Some("base"));
        assert!(!styles.contains_key("bad"));
        assert_eq!(
            paths(&errors),
            ["/bad/color", "/bad"],
            "a Kind without valid fields is reported after its field errors"
        );
    }

    #[test]
    fn sanitized_entries_only_hold_fields_that_passed() {
        let (styles, _) =
            sanitize_styles(&json!({"verse": {"color": "#8b2942", "fontSize": "big"}}));
        let entry = &styles["verse"];
        assert_eq!(entry.color.as_deref(), Some("accent"));
        assert_eq!(entry.font_size, None);
        assert_eq!(
            serde_json::to_value(entry).unwrap(),
            json!({"color": "accent"})
        );
    }

    #[test]
    fn drops_invalid_kind_keys() {
        let (styles, errors) = sanitize_styles(&json!({
            "Test kind": {"color": "base"},
            "Test": {"color": "accent"},
        }));
        assert!(!styles.contains_key("Test kind"));
        assert_eq!(styles["Test"].color.as_deref(), Some("accent"));
        assert_eq!(errors[0].message, "invalid kind name");
    }

    #[test]
    fn rejects_non_object_input_and_entries() {
        for data in [json!(null), json!([]), json!("s"), json!(1)] {
            let (styles, errors) = sanitize_styles(&data);
            assert!(styles.is_empty());
            assert_eq!(errors, [error("/".into(), "styles must be a JSON object")]);
        }
        let (_, errors) = sanitize_styles(&json!({"a": null, "b": []}));
        assert_eq!(errors[1].message, "kind style must be an object");
    }

    #[test]
    fn length_limit_counts_utf16_units() {
        let at_limit = "\u{1F600}".repeat(32); // 64 units
        let (_, errors) = sanitize_styles(&json!({"k": {"fontSize": at_limit}}));
        assert_eq!(errors[0].message, "expected a length like 1rem or 16px");
        let over = "\u{1F600}".repeat(33);
        let (_, errors) = sanitize_styles(&json!({"k": {"fontSize": over}}));
        assert_eq!(errors[0].message, "value too long");
    }

    #[test]
    fn css_lengths() {
        for ok in ["0", "1rem", "16px", "-2px", "1.5EM", "10%", "0.0px"] {
            assert!(is_safe_css_length(ok), "{ok}");
        }
        for bad in [
            "",
            "1",
            "1.rem",
            ".5rem",
            "1 rem",
            "1pt",
            "px",
            "--1px",
            "calc(1rem)",
        ] {
            assert!(!is_safe_css_length(bad), "{bad}");
        }
    }

    #[test]
    fn dangerous_values() {
        for bad in [
            "url(x)",
            "URL (x)",
            "expression\t(1)",
            "a@import",
            "JavaScript:x",
            "<b",
        ] {
            assert!(is_dangerous(bad), "{bad}");
        }
        for ok in ["url", "expression", "1rem", "curly(x"] {
            assert!(!is_dangerous(ok), "{ok}");
        }
    }

    #[test]
    fn kind_ids() {
        for ok in ["Test", "strophe_2", "foo-bar", "a"] {
            assert!(is_valid_kind_id(ok), "{ok}");
        }
        for bad in ["", "Test kind", "1abc", "_a", "\u{e9}", "a\n"] {
            assert!(!is_valid_kind_id(bad), "{bad:?}");
        }
        assert!(is_valid_kind_id(&"a".repeat(64)));
        assert!(!is_valid_kind_id(&"a".repeat(65)));
    }

    #[test]
    fn sanitizes_kind_id_input() {
        assert_eq!(sanitize_kind_id_input("Test kind"), "Testkind");
        assert_eq!(sanitize_kind_id_input(" Test"), "Test");
        assert_eq!(sanitize_kind_id_input("1abc"), "abc");
        assert_eq!(sanitize_kind_id_input("foo_bar-2"), "foo_bar-2");
        assert_eq!(sanitize_kind_id_input(&"a".repeat(80)).len(), 64);
    }

    #[test]
    fn integer_like_kind_keys_are_visited_first_like_javascript() {
        let (_, errors) = sanitize_styles(&json!({"b": null, "2": null, "a": null, "1": null}));
        assert_eq!(paths(&errors), ["/1", "/2", "/b", "/a"]);
    }
}
