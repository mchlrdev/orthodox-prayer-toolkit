//! "Unsaved changes": Save all / Discard all / Cancel before an action that
//! would lose them (switching Library, refresh, closing, installing an
//! update).

use gpui_kit::component::WindowExt;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::*;
use prayer_app::session::UnsavedChoice;

use crate::state::AppState;

pub fn open(state: Entity<AppState>, window: &mut Window, cx: &mut App) {
    let count = state.read(cx).session.dirty_drafts().len();
    let message = format!(
        "{count} {} unsaved changes. Save all, discard all, or cancel.",
        if count == 1 {
            "prayer has"
        } else {
            "prayers have"
        }
    );
    window.open_dialog(cx, move |dialog, _, _| {
        let choose = |choice: UnsavedChoice| {
            let state = state.clone();
            move |_: &ClickEvent, window: &mut Window, cx: &mut App| {
                window.close_dialog(cx);
                state.update(cx, |s, cx| s.resolve_unsaved(choice, cx));
            }
        };
        dialog
            .title("Unsaved changes")
            .w(px(440.))
            .overlay_closable(false)
            .close_button(false)
            .child(div().text_sm().child(message.clone()))
            .footer(
                div()
                    .flex()
                    .justify_end()
                    .gap_2()
                    .child(
                        Button::new("cancel")
                            .label("Cancel")
                            .on_click(choose(UnsavedChoice::Cancel)),
                    )
                    .child(
                        Button::new("discard")
                            .label("Discard all")
                            .danger()
                            .on_click(choose(UnsavedChoice::DiscardAll)),
                    )
                    .child(
                        Button::new("save")
                            .label("Save all")
                            .primary()
                            .on_click(choose(UnsavedChoice::SaveAll)),
                    ),
            )
    });
}
