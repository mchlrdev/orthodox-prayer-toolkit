//! "Edit kind" (rename across the Library, Kind style) and "New kind".

use gpui_kit::*;

#[allow(unused_imports)]
use crate::state::AppState;

/// Edit an existing Kind: name (renames it in every prayer of the Library)
/// and its style.
pub fn open_edit(state: Entity<AppState>, kind: String, window: &mut Window, cx: &mut App) {
    let _ = (state, kind, window, cx);
}

/// Create a Kind and give it to Block `block_id` of the selected prayer.
pub fn open_new(state: Entity<AppState>, block_id: String, window: &mut Window, cx: &mut App) {
    let _ = (state, block_id, window, cx);
}
