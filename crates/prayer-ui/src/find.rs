//! The Find and replace bar under the workspace header.

use gpui_kit::*;

use crate::state::AppState;

pub struct FindBar {
    state: Entity<AppState>,
    open: bool,
}

impl FindBar {
    pub fn new(state: Entity<AppState>, _window: &mut Window, _cx: &mut Context<Self>) -> Self {
        Self { state, open: false }
    }

    pub fn is_open(&self) -> bool {
        self.open
    }

    /// Opens (or focuses) the bar; `replace` expands the Replace row;
    /// `prefill` is the editor's selected text.
    pub fn open(
        &mut self,
        replace: bool,
        prefill: Option<String>,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let _ = (replace, prefill, &self.state);
        self.open = true;
        cx.notify();
    }

    /// Cmd+F while open closes it.
    pub fn toggle(&mut self, prefill: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        if self.open {
            self.close(window, cx);
        } else {
            self.open(false, prefill, window, cx);
        }
    }

    pub fn close(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        self.open = false;
        cx.notify();
    }

    pub fn next(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}

    pub fn previous(&mut self, _window: &mut Window, _cx: &mut Context<Self>) {}
}

impl Render for FindBar {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}
