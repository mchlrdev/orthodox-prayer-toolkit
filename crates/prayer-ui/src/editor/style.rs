//! Kind style → how a cell paints its text.

use gpui_kit::*;
use prayer_core::KindStyle;
use prayer_core::style_color::{StyleColor, normalize_style_color};

use crate::theme::Palette;

/// The bundled prayer text font.
pub const PRAYER_FONT: &str = "Noto Serif";

/// CSS base size: `1rem`.
const REM: f32 = 16.;
/// `line-height` of the Electron editor's prayer text.
const LINE_HEIGHT: f32 = 1.55;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
    Left,
    Center,
    Justify,
}

/// Everything a cell needs to shape and paint its text.
#[derive(Clone, Debug)]
pub struct CellStyle {
    pub font: Font,
    pub font_size: Pixels,
    pub line_height: Pixels,
    pub color: Hsla,
    pub note_color: Hsla,
    pub align: Align,
    /// The first letter uses Accent (liturgical initial).
    pub initial_cap: bool,
    /// Blocks of this Kind get a dot in the margin.
    pub indicate: bool,
}

/// `0.875rem`, `14px`, `1.2em` (as rem) or a bare number of pixels.
pub fn parse_font_size(value: &str) -> f32 {
    let value = value.trim();
    let number = |s: &str| s.trim().parse::<f32>().ok().filter(|n| *n > 0.);
    if let Some(n) = value.strip_suffix("rem").and_then(number) {
        return n * REM;
    }
    if let Some(n) = value.strip_suffix("em").and_then(number) {
        return n * REM;
    }
    if let Some(n) = value.strip_suffix("px").and_then(number) {
        return n;
    }
    number(value).unwrap_or(REM)
}

/// `bold`, `normal` or a CSS number weight.
pub fn parse_font_weight(value: &str) -> FontWeight {
    match value.trim() {
        "bold" | "bolder" => FontWeight::BOLD,
        "normal" | "" => FontWeight::NORMAL,
        "lighter" => FontWeight::LIGHT,
        other => other
            .parse::<f32>()
            .map(FontWeight)
            .unwrap_or(FontWeight::NORMAL),
    }
}

fn color_of(value: &str, palette: &Palette) -> Hsla {
    match normalize_style_color(value) {
        Some(StyleColor::Accent) => palette.accent,
        _ => palette.base,
    }
}

impl CellStyle {
    /// `note_color` is the Annotation Kind's colour, as in the Electron
    /// editor (notes are painted like annotations).
    pub fn new(style: &KindStyle, note_color: &str, palette: &Palette) -> Self {
        let font_size = parse_font_size(&style.font_size);
        let weight = parse_font_weight(&style.font_weight);
        // Noto Serif ships Regular and Bold; anything heavier than 550 is bold.
        let weight = if weight.0 >= 550. {
            FontWeight::BOLD
        } else {
            FontWeight::NORMAL
        };
        let font = Font {
            family: PRAYER_FONT.into(),
            features: FontFeatures::default(),
            fallbacks: None,
            weight,
            style: if style.font_style.trim() == "italic" {
                FontStyle::Italic
            } else {
                FontStyle::Normal
            },
        };
        let align = match style.text_align.as_deref() {
            Some("center") => Align::Center,
            Some("justify") => Align::Justify,
            _ => Align::Left,
        };
        Self {
            font,
            font_size: px(font_size),
            line_height: px((font_size * LINE_HEIGHT).round()),
            color: color_of(&style.color, palette),
            note_color: color_of(note_color, palette),
            align,
            initial_cap: style.initial_cap.as_deref() == Some("true"),
            indicate: style.indicate.as_deref() == Some("true"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_font_size, parse_font_weight};
    use gpui_kit::FontWeight;

    #[test]
    fn sizes() {
        assert_eq!(parse_font_size("0.875rem"), 14.);
        assert_eq!(parse_font_size("1.35rem"), 21.6);
        assert_eq!(parse_font_size("18px"), 18.);
        assert_eq!(parse_font_size("1.5em"), 24.);
        assert_eq!(parse_font_size("17"), 17.);
        assert_eq!(parse_font_size("large"), 16.);
        assert_eq!(parse_font_size("-1rem"), 16.);
    }

    #[test]
    fn weights() {
        assert_eq!(parse_font_weight("700"), FontWeight(700.));
        assert_eq!(parse_font_weight("bold"), FontWeight::BOLD);
        assert_eq!(parse_font_weight("400"), FontWeight(400.));
        assert_eq!(parse_font_weight("x"), FontWeight::NORMAL);
    }
}
