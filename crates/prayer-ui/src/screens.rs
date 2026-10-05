//! Full-workspace screens: Library welcome, nothing selected, invalid prayer.

use gpui_kit::*;

use crate::state::AppState;
use crate::theme::palette;

/// No Library open: "Open a library to begin".
pub fn welcome(state: &Entity<AppState>, cx: &mut App) -> AnyElement {
    let _ = state;
    let p = palette(cx).clone();
    centered(p.text_secondary, "Open a library to begin")
}

/// A Library is open but no prayer is selected.
pub fn nothing_selected(cx: &mut App) -> AnyElement {
    let p = palette(cx).clone();
    centered(p.text_secondary, "Select a prayer from the library.")
}

/// The selected file is invalid: "Cannot open prayer".
pub fn invalid(state: &Entity<AppState>, cx: &mut App) -> AnyElement {
    let _ = state;
    let p = palette(cx).clone();
    centered(p.text_secondary, "Cannot open prayer")
}

fn centered(color: Hsla, text: &'static str) -> AnyElement {
    div()
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .text_color(color)
        .child(text)
        .into_any_element()
}
