//! Validation details: every error with its JSON path.

use gpui_kit::component::WindowExt;
use gpui_kit::*;
use prayer_core::ValidationError;

use crate::theme::palette;

pub fn open(errors: Vec<ValidationError>, window: &mut Window, cx: &mut App) {
    window.open_dialog(cx, move |dialog, _, cx| {
        let p = palette(cx).clone();
        let body = if errors.is_empty() {
            div()
                .text_sm()
                .child("No details available.")
                .into_any_element()
        } else {
            div()
                .id("validation-errors")
                .max_h(px(420.))
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap_2()
                .children(errors.iter().map(|e| {
                    div()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .text_xs()
                                .font_family("monospace")
                                .text_color(p.text_secondary)
                                .child(if e.path.is_empty() {
                                    "/".to_string()
                                } else {
                                    e.path.clone()
                                }),
                        )
                        .child(div().text_sm().child(e.message.clone()))
                }))
                .into_any_element()
        };
        dialog.title("Validation details").w(px(560.)).child(body)
    });
}
