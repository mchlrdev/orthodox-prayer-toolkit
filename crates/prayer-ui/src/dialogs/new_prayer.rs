//! The "New prayer" modal: File name, Description, Type, Tone, Book,
//! Occasion and the first Variant's metadata. The defaults and the creation
//! live in the Session (`begin_create`, `create_prayer`).

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_kit::component::{Disableable, WindowExt};
use gpui_kit::*;
use prayer_app::session::NewPrayerForm;

use crate::state::AppState;
use crate::theme::palette;

pub fn open(state: Entity<AppState>, window: &mut Window, cx: &mut App) {
    let form = state.update(cx, |s, cx| {
        let result = s.session.begin_create().map(prayer_app::session::Done::new);
        s.report(result, cx)
    });
    let Some(form) = form else {
        return;
    };
    let view = cx.new(|cx| NewPrayerView::new(state, &form, window, cx));
    window.open_dialog(cx, move |dialog, _, _| {
        dialog.title("New prayer").w(px(560.)).child(view.clone())
    });
}

/// A label above a control, with an optional hint line.
pub(crate) fn field(
    label: &'static str,
    hint: Option<&'static str>,
    secondary: Hsla,
    child: impl IntoElement,
) -> Div {
    div()
        .flex()
        .flex_col()
        .gap_1()
        .flex_1()
        .child(div().text_sm().font_weight(FontWeight::MEDIUM).child(label))
        .children(hint.map(|h| div().text_xs().text_color(secondary).child(h)))
        .child(child)
}

struct NewPrayerView {
    /// The first field gets focus on the first render (focusing in the
    /// constructor doesn't stick).
    focused: bool,
    state: Entity<AppState>,
    id: Entity<InputState>,
    description: Entity<TextareaState>,
    prayer_type: Entity<InputState>,
    tone: Entity<InputState>,
    book: Entity<InputState>,
    occasion: Entity<InputState>,
    lang: Entity<InputState>,
    variant: Entity<InputState>,
    title: Entity<InputState>,
    license: Entity<InputState>,
    source: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}

impl NewPrayerView {
    fn new(
        state: Entity<AppState>,
        form: &NewPrayerForm,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let input = |value: &str,
                     placeholder: &'static str,
                     window: &mut Window,
                     cx: &mut Context<Self>| {
            cx.new(|cx| {
                InputState::new(window, cx)
                    .default_value(value.to_owned())
                    .placeholder(placeholder)
            })
        };
        let id = input(&form.id, "", window, cx);
        let description = cx.new(|cx| TextareaState::new(window, cx));
        let tone = input(
            &form.tone.map(|t| t.to_string()).unwrap_or_default(),
            "",
            window,
            cx,
        );
        let this = Self {
            focused: false,
            state,
            prayer_type: input(&form.prayer_type, "", window, cx),
            book: input(&form.book, "horologion, menaion…", window, cx),
            occasion: input(&form.occasion, "Optional", window, cx),
            lang: input(&form.lang, "", window, cx),
            variant: input(&form.variant, "", window, cx),
            title: input(&form.title, "", window, cx),
            license: input(&form.license, "", window, cx),
            source: input(&form.source, "", window, cx),
            id: id.clone(),
            description,
            tone,
            _subscriptions: Vec::new(),
        };
        let mut this = this;
        // The "Required" error and the Create button follow the id.
        let sub = cx.subscribe_in(&id, window, |_, _, event: &InputEvent, _, cx| {
            if matches!(event, InputEvent::Change) {
                cx.notify();
            }
        });
        this._subscriptions.push(sub);
        this
    }

    fn collect(&self, cx: &App) -> NewPrayerForm {
        let text = |e: &Entity<InputState>| e.read(cx).value().to_string();
        let mut form = NewPrayerForm::new(text(&self.id));
        form.description = self.description.read(cx).value().to_string();
        form.prayer_type = text(&self.prayer_type);
        form.tone = text(&self.tone)
            .trim()
            .parse::<u8>()
            .ok()
            .filter(|t| (1..=8).contains(t));
        form.book = text(&self.book);
        form.occasion = text(&self.occasion);
        form.lang = text(&self.lang);
        form.variant = text(&self.variant);
        form.title = text(&self.title);
        form.license = text(&self.license);
        form.source = text(&self.source);
        form
    }

    fn create(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let form = self.collect(cx);
        if form.id.trim().is_empty() {
            return;
        }
        let created = self.state.update(cx, |s, cx| {
            let result = s.session.create_prayer(&form);
            let created = s.report(result, cx).is_some();
            s.notify_all(cx);
            created
        });
        if created {
            window.close_dialog(cx);
        }
    }
}

impl Render for NewPrayerView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !std::mem::replace(&mut self.focused, true) {
            self.id.update(cx, |s, cx| s.focus(window, cx));
        }
        let p = palette(cx).clone();
        let id_ok = !self.id.read(cx).value().trim().is_empty();
        let sec = p.text_secondary;
        let row = || div().flex().flex_row().gap_3();
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        field("File name", None, sec, Input::new(&self.id)).children(
                            (!id_ok)
                                .then(|| div().text_xs().text_color(p.accent).child("Required")),
                        ),
                    )
                    .child(field(
                        "Description",
                        None,
                        sec,
                        Textarea::new(&self.description).h(px(64.)),
                    ))
                    .child(
                        row()
                            .child(field(
                                "Type",
                                Some("e.g. prayer, troparion"),
                                sec,
                                Input::new(&self.prayer_type),
                            ))
                            .child(field(
                                "Tone",
                                Some("1–8, optional"),
                                sec,
                                Input::new(&self.tone),
                            )),
                    )
                    .child(
                        row()
                            .child(field("Book", None, sec, Input::new(&self.book)))
                            .child(field("Occasion", None, sec, Input::new(&self.occasion))),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Language"),
                    )
                    .child(
                        row()
                            .child(field("Language Code", None, sec, Input::new(&self.lang)))
                            .child(field("Edition", None, sec, Input::new(&self.variant))),
                    )
                    .child(field("Display title", None, sec, Input::new(&self.title)))
                    .child(
                        row()
                            .child(field("License", None, sec, Input::new(&self.license)))
                            .child(field("Source", None, sec, Input::new(&self.source))),
                    ),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap_2()
                    .child(
                        Button::new("cancel")
                            .label("Cancel")
                            .on_click(|_, window, cx| window.close_dialog(cx)),
                    )
                    .child(
                        Button::new("create")
                            .label("Create")
                            .primary()
                            .disabled(!id_ok)
                            .on_click(cx.listener(|this, _, window, cx| this.create(window, cx))),
                    ),
            )
    }
}
