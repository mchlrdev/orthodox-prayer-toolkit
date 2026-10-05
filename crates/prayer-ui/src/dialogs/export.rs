//! The Export dialog (flat JSON, HTML, Layout RTF/DOCX).

use gpui_kit::*;

#[allow(unused_imports)]
use crate::state::AppState;

pub fn open(state: Entity<AppState>, path: String, window: &mut Window, cx: &mut App) {
    // Filled in by the dialog's owner.
    let _ = (&state, &path, window, cx);
}
