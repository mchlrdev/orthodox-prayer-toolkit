//! App settings: appearance (Light / Dark / System) and updates.

use gpui_kit::*;

use crate::state::AppState;
use crate::updates::Updates;

pub fn open(state: Entity<AppState>, updates: Entity<Updates>, window: &mut Window, cx: &mut App) {
    let _ = (&state, &updates, window, cx);
}
