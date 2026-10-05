//! Prayer settings: Prayer, Languages and Kinds panes. Every field edits the
//! selected prayer's Session draft at once (undoable, marks it unsaved);
//! Kind styles are Library settings and are written at once.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{InputState, TextareaState};
use gpui_kit::component::{Disableable, IconName, Sizable, WindowExt};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use prayer_app::edit::{self, VariantMetaPatch};
use prayer_app::history::EditKind;
use prayer_core::validate_styles::{is_valid_kind_id, sanitize_kind_id_input};
use prayer_core::{Prayer, is_kind_preset, kind_display_label};

use super::fields::{
    Edited, KindStyleEditor, area_view, dimmed, field, input_view, section_title, set_text,
    text_area, text_input,
};
use super::kind::{delete_kind, known_kinds, rename_flow, style_of, write_style};
use crate::state::AppState;
use crate::theme::palette;

pub fn open(state: Entity<AppState>, window: &mut Window, cx: &mut App) {
    if state.read(cx).session.selected_draft().is_none() {
        return;
    }
    let form = cx.new(|cx| PrayerSettingsForm::new(state, window, cx));
    window.open_dialog(cx, move |dialog, _, _| {
        dialog
            .title("Settings")
            .w(px(760.))
            .on_ok(|_, _, _| false)
            .child(form.clone())
    });
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Pane {
    Prayer,
    Languages,
    Kinds,
}

/// One row of "Extra fields".
struct ExtraRow {
    key: String,
    name: Entity<InputState>,
    value: Entity<InputState>,
    _subs: Vec<Subscription>,
}

/// The five fields of one Variant.
struct VariantRow {
    lang: Entity<InputState>,
    variant: Entity<InputState>,
    title: Entity<InputState>,
    license: Entity<InputState>,
    source: Entity<InputState>,
    _subs: Vec<Subscription>,
}

/// What a Variant field is.
#[derive(Clone, Copy)]
enum VariantField {
    Lang,
    Variant,
    Title,
    License,
    Source,
}

struct PrayerSettingsForm {
    state: Entity<AppState>,
    pane: Pane,
    subs: Vec<Subscription>,

    id: Entity<InputState>,
    description: Entity<TextareaState>,
    prayer_type: Entity<InputState>,
    tone: Entity<InputState>,
    book: Entity<InputState>,
    occasion: Entity<InputState>,

    extras: Vec<ExtraRow>,
    extra_keys: Vec<String>,

    variants: Vec<VariantRow>,
    open_variant: Option<usize>,

    open_kind: Option<String>,
    kind_name: Entity<InputState>,
    kind_name_text: String,
    kind_editor: Option<Entity<KindStyleEditor>>,
    adding_kind: bool,
    new_kind: Entity<InputState>,
    new_kind_text: String,
    focused: bool,
}

fn custom_keys(prayer: &Prayer) -> Vec<String> {
    prayer
        .meta
        .as_ref()
        .and_then(|m| m.custom.as_ref())
        .map(|c| c.keys().cloned().collect())
        .unwrap_or_default()
}

fn tone_text(prayer: &Prayer) -> String {
    prayer
        .tone
        .flatten()
        .map(|t| t.to_string())
        .unwrap_or_default()
}

impl PrayerSettingsForm {
    fn new(state: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let prayer = state
            .read(cx)
            .session
            .selected_draft()
            .map(|d| d.prayer().clone())
            .expect("a selected prayer");
        let mut subs = Vec::new();

        let id = text_input(
            &prayer.id,
            "",
            &mut subs,
            window,
            cx,
            |this: &mut Self, e, _, cx| {
                if let Edited::Change(v) = e {
                    this.edit(EditKind::Typing, cx, |p| edit::set_id(p, &v));
                }
            },
        );
        let description = text_area(
            prayer.description.as_deref().unwrap_or(""),
            &mut subs,
            window,
            cx,
            |this: &mut Self, e, _, cx| {
                if let Edited::Change(v) = e {
                    this.edit(EditKind::Typing, cx, |p| edit::set_description(p, &v));
                }
            },
        );
        let prayer_type = text_input(
            &prayer.prayer_type,
            "",
            &mut subs,
            window,
            cx,
            |this: &mut Self, e, _, cx| {
                if let Edited::Change(v) = e {
                    this.edit(EditKind::Typing, cx, |p| edit::set_type(p, &v));
                }
            },
        );
        let tone = text_input(
            &tone_text(&prayer),
            "",
            &mut subs,
            window,
            cx,
            |this: &mut Self, e, window, cx| match e {
                Edited::Change(v) => {
                    let digits: String = v.chars().filter(char::is_ascii_digit).collect();
                    let value = digits.parse::<u8>().ok().filter(|t| (1..=8).contains(t));
                    if digits.is_empty() || value.is_some() {
                        this.edit(EditKind::Typing, cx, |p| edit::set_tone(p, value));
                    }
                    if digits != v || (!digits.is_empty() && value.is_none()) {
                        this.reset_tone(window, cx);
                    }
                }
                Edited::Blur => this.reset_tone(window, cx),
                Edited::Enter => {}
            },
        );
        let book = text_input(
            prayer.book.as_deref().unwrap_or(""),
            "horologion, menaion…",
            &mut subs,
            window,
            cx,
            |this: &mut Self, e, _, cx| {
                if let Edited::Change(v) = e {
                    this.edit(EditKind::Typing, cx, |p| edit::set_book(p, &v));
                }
            },
        );
        let occasion = text_input(
            prayer.occasion.as_deref().unwrap_or(""),
            "Optional",
            &mut subs,
            window,
            cx,
            |this: &mut Self, e, _, cx| {
                if let Edited::Change(v) = e {
                    this.edit(EditKind::Typing, cx, |p| edit::set_occasion(p, &v));
                }
            },
        );
        let kind_name = text_input(
            "",
            "",
            &mut subs,
            window,
            cx,
            |this: &mut Self, e, window, cx| match e {
                Edited::Change(raw) => {
                    let clean = sanitize_kind_id_input(&raw);
                    if clean != raw {
                        set_text(&this.kind_name, &clean, window, cx);
                    }
                    this.kind_name_text = clean;
                    cx.notify();
                }
                Edited::Enter | Edited::Blur => {
                    if let Some(kind) = this.open_kind.clone() {
                        this.commit_rename(&kind, window, cx);
                    }
                }
            },
        );
        let new_kind = text_input(
            "",
            "new-kind",
            &mut subs,
            window,
            cx,
            |this: &mut Self, e, window, cx| match e {
                Edited::Change(raw) => {
                    let clean = sanitize_kind_id_input(&raw);
                    if clean != raw {
                        set_text(&this.new_kind, &clean, window, cx);
                    }
                    this.new_kind_text = clean;
                    cx.notify();
                }
                Edited::Enter => this.commit_add_kind(window, cx),
                Edited::Blur => {}
            },
        );

        let mut form = Self {
            state,
            pane: Pane::Prayer,
            subs,
            id,
            description,
            prayer_type,
            tone,
            book,
            occasion,
            extras: Vec::new(),
            extra_keys: Vec::new(),
            variants: Vec::new(),
            open_variant: None,
            open_kind: None,
            kind_name,
            kind_name_text: String::new(),
            kind_editor: None,
            adding_kind: false,
            new_kind,
            new_kind_text: String::new(),
            focused: false,
        };
        form.rebuild_extras(&prayer, window, cx);
        form.rebuild_variants(&prayer, window, cx);
        form
    }

    fn prayer(&self, cx: &App) -> Option<Prayer> {
        self.state
            .read(cx)
            .session
            .selected_draft()
            .map(|d| d.prayer().clone())
    }

    /// An undoable edit of the selected prayer's draft.
    fn edit<R>(&self, kind: EditKind, cx: &mut App, f: impl FnOnce(&mut Prayer) -> R) -> Option<R> {
        self.state.update(cx, |s, cx| {
            let result = s.session.edit_selected(kind, f);
            s.notify_all(cx);
            result
        })
    }

    fn reset_tone(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let text = self.prayer(cx).map(|p| tone_text(&p)).unwrap_or_default();
        set_text(&self.tone, &text, window, cx);
    }

    // -- extra fields ---------------------------------------------------

    fn rebuild_extras(&mut self, prayer: &Prayer, window: &mut Window, cx: &mut Context<Self>) {
        self.extra_keys = custom_keys(prayer);
        let custom = prayer.meta.as_ref().and_then(|m| m.custom.clone());
        self.extras = self
            .extra_keys
            .clone()
            .into_iter()
            .map(|key| {
                let value = match custom.as_ref().and_then(|c| c.get(&key)) {
                    Some(v) if v.is_null() => String::new(),
                    Some(v) => v.as_str().map_or_else(|| v.to_string(), str::to_owned),
                    None => String::new(),
                };
                let mut subs = Vec::new();
                let name_key = key.clone();
                let name = text_input(
                    &key,
                    "",
                    &mut subs,
                    window,
                    cx,
                    move |this: &mut Self, e, window, cx| {
                        if matches!(e, Edited::Blur | Edited::Enter) {
                            let to = this
                                .extras
                                .iter()
                                .find(|r| r.key == name_key)
                                .map(|r| r.name.read(cx).value().to_string());
                            if let Some(to) = to {
                                this.rename_extra(&name_key, &to, window, cx);
                            }
                        }
                    },
                );
                let value_key = key.clone();
                let value = text_input(
                    &value,
                    "",
                    &mut subs,
                    window,
                    cx,
                    move |this: &mut Self, e, _, cx| {
                        if let Edited::Change(v) = e {
                            this.edit(EditKind::Typing, cx, |p| {
                                edit::set_custom_field(p, &value_key, &v)
                            });
                        }
                    },
                );
                ExtraRow {
                    key,
                    name,
                    value,
                    _subs: subs,
                }
            })
            .collect();
    }

    fn sync_extras(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(prayer) = self.prayer(cx) else {
            return;
        };
        if custom_keys(&prayer) != self.extra_keys {
            self.rebuild_extras(&prayer, window, cx);
        }
    }

    fn rename_extra(&mut self, from: &str, to: &str, window: &mut Window, cx: &mut Context<Self>) {
        let renamed = self
            .edit(EditKind::Other, cx, |p| {
                edit::rename_custom_field(p, from, to)
            })
            .unwrap_or(false);
        if !renamed {
            // Blank, unchanged or taken: the field shows its name again.
            set_text(
                &self
                    .extras
                    .iter()
                    .find(|r| r.key == from)
                    .map(|r| r.name.clone())
                    .unwrap_or_else(|| self.id.clone()),
                from,
                window,
                cx,
            );
        }
        cx.notify();
    }

    // -- variants ---------------------------------------------------------

    fn rebuild_variants(&mut self, prayer: &Prayer, window: &mut Window, cx: &mut Context<Self>) {
        self.variants = prayer
            .variants
            .iter()
            .enumerate()
            .map(|(index, v)| {
                let mut subs = Vec::new();
                let mut make = |value: &str, field: VariantField, subs: &mut Vec<Subscription>| {
                    text_input(
                        value,
                        "",
                        subs,
                        window,
                        cx,
                        move |this: &mut Self, e, _, cx| {
                            if let Edited::Change(text) = e {
                                this.patch_variant(index, field, text, cx);
                            }
                        },
                    )
                };
                VariantRow {
                    lang: make(&v.lang, VariantField::Lang, &mut subs),
                    variant: make(&v.variant, VariantField::Variant, &mut subs),
                    title: make(&v.title, VariantField::Title, &mut subs),
                    license: make(&v.license, VariantField::License, &mut subs),
                    source: make(&v.source, VariantField::Source, &mut subs),
                    _subs: subs,
                }
            })
            .collect();
    }

    fn sync_variants(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(prayer) = self.prayer(cx) else {
            return;
        };
        if prayer.variants.len() != self.variants.len() {
            self.rebuild_variants(&prayer, window, cx);
        }
    }

    /// Edits one Variant field. A changed `lang` or `variant` moves the
    /// Variant's translations and keeps the visible columns on it; the
    /// columns are reconciled only after the rename so a renamed single
    /// column is not replaced by the fallback.
    fn patch_variant(
        &mut self,
        index: usize,
        field: VariantField,
        text: String,
        cx: &mut Context<Self>,
    ) {
        let mut patch = VariantMetaPatch::default();
        match field {
            VariantField::Lang => patch.lang = Some(text),
            VariantField::Variant => patch.variant = Some(text),
            VariantField::Title => patch.title = Some(text),
            VariantField::License => patch.license = Some(text),
            VariantField::Source => patch.source = Some(text),
        }
        self.state.update(cx, |s, cx| {
            let renamed = s.session.selected_draft_mut().and_then(|d| {
                d.edit(EditKind::Typing, |p| {
                    edit::update_variant_meta(p, index, &patch)
                })
            });
            if let Some(renamed) = renamed {
                s.session.apply_variant_rename(&renamed);
            }
            s.session.visible_variants();
            s.notify_all(cx);
        });
        cx.notify();
    }

    fn add_variant(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.edit(EditKind::Other, cx, edit::add_variant);
        if let Some(prayer) = self.prayer(cx) {
            self.rebuild_variants(&prayer, window, cx);
            self.open_variant = prayer.variants.len().checked_sub(1);
        }
        cx.notify();
    }

    fn remove_variant(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let removed = self
            .edit(EditKind::Other, cx, |p| edit::remove_variant(p, index))
            .flatten();
        if removed.is_none() {
            return;
        }
        if let Some(prayer) = self.prayer(cx) {
            self.rebuild_variants(&prayer, window, cx);
        }
        self.open_variant = match self.open_variant {
            Some(open) if open == index => None,
            Some(open) if open > index => Some(open - 1),
            other => other,
        };
        cx.notify();
    }

    // -- kinds ------------------------------------------------------------

    fn open_kind(&mut self, kind: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        self.open_kind = kind.clone();
        self.kind_editor = None;
        let Some(kind) = kind else {
            cx.notify();
            return;
        };
        self.kind_name_text = kind.clone();
        set_text(&self.kind_name, &kind, window, cx);
        let style = style_of(self.state.read(cx), &kind);
        let state = self.state.clone();
        let written = kind.clone();
        self.kind_editor = Some(cx.new(|cx| {
            KindStyleEditor::new(
                style,
                move |style, _, cx| write_style(&state, &written, style, cx),
                window,
                cx,
            )
        }));
        cx.notify();
    }

    fn rename_issue(&self, kind: &str, cx: &App) -> Option<&'static str> {
        edit::kind_rename_issue(
            kind,
            &self.kind_name_text,
            known_kinds(self.state.read(cx)).iter().map(String::as_str),
        )
    }

    fn commit_rename(&mut self, kind: &str, window: &mut Window, cx: &mut Context<Self>) {
        let next = self.kind_name_text.trim().to_owned();
        if self.rename_issue(kind, cx).is_some() || next.is_empty() || next == kind {
            self.kind_name_text = kind.to_owned();
            set_text(&self.kind_name, kind, window, cx);
            cx.notify();
            return;
        }
        let form = cx.entity();
        let target = next.clone();
        let state = self.state.clone();
        rename_flow(
            &state,
            kind,
            &next,
            move |window, cx| {
                form.update(cx, |form, cx| {
                    form.open_kind(Some(target.clone()), window, cx)
                })
            },
            window,
            cx,
        );
    }

    fn remove_kind(&mut self, kind: &str, cx: &mut Context<Self>) {
        if is_kind_preset(kind) {
            return;
        }
        if self.open_kind.as_deref() == Some(kind) {
            self.open_kind = None;
            self.kind_editor = None;
        }
        delete_kind(&self.state, kind, cx);
        cx.notify();
    }

    fn commit_add_kind(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let id = sanitize_kind_id_input(&self.new_kind_text);
        let exists = known_kinds(self.state.read(cx)).contains(&id);
        if !is_valid_kind_id(&id) || exists {
            return;
        }
        // A new Kind is kept as a Library Kind even when no Block uses it.
        let style = style_of(self.state.read(cx), &id);
        write_style(&self.state, &id, &style, cx);
        self.adding_kind = false;
        self.new_kind_text.clear();
        set_text(&self.new_kind, "", window, cx);
        self.open_kind(Some(id), window, cx);
    }

    // -- rendering ----------------------------------------------------------

    fn nav_item(
        &self,
        pane: Pane,
        label: &'static str,
        icon: IconName,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let p = palette(cx).clone();
        let active = self.pane == pane;
        div()
            .id(label)
            .flex()
            .items_center()
            .gap_2()
            .px_3()
            .py_2()
            .rounded_md()
            .cursor_pointer()
            .text_sm()
            .when(active, |this| {
                this.bg(p.hover_strong).font_weight(FontWeight::SEMIBOLD)
            })
            .when(!active, |this| this.hover(|s| s.bg(p.hover)))
            .child(gpui_kit::component::Icon::new(icon).size_4())
            .child(label)
            .on_click(cx.listener(move |this, _, _, cx| {
                this.pane = pane;
                cx.notify();
            }))
    }

    fn render_prayer_pane(&mut self, prayer: &Prayer, cx: &mut Context<Self>) -> Div {
        let id_missing = prayer.id.trim().is_empty();
        let rows: Vec<Div> = self
            .extras
            .iter()
            .map(|row| {
                let key = row.key.clone();
                div()
                    .flex()
                    .items_end()
                    .gap_2()
                    .child(div().flex_1().child(field(
                        "Name",
                        None,
                        None,
                        cx,
                        input_view(&row.name),
                    )))
                    .child(div().flex_1().child(field(
                        "Value",
                        None,
                        None,
                        cx,
                        input_view(&row.value),
                    )))
                    .child(
                        Button::new(SharedString::from(format!("remove-extra-{key}")))
                            .icon(IconName::Delete)
                            .ghost()
                            .danger()
                            .tooltip(format!("Remove {key}"))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.edit(EditKind::Other, cx, |p| {
                                    edit::remove_custom_field(p, &key)
                                });
                                cx.notify();
                            })),
                    )
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(field(
                        "File name",
                        None,
                        id_missing.then_some("Required"),
                        cx,
                        input_view(&self.id),
                    ))
                    .child(field(
                        "Description",
                        None,
                        None,
                        cx,
                        area_view(&self.description),
                    ))
                    .child(
                        div()
                            .flex()
                            .gap_3()
                            .child(div().flex_1().child(field(
                                "Type",
                                Some("e.g. prayer, troparion"),
                                None,
                                cx,
                                input_view(&self.prayer_type),
                            )))
                            .child(div().flex_1().child(field(
                                "Tone",
                                Some("1–8, optional"),
                                None,
                                cx,
                                input_view(&self.tone),
                            ))),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_3()
                            .child(div().flex_1().child(field(
                                "Book",
                                None,
                                None,
                                cx,
                                input_view(&self.book),
                            )))
                            .child(div().flex_1().child(field(
                                "Occasion",
                                None,
                                None,
                                cx,
                                input_view(&self.occasion),
                            ))),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(section_title("Extra fields"))
                    .when(rows.is_empty(), |this| {
                        this.child(dimmed("No extra fields yet.", cx))
                    })
                    .children(rows)
                    .child(
                        Button::new("add-extra")
                            .label("Add field")
                            .icon(IconName::Plus)
                            .small()
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.edit(EditKind::Other, cx, edit::add_custom_field);
                                cx.notify();
                            })),
                    ),
            )
    }

    fn render_languages_pane(&mut self, prayer: &Prayer, cx: &mut Context<Self>) -> Div {
        let p = palette(cx).clone();
        let only_one = prayer.variants.len() <= 1;
        let rows: Vec<Div> = prayer
            .variants
            .iter()
            .enumerate()
            .map(|(index, v)| {
                let open = self.open_variant == Some(index);
                let label = format!(
                    "{} / {}",
                    if v.lang.is_empty() { "—" } else { &v.lang },
                    if v.variant.is_empty() {
                        "—"
                    } else {
                        &v.variant
                    }
                );
                let header = div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        div()
                            .id(("variant-head", index))
                            .flex_1()
                            .flex()
                            .items_center()
                            .gap_2()
                            .px_3()
                            .py_2()
                            .cursor_pointer()
                            .child(
                                gpui_kit::component::Icon::new(if open {
                                    IconName::ChevronDown
                                } else {
                                    IconName::ChevronRight
                                })
                                .size_4(),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .child(
                                        div()
                                            .text_sm()
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(label),
                                    )
                                    .when(!v.title.is_empty(), |this| {
                                        this.child(
                                            div()
                                                .text_xs()
                                                .text_color(p.text_secondary)
                                                .child(v.title.clone()),
                                        )
                                    }),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.open_variant = if this.open_variant == Some(index) {
                                    None
                                } else {
                                    Some(index)
                                };
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new(("remove-variant", index))
                            .label("Remove")
                            .icon(IconName::Delete)
                            .ghost()
                            .danger()
                            .xsmall()
                            .disabled(only_one)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.remove_variant(index, window, cx)
                            })),
                    );
                let body = self.variants.get(index).filter(|_| open).map(|row| {
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .px_3()
                        .pb_3()
                        .child(
                            div()
                                .flex()
                                .gap_3()
                                .child(div().flex_1().child(field(
                                    "Language Code",
                                    None,
                                    None,
                                    cx,
                                    input_view(&row.lang),
                                )))
                                .child(div().flex_1().child(field(
                                    "Edition",
                                    None,
                                    None,
                                    cx,
                                    input_view(&row.variant),
                                ))),
                        )
                        .child(field(
                            "Display title",
                            None,
                            None,
                            cx,
                            input_view(&row.title),
                        ))
                        .child(
                            div()
                                .flex()
                                .gap_3()
                                .child(div().flex_1().child(field(
                                    "License",
                                    None,
                                    None,
                                    cx,
                                    input_view(&row.license),
                                )))
                                .child(div().flex_1().child(field(
                                    "Source",
                                    None,
                                    None,
                                    cx,
                                    input_view(&row.source),
                                ))),
                        )
                });
                div()
                    .border_1()
                    .border_color(p.border_strong)
                    .rounded_md()
                    .child(header)
                    .children(body)
            })
            .collect();
        div().flex().flex_col().gap_2().children(rows).child(
            div().mt_1().child(
                Button::new("add-variant")
                    .label("Add language")
                    .icon(IconName::Plus)
                    .small()
                    .on_click(cx.listener(|this, _, window, cx| this.add_variant(window, cx))),
            ),
        )
    }

    fn render_kinds_pane(&mut self, cx: &mut Context<Self>) -> Div {
        if self.state.read(cx).session.library().is_none() {
            return div().child(dimmed("Open a library to edit kind styles.", cx));
        }
        let p = palette(cx).clone();
        let kinds = known_kinds(self.state.read(cx));
        let rows: Vec<Div> = kinds
            .iter()
            .map(|kind| {
                let open = self.open_kind.as_deref() == Some(kind.as_str());
                let preset = is_kind_preset(kind);
                let head_kind = kind.clone();
                let remove_kind = kind.clone();
                let header = div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        div()
                            .id(SharedString::from(format!("kind-head-{kind}")))
                            .flex_1()
                            .flex()
                            .items_center()
                            .gap_2()
                            .px_3()
                            .py_2()
                            .cursor_pointer()
                            .child(
                                gpui_kit::component::Icon::new(if open {
                                    IconName::ChevronDown
                                } else {
                                    IconName::ChevronRight
                                })
                                .size_4(),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(kind_display_label(kind).to_owned()),
                            )
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let next = if this.open_kind.as_deref() == Some(head_kind.as_str())
                                {
                                    None
                                } else {
                                    Some(head_kind.clone())
                                };
                                this.open_kind(next, window, cx);
                            })),
                    )
                    .when(!preset, |this| {
                        this.child(
                            Button::new(SharedString::from(format!("remove-kind-{kind}")))
                                .label("Remove")
                                .icon(IconName::Delete)
                                .ghost()
                                .danger()
                                .xsmall()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.remove_kind(&remove_kind, cx)
                                })),
                        )
                    });
                let body = open.then(|| {
                    let issue = (!preset).then(|| self.rename_issue(kind, cx)).flatten();
                    div()
                        .flex()
                        .flex_col()
                        .gap_3()
                        .px_3()
                        .pb_3()
                        .when(!preset, |this| {
                            this.child(field("Kind", None, issue, cx, input_view(&self.kind_name)))
                        })
                        .when_some(self.kind_editor.clone(), |this, editor| this.child(editor))
                });
                div()
                    .border_1()
                    .border_color(p.border_strong)
                    .rounded_md()
                    .child(header)
                    .children(body)
            })
            .collect();

        let known = known_kinds(self.state.read(cx));
        let new_exists = known.contains(&self.new_kind_text.trim().to_owned());
        let add_row = if self.adding_kind {
            div()
                .flex()
                .items_start()
                .gap_2()
                .child(div().flex_1().child(field(
                    "",
                    None,
                    new_exists.then_some("Already exists"),
                    cx,
                    input_view(&self.new_kind),
                )))
                .child(
                    Button::new("commit-kind")
                        .label("Add")
                        .primary()
                        .disabled(self.new_kind_text.trim().is_empty() || new_exists)
                        .on_click(
                            cx.listener(|this, _, window, cx| this.commit_add_kind(window, cx)),
                        ),
                )
        } else {
            div().child(
                Button::new("add-kind")
                    .label("Add kind")
                    .icon(IconName::Plus)
                    .small()
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.adding_kind = true;
                        this.new_kind
                            .update(cx, |input, cx| input.focus(window, cx));
                        cx.notify();
                    })),
            )
        };
        div()
            .flex()
            .flex_col()
            .gap_2()
            .children(rows)
            .child(add_row)
    }
}

