//! Kind text colours are semantic tokens; hex values only survive as legacy
//! input that gets migrated.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StyleColor {
    Base,
    Accent,
}

impl StyleColor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Base => "base",
            Self::Accent => "accent",
        }
    }
}

/// Accent as a hex value in old style configs.
pub const LEGACY_ACCENT_HEX: &str = "#8b2942";

/// `#rgb`, `#rrggbb`, `rgb`, `rrggbb` (any case) to lowercase `#rrggbb`.
fn canonical_hex(value: &str) -> Option<String> {
    let digits = value.strip_prefix('#').unwrap_or(value);
    if !digits.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let digits = digits.to_ascii_lowercase();
    match digits.len() {
        6 => Some(format!("#{digits}")),
        3 => Some(
            digits
                .chars()
                .flat_map(|c| [c, c])
                .fold(String::from("#"), |mut s, c| {
                    s.push(c);
                    s
                }),
        ),
        _ => None,
    }
}

/// Map a style colour value to a token: `base`/`accent` pass through, the
/// legacy Accent hex becomes `accent`, any other hex becomes `base`,
/// anything else is invalid.
pub fn normalize_style_color(value: &str) -> Option<StyleColor> {
    let value = value.trim().to_lowercase();
    match value.as_str() {
        "base" => return Some(StyleColor::Base),
        "accent" => return Some(StyleColor::Accent),
        _ => {}
    }
    let hex = canonical_hex(&value)?;
    Some(if hex == LEGACY_ACCENT_HEX {
        StyleColor::Accent
    } else {
        StyleColor::Base
    })
}

pub fn is_style_color_token(value: &str) -> bool {
    value == "base" || value == "accent"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_tokens_and_hex() {
        assert_eq!(normalize_style_color(" Accent "), Some(StyleColor::Accent));
        assert_eq!(normalize_style_color("base"), Some(StyleColor::Base));
        assert_eq!(normalize_style_color("#8B2942"), Some(StyleColor::Accent));
        assert_eq!(normalize_style_color("8b2942"), Some(StyleColor::Accent));
        assert_eq!(normalize_style_color("#fff"), Some(StyleColor::Base));
        assert_eq!(normalize_style_color("abc"), Some(StyleColor::Base));
        assert_eq!(normalize_style_color("#12345"), None);
        assert_eq!(normalize_style_color("red"), None);
        assert_eq!(normalize_style_color("#ggg"), None);
    }
}
