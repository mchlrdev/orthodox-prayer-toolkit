//! The generic confirm dialog (delete prayer, replace all, rename kind…).

use std::rc::Rc;

use gpui_kit::component::WindowExt;
use gpui_kit::component::button::ButtonVariant;
use gpui_kit::*;

/// Asks `title` / `message`; `on_ok` runs when the user confirms.
pub fn open(
    title: impl Into<SharedString>,
    message: impl Into<SharedString>,
    ok_label: impl Into<SharedString>,
    danger: bool,
    on_ok: impl Fn(&mut Window, &mut App) + 'static,
    window: &mut Window,
    cx: &mut App,
) {
    let title = title.into();
    let message = message.into();
    let ok_label = ok_label.into();
    let on_ok = Rc::new(on_ok);
    window.open_alert_dialog(cx, move |alert, _, _| {
        let on_ok = on_ok.clone();
        alert
            .title(title.clone())
            .description(message.clone())
            .show_cancel(true)
            .ok_text(ok_label.clone())
            .ok_variant(if danger {
                ButtonVariant::Danger
            } else {
                ButtonVariant::Primary
            })
            .on_ok(move |_, window, cx| {
                on_ok(window, cx);
                true
            })
    });
}
