//! The Content outline (right sidebar): headings and subheadings of the
//! primary Variant, with scrollspy.

use gpui_kit::*;

use crate::state::AppState;

pub struct Outline {
    state: Entity<AppState>,
}

impl Outline {
    pub fn new(state: Entity<AppState>, _cx: &mut Context<Self>) -> Self {
        Self { state }
    }
}

impl Render for Outline {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let _ = &self.state;
        div()
    }
}
