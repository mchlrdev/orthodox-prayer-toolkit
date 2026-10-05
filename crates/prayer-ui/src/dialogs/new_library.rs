//! The "New library…" modal: folder name, description and default Variant,
//! then a folder picker for the parent location.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_kit::component::{Disableable, WindowExt};
use gpui_kit::*;
use prayer_app::library::NewLibrary;

use super::new_prayer::field;
use crate::state::AppState;
use crate::theme::palette;

pub fn open(state: Entity<AppState>, window: &mut Window, cx: &mut App) {
    let view = cx.new(|cx| NewLibraryView::new(state, window, cx));
    window.open_dialog(cx, move |dialog, _, _| {
        dialog.title("New library").w(px(480.)).child(view.clone())
    });
}

struct NewLibraryView {
    /// The first field gets focus on the first render (focusing in the
    /// constructor doesn't stick).
    focused: bool,
    state: Entity<AppState>,
    name: Entity<InputState>,
    description: Entity<TextareaState>,
    lang: Entity<InputState>,
    variant: Entity<InputState>,
    creating: bool,
    _subscriptions: Vec<Subscription>,
}

impl NewLibraryView {
    fn new(state: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let defaults = NewLibrary::default();
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("my-prayer-library"));
        let description = cx.new(|cx| TextareaState::new(window, cx));
        let lang = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(defaults.lang.clone())
                .placeholder("de")
        });
        let variant = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(defaults.variant.clone())
                .placeholder("standard")
        });
        let subscriptions = [&name, &lang, &variant]
            .into_iter()
            .map(|input| {
                cx.subscribe_in(input, window, |_, _, event: &InputEvent, _, cx| {
                    if matches!(event, InputEvent::Change) {
                        cx.notify();
                    }
                })
            })
            .collect();
        Self {
            focused: false,
            state,
            name,
            description,
            lang,
            variant,
            creating: false,
            _subscriptions: subscriptions,
        }
    }

    fn spec(&self, cx: &App) -> NewLibrary {
        NewLibrary {
            name: self.name.read(cx).value().to_string(),
            description: self.description.read(cx).value().to_string(),
            lang: self.lang.read(cx).value().to_string(),
            variant: self.variant.read(cx).value().to_string(),
        }
    }

    /// "Choose location…": pick the parent folder, then create and open.
    fn choose_location(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let spec = self.spec(cx);
        if spec.validate().is_err() || self.creating {
            return;
        }
        self.creating = true;
        cx.notify();
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Create here".into()),
        });
        cx.spawn_in(window, async move |this, cx| {
            let parent = match paths.await {
                Ok(Ok(Some(paths))) => paths.into_iter().next(),
                _ => None,
            };
            this.update_in(cx, |this, window, cx| {
                this.creating = false;
                if let Some(parent) = parent {
                    let created = this.state.update(cx, |s, cx| {
                        let result = s.session.create_library(&parent, &spec);
                        match s.report(result, cx) {
                            Some(outcome) => {
                                s.after_outcome(outcome, cx);
                                true
                            }
                            None => false,
                        }
                    });
                    if created {
                        window.close_dialog(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

impl Render for NewLibraryView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !std::mem::replace(&mut self.focused, true) {
            self.name.update(cx, |s, cx| s.focus(window, cx));
        }
        let p = palette(cx).clone();
        let spec = self.spec(cx);
        let trimmed = spec.name.trim();
        let name_ok = !trimmed.is_empty()
            && !trimmed.contains(['/', '\\'])
            && trimmed != "."
            && trimmed != "..";
        let name_error = !trimmed.is_empty() && !name_ok;
        let defaults_ok = spec.lang.trim().is_empty() == spec.variant.trim().is_empty();
        let can_create = name_ok && defaults_ok && !self.creating;
        let sec = p.text_secondary;
        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                field("Folder name", None, sec, Input::new(&self.name)).children(name_error.then(
                    || {
                        div()
                            .text_xs()
                            .text_color(p.accent)
                            .child("Name cannot contain path separators")
                    },
                )),
            )
            .child(field(
                "Description",
                None,
                sec,
                Textarea::new(&self.description).h(px(64.)),
            ))
            .child(
                div()
                    .flex()
                    .gap_3()
                    .child(field("Default language", None, sec, Input::new(&self.lang)))
                    .child(field(
                        "Default variant",
                        None,
                        sec,
                        Input::new(&self.variant),
                    )),
            )
            .children((!defaults_ok).then(|| {
                div()
                    .text_xs()
                    .text_color(p.accent)
                    .child("Provide both language and variant, or leave both empty.")
            }))
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap_2()
                    .child(
                        Button::new("cancel")
                            .label("Cancel")
                            .disabled(self.creating)
                            .on_click(|_, window, cx| window.close_dialog(cx)),
                    )
                    .child(
                        Button::new("choose")
                            .label("Choose location…")
                            .primary()
                            .loading(self.creating)
                            .disabled(!can_create)
                            .on_click(
                                cx.listener(|this, _, window, cx| this.choose_location(window, cx)),
                            ),
                    ),
            )
    }
}
