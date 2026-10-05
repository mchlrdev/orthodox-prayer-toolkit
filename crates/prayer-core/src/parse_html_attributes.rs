//! Parser for the wrapper attribute string in HTML export settings.

use std::fmt;
use std::sync::LazyLock;

use indexmap::IndexMap;
use regex::Regex;

use crate::text_runs::is_js_whitespace;

/// Why part of an attribute string was rejected.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AttributeError {
    /// Text that is not a `name`, `name=value` token.
    UnexpectedToken(String),
    /// `style` is content-vs-design: use Kind styles instead.
    StyleNotAllowed,
    /// `on*` event handler attribute (name as written).
    EventHandler(String),
}

impl fmt::Display for AttributeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedToken(token) => write!(f, "unexpected token \"{token}\""),
            Self::StyleNotAllowed => f.write_str("attribute \"style\" is not allowed"),
            Self::EventHandler(name) => {
                write!(f, "event handler attribute \"{name}\" is not allowed")
            }
        }
    }
}

impl std::error::Error for AttributeError {}

/// `name`, optionally `= "v"`, `= 'v'` or `= bare`. Names are ASCII-only and
/// whitespace is JavaScript's `\s`, to accept exactly what the TypeScript
/// core accepted.
static TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    const WS: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";
    let pattern = format!(
        r#"([A-Za-z_:][A-Za-z0-9_:.\-]*)(?:[{WS}]*=[{WS}]*(?:"([^"]*)"|'([^']*)'|([^{WS}"'=<>`]+)))?"#
    );
    Regex::new(&pattern).expect("attribute token pattern is valid")
});

fn forbidden(name: &str) -> Option<AttributeError> {
    let lower = name.to_ascii_lowercase();
    if lower == "style" {
        Some(AttributeError::StyleNotAllowed)
    } else if lower.starts_with("on") {
        Some(AttributeError::EventHandler(name.to_owned()))
    } else {
        None
    }
}

fn push_unexpected(errors: &mut Vec<AttributeError>, gap: &str) {
    let gap = gap.trim_matches(is_js_whitespace);
    if !gap.is_empty() {
        errors.push(AttributeError::UnexpectedToken(gap.to_owned()));
    }
}

/// Parse a space-separated HTML attribute string into a name to value map
/// (first-seen order; a repeated name keeps its first position and its last
/// value). Event handlers (`on*`) and `style` are rejected, and so is any
/// text that is not an attribute; all problems are reported together.
pub fn parse_html_attributes(input: &str) -> Result<IndexMap<String, String>, Vec<AttributeError>> {
    let trimmed = input.trim_matches(is_js_whitespace);
    let mut errors = Vec::new();
    let mut attributes = IndexMap::new();
    let mut last_end = 0;

    for caps in TOKEN.captures_iter(trimmed) {
        let whole = caps.get(0).expect("group 0 always matches");
        push_unexpected(&mut errors, &trimmed[last_end..whole.start()]);
        last_end = whole.end();

        let name = &caps[1];
        if let Some(error) = forbidden(name) {
            errors.push(error);
            continue;
        }
        let value = (2..=4).find_map(|i| caps.get(i)).map_or("", |m| m.as_str());
        attributes.insert(name.to_owned(), value.to_owned());
    }
    push_unexpected(&mut errors, &trimmed[last_end..]);

    if errors.is_empty() {
        Ok(attributes)
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(map: &IndexMap<String, String>) -> Vec<(&str, &str)> {
        map.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()
    }

    #[test]
    fn parses_quoted_attributes() {
        let attrs = parse_html_attributes(r#"class="prayer" data-x="1""#).unwrap();
        assert_eq!(pairs(&attrs), [("class", "prayer"), ("data-x", "1")]);
    }

    #[test]
    fn parses_single_quoted_bare_and_valueless() {
        let attrs = parse_html_attributes("a='x y' b=z hidden c = \"\"").unwrap();
        assert_eq!(
            pairs(&attrs),
            [("a", "x y"), ("b", "z"), ("hidden", ""), ("c", "")]
        );
    }

    #[test]
    fn rejects_event_handlers_and_style() {
        let errors =
            parse_html_attributes(r#"onclick="x" style="color:red" class="ok""#).unwrap_err();
        assert_eq!(
            errors,
            [
                AttributeError::EventHandler("onclick".into()),
                AttributeError::StyleNotAllowed
            ]
        );
        assert_eq!(
            errors[0].to_string(),
            "event handler attribute \"onclick\" is not allowed"
        );
    }

    #[test]
    fn accepts_empty_input() {
        assert!(parse_html_attributes("  ").unwrap().is_empty());
    }

    #[test]
    fn reports_stray_text() {
        let errors = parse_html_attributes(r#"1x a="b" ="#).unwrap_err();
        assert_eq!(
            errors,
            [
                AttributeError::UnexpectedToken("1".into()),
                AttributeError::UnexpectedToken("=".into())
            ]
        );
    }

    #[test]
    fn repeated_name_keeps_first_position_and_last_value() {
        let attrs = parse_html_attributes("a=1 b=2 a=3").unwrap();
        assert_eq!(pairs(&attrs), [("a", "3"), ("b", "2")]);
    }
}
