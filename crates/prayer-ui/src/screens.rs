//! Full-workspace screens: Library welcome, nothing selected, invalid prayer.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::tooltip::Tooltip;
use gpui_kit::component::{Icon, IconName, Sizable};
use gpui_kit::*;

use crate::dialogs;
use crate::state::AppState;
use crate::theme::palette;

/// No Library open: "Open a library to begin", the buttons and the full
/// Recent list.
pub fn welcome(state: &Entity<AppState>, cx: &mut App) -> AnyElement {
    let p = palette(cx).clone();
    let recent: Vec<(String, String)> = state
        .read(cx)
        .session
        .prefs()
        .recent_libraries
        .iter()
        .map(|r| (r.label().to_owned(), r.path.clone()))
        .collect();

    let recents = if recent.is_empty() {
        div()
            .mt_8()
            .text_sm()
            .text_color(p.text_secondary)
            .child("No recent libraries yet.")
            .into_any_element()
    } else {
        div()
            .mt_8()
            .flex()
            .flex_col()
            .gap_1()
            .child(
                div()
                    .text_xs()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(p.text_secondary)
                    .child("Recent"),
            )
            .children(recent.into_iter().enumerate().map(|(ix, (label, path))| {
                let open_state = state.clone();
                let remove_state = state.clone();
                let open_path = path.clone();
                let remove_path = path.clone();
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .child(
                        div()
                            .id(("recent", ix))
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .px_3()
                            .py_1p5()
                            .rounded_md()
                            .cursor_pointer()
                            .hover(|s| s.bg(p.hover))
                            .tooltip({
                                let path = path.clone();
                                move |window, cx| Tooltip::new(path.clone()).build(window, cx)
                            })
                            .on_click(move |_, _, cx| {
                                let path = open_path.clone();
                                open_state.update(cx, |s, cx| s.open_library(path.into(), cx));
                            })
                            .child(div().text_sm().font_weight(FontWeight::MEDIUM).child(label))
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(p.text_secondary)
                                    .overflow_hidden()
                                    .text_ellipsis()
                                    .whitespace_nowrap()
                                    .child(path),
                            ),
                    )
                    .child(
                        Button::new(("remove-recent", ix))
                            .ghost()
                            .xsmall()
                            .icon(IconName::Close)
                            .tooltip("Remove from recent")
                            .on_click(move |_, _, cx| {
                                let path = remove_path.clone();
                                remove_state.update(cx, |s, cx| {
                                    s.session.forget_recent(&path);
                                    s.notify_all(cx);
                                });
                            }),
                    )
            }))
            .into_any_element()
    };

    let open_state = state.clone();
    let new_state = state.clone();
    div()
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .w(px(460.))
                .flex()
                .flex_col()
                .child(
                    div()
                        .text_xs()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(p.text_secondary)
                        .child("Prayer library"),
                )
                .child(
                    div()
                        .text_2xl()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("Open a library to begin"),
                )
                .child(div().mt_1().text_sm().text_color(p.text_secondary).child(
                    "Choose a recent folder, browse for an existing library, or create a new one.",
                ))
                .child(
                    div()
                        .mt_4()
                        .flex()
                        .gap_2()
                        .child(
                            Button::new("open-library")
                                .primary()
                                .icon(Icon::new(IconName::FolderOpen))
                                .label("Open library…")
                                .on_click(move |_, _, cx| {
                                    crate::app::pick_and_open_library(open_state.clone(), cx)
                                }),
                        )
                        .child(
                            Button::new("new-library")
                                .icon(Icon::new(IconName::Plus))
                                .label("New library…")
                                .on_click(move |_, window, cx| {
                                    dialogs::new_library::open(new_state.clone(), window, cx)
                                }),
                        ),
                )
                .child(recents),
        )
        .into_any_element()
}

/// A Library is open but no prayer is selected.
pub fn nothing_selected(cx: &mut App) -> AnyElement {
    let p = palette(cx).clone();
    centered(p.text_secondary, "Select a prayer from the library.")
}

/// The selected file is invalid: "Cannot open prayer".
pub fn invalid(state: &Entity<AppState>, cx: &mut App) -> AnyElement {
    let p = palette(cx).clone();
    let (path, errors) = match state.read(cx).session.selected_invalid() {
        Some(invalid) => (invalid.path.clone(), invalid.errors.clone()),
        None => (String::new(), Vec::new()),
    };
    let file_name = path.rsplit(['/', '\\']).next().unwrap_or(&path).to_owned();
    div()
        .size_full()
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .max_w(px(420.))
                .flex()
                .flex_col()
                .items_center()
                .gap_1()
                .child(
                    div()
                        .text_xs()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(p.text_secondary)
                        .child("Cannot open prayer"),
                )
                .child(
                    div()
                        .id("invalid-file")
                        .text_lg()
                        .font_weight(FontWeight::SEMIBOLD)
                        .tooltip({
                            let path = path.clone();
                            move |window, cx| Tooltip::new(path.clone()).build(window, cx)
                        })
                        .child(file_name),
                )
                .child(
                    div()
                        .text_sm()
                        .text_center()
                        .text_color(p.text_secondary)
                        .child(
                            "This file is invalid or corrupted and cannot be opened in the editor. Fix the JSON on disk, then refresh the library.",
                        ),
                )
                .child(
                    div().mt_2().child(
                        Button::new("validation-details")
                            .ghost()
                            .icon(Icon::new(IconName::Info))
                            .tooltip("Show validation details")
                            .on_click(move |_, window, cx| {
                                dialogs::validation::open(errors.clone(), window, cx)
                            }),
                    ),
                ),
        )
        .into_any_element()
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
