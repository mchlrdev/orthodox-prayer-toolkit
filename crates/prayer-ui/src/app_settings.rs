//! App settings: appearance (Light / Dark / System) and updates.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{Disableable, WindowExt};
use gpui_kit::*;
use prayer_app::prefs::ColorScheme;
use prayer_app::session::PendingAction;

use crate::state::AppState;
use crate::theme::palette;
use crate::update::UpdateState;
use crate::updates::Updates;

const RELEASES_URL: &str = "https://github.com/mchlrdev/orthodox-prayer-toolkit/releases";

pub fn open(state: Entity<AppState>, updates: Entity<Updates>, window: &mut Window, cx: &mut App) {
    // Like Electron: opening the settings checks for updates.
    updates.update(cx, |u, cx| u.check(cx));
    let view = cx.new(|cx| SettingsView::new(state, updates, cx));
    window.open_dialog(cx, move |dialog, _, _| {
        dialog.title("App settings").w(px(480.)).child(view.clone())
    });
}

struct SettingsView {
    state: Entity<AppState>,
    updates: Entity<Updates>,
    _subscriptions: Vec<Subscription>,
}

impl SettingsView {
    fn new(state: Entity<AppState>, updates: Entity<Updates>, cx: &mut Context<Self>) -> Self {
        let subscriptions = vec![
            cx.observe(&updates, |_, _, cx| cx.notify()),
            cx.observe(&state, |_, _, cx| cx.notify()),
        ];
        Self {
            state,
            updates,
            _subscriptions: subscriptions,
        }
    }

    fn set_scheme(&mut self, scheme: ColorScheme, window: &mut Window, cx: &mut Context<Self>) {
        self.state.update(cx, |s, _| {
            s.session.update_prefs(|p| p.color_scheme = scheme)
        });
        crate::apply_appearance(scheme, Some(window), cx);
        window.refresh();
        cx.notify();
    }
}

impl Render for SettingsView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = palette(cx).clone();
        let scheme = self.state.read(cx).session.prefs().color_scheme;
        let updates = self.updates.read(cx);
        let version = updates.version();
        let status = updates.status();
        let busy = updates.busy;
        let dev = matches!(updates.state, UpdateState::Dev { .. });
        let error = !busy && matches!(updates.state, UpdateState::Error { .. });
        let available = !busy && matches!(updates.state, UpdateState::Available { .. });
        let ready = !busy && updates.is_ready();

        let scheme_button = |id: &'static str, label: &'static str, value: ColorScheme| {
            let selected = scheme == value;
            let button = Button::new(id).label(label).flex_1().on_click(
                cx.listener(move |this, _, window, cx| this.set_scheme(value, window, cx)),
            );
            if selected { button.primary() } else { button }
        };

        div()
            .flex()
            .flex_col()
            .gap_5()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Appearance"),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_1()
                            .child(scheme_button("light", "Light", ColorScheme::Light))
                            .child(scheme_button("dark", "Dark", ColorScheme::Dark))
                            .child(scheme_button("system", "System", ColorScheme::System)),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1p5()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("About"),
                    )
                    .child(div().text_sm().child(format!("Version {version}")))
                    .child(
                        div()
                            .text_xs()
                            .text_color(if error { p.accent } else { p.text_secondary })
                            .child(status),
                    )
                    .children(available.then(|| {
                        div().text_xs().text_color(p.text_secondary).child(
                            "The update is downloading. You'll be asked to install it when it's ready.",
                        )
                    }))
                    .child(
                        div()
                            .mt_1()
                            .flex()
                            .gap_2()
                            .children(ready.then(|| {
                                Button::new("install")
                                    .primary()
                                    .label("Install and Restart")
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        window.close_dialog(cx);
                                        this.state.update(cx, |s, cx| {
                                            s.request(PendingAction::InstallUpdate, cx)
                                        });
                                    }))
                            }))
                            .children((!dev).then(|| {
                                Button::new("check")
                                    .label("Check for updates")
                                    .disabled(busy)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.updates.update(cx, |u, cx| u.check(cx));
                                    }))
                            })),
                    )
                    .child(
                        div().flex().child(
                            Button::new("releases")
                                .link()
                                .label("GitHub Releases")
                                .on_click(|_, _, cx| cx.open_url(RELEASES_URL)),
                        ),
                    ),
            )
    }
}