impl Render for PrayerSettingsForm {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = palette(cx).clone();
        if !std::mem::replace(&mut self.focused, true) {
            self.id.update(cx, |input, cx| input.focus(window, cx));
        }
        self.sync_extras(window, cx);
        self.sync_variants(window, cx);
        let Some(prayer) = self.prayer(cx) else {
            return div().child(dimmed("No prayer selected.", cx));
        };
        let pane = match self.pane {
            Pane::Prayer => self.render_prayer_pane(&prayer, cx),
            Pane::Languages => self.render_languages_pane(&prayer, cx),
            Pane::Kinds => self.render_kinds_pane(cx),
        };
        let _ = &self.subs;
        div()
            .flex()
            .gap_4()
            .h(px(520.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .w(px(150.))
                    .flex_shrink_0()
                    .pr_3()
                    .border_r_1()
                    .border_color(p.border)
                    .child(self.nav_item(Pane::Prayer, "Prayer", IconName::FileText, cx))
                    .child(self.nav_item(Pane::Languages, "Languages", IconName::Globe, cx))
                    .child(self.nav_item(Pane::Kinds, "Kinds", IconName::Palette, cx)),
            )
            .child(
                div()
                    .id("settings-pane")
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .overflow_y_scroll()
                    .pr_1()
                    .child(pane),
            )
    }
}
