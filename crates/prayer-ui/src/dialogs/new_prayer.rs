//! The "New prayer" modal.

use gpui_kit::*;

#[allow(unused_imports)]
use crate::state::AppState;

pub fn open(state: Entity<AppState>, window: &mut Window, cx: &mut App) {
    // Filled in by the dialog's owner.
    let _ = (&state, window, cx);
}
