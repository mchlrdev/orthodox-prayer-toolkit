//! The app palette (the Electron `--opt-*` colours) for light and dark mode.

use gpui_kit::*;

/// Colours the app paints with. Set as a global; follows the appearance
/// setting (Light / Dark / System).
#[derive(Clone, Debug)]
pub struct Palette {
    pub dark: bool,
    /// Kind colour "Base": the prayer text.
    pub base: Hsla,
    /// Kind colour "Accent": headings, notes, initials, badges.
    pub accent: Hsla,
    pub bg: Hsla,
    pub surface: Hsla,
    pub border: Hsla,
    pub border_strong: Hsla,
    pub text: Hsla,
    pub text_secondary: Hsla,
    pub hover: Hsla,
    pub hover_strong: Hsla,
    pub glass: Hsla,
    pub on_accent: Hsla,
    pub selection: Hsla,
    pub find_match: Hsla,
    pub find_current: Hsla,
}

impl Global for Palette {}

fn hex(value: u32) -> Hsla {
    rgb(value).into()
}

fn rgba_hex(value: u32) -> Hsla {
    rgba(value).into()
}

impl Palette {
    pub fn light() -> Self {
        Self {
            dark: false,
            base: hex(0x1a1a1a),
            accent: hex(0x8b2942),
            bg: hex(0xf5f5f7),
            surface: hex(0xffffff),
            border: rgba_hex(0x00000014),
            border_strong: rgba_hex(0x0000001f),
            text: hex(0x1d1d1f),
            text_secondary: hex(0x6e6e73),
            hover: rgba_hex(0x0000000a),
            hover_strong: rgba_hex(0x00000014),
            glass: rgba_hex(0xffffffeb),
            on_accent: hex(0xffffff),
            selection: rgba_hex(0x3b82f640),
            find_match: rgba_hex(0xf5c54266),
            find_current: rgba_hex(0xf59e0bb3),
        }
    }

    pub fn dark() -> Self {
        Self {
            dark: true,
            base: hex(0xf2f2f2),
            accent: hex(0xd46b82),
            bg: hex(0x121212),
            surface: hex(0x1c1c1e),
            border: rgba_hex(0xffffff1a),
            border_strong: rgba_hex(0xffffff2e),
            text: hex(0xf2f2f2),
            text_secondary: hex(0xa1a1a6),
            hover: rgba_hex(0xffffff0f),
            hover_strong: rgba_hex(0xffffff1a),
            glass: rgba_hex(0x1c1c1ef0),
            on_accent: hex(0x1a1a1a),
            selection: rgba_hex(0x5b9cff55),
            find_match: rgba_hex(0xc9a22755),
            find_current: rgba_hex(0xe0a020aa),
        }
    }

    /// `color` with its alpha multiplied by `opacity`.
    pub fn fade(color: Hsla, opacity: f32) -> Hsla {
        Hsla {
            a: color.a * opacity,
            ..color
        }
    }
}

/// The palette of the current appearance.
pub fn palette(cx: &App) -> &Palette {
    cx.global::<Palette>()
}
