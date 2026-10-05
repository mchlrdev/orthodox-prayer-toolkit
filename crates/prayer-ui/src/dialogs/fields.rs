//! Form building blocks shared by the settings dialogs: labelled fields,
//! text inputs that report changes, segmented controls and the Kind style
//! fields (Electron `KindStyleFields.tsx`).

use std::rc::Rc;

use gpui_kit::component::Selectable;
use gpui_kit::component::Sizable;
use gpui_kit::component::button::{Button, ButtonGroup};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::input::{Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use prayer_core::KindStyle;
use prayer_core::html_tags::HTML_TAG_ALLOWLIST;
use prayer_core::style_color::{StyleColor, normalize_style_color};

use crate::theme::palette;

/// A caption, an optional hint and the control.
pub fn field(
    label: &str,
    hint: Option<&str>,
    error: Option<&str>,
    cx: &App,
    control: impl IntoElement,
) -> Div {
    let p = palette(cx);
    div()
        .flex()
        .flex_col()
        .gap_1()
        .w_full()
        .when(!label.is_empty(), |this| {
            this.child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .child(label.to_owned()),
            )
        })
        .when_some(hint, |this, hint| {
            this.child(
                div()
                    .text_xs()
                    .text_color(p.text_secondary)
                    .child(hint.to_owned()),
            )
        })
        .child(control)
        .when_some(error, |this, error| {
            this.child(div().text_xs().text_color(p.accent).child(error.to_owned()))
        })
}

/// A caption without a control (section title).
pub fn section_title(text: &str) -> Div {
    div()
        .text_sm()
        .font_weight(FontWeight::SEMIBOLD)
        .child(text.to_owned())
}

/// Dimmed helper text.
pub fn dimmed(text: &str, cx: &App) -> Div {
    div()
        .text_sm()
        .text_color(palette(cx).text_secondary)
        .child(text.to_owned())
}

/// What happened to an input; `Change` carries the new text.
pub enum Edited {
    Change(String),
    Enter,
    Blur,
}

fn forward<T: 'static>(
    event: &InputEvent,
    value: String,
    this: &mut T,
    window: &mut Window,
    cx: &mut Context<T>,
    on_edit: &impl Fn(&mut T, Edited, &mut Window, &mut Context<T>),
) {
    match event {
        InputEvent::Change => on_edit(this, Edited::Change(value), window, cx),
        InputEvent::PressEnter { .. } => on_edit(this, Edited::Enter, window, cx),
        InputEvent::Blur => on_edit(this, Edited::Blur, window, cx),
        InputEvent::Focus => {}
    }
}

/// A single-line input holding `value`; `on_edit` hears changes, Enter and
/// blur. The subscription is pushed to `subs`.
pub fn text_input<T: 'static>(
    value: &str,
    placeholder: &str,
    subs: &mut Vec<Subscription>,
    window: &mut Window,
    cx: &mut Context<T>,
    on_edit: impl Fn(&mut T, Edited, &mut Window, &mut Context<T>) + 'static,
) -> Entity<InputState> {
    let value = value.to_owned();
    let placeholder = placeholder.to_owned();
    let input = cx.new(|cx| {
        InputState::new(window, cx)
            .placeholder(placeholder)
            .default_value(value)
    });
    subs.push(cx.subscribe_in(
        &input,
        window,
        move |this, input, event: &InputEvent, window, cx| {
            let value = input.read(cx).value().to_string();
            forward(event, value, this, window, cx, &on_edit);
        },
    ));
    input
}

/// A multi-line input growing from 2 to 5 rows.
pub fn text_area<T: 'static>(
    value: &str,
    subs: &mut Vec<Subscription>,
    window: &mut Window,
    cx: &mut Context<T>,
    on_edit: impl Fn(&mut T, Edited, &mut Window, &mut Context<T>) + 'static,
) -> Entity<TextareaState> {
    let value = value.to_owned();
    let input = cx.new(|cx| {
        TextareaState::new(window, cx)
            .auto_grow(2, 5)
            .default_value(value)
    });
    subs.push(cx.subscribe_in(
        &input,
        window,
        move |this, input, event: &InputEvent, window, cx| {
            let value = input.read(cx).value().to_string();
            forward(event, value, this, window, cx, &on_edit);
        },
    ));
    input
}

pub fn input_view(state: &Entity<InputState>) -> Input {
    Input::new(state)
}

pub fn area_view(state: &Entity<TextareaState>) -> Textarea {
    Textarea::new(state)
}

/// Rewrites an input's text (no change event is emitted).
pub fn set_text(input: &Entity<InputState>, text: &str, window: &mut Window, cx: &mut App) {
    let text = text.to_owned();
    input.update(cx, |input, cx| input.set_value(text, window, cx));
}

/// A row of buttons of which one is selected.
pub fn segmented(
    id: &'static str,
    labels: &[&str],
    selected: usize,
    on_pick: impl Fn(usize, &mut Window, &mut App) + 'static,
) -> ButtonGroup {
    let mut group = ButtonGroup::new(id).outline().compact();
    for (ix, label) in labels.iter().enumerate() {
        group = group.child(
            Button::new((id, ix))
                .label((*label).to_owned())
                .selected(ix == selected),
        );
    }
    group.on_click(move |picked: &Vec<usize>, window, cx| {
        if let Some(&ix) = picked.iter().find(|&&ix| ix != selected).or(picked.first()) {
            on_pick(ix, window, cx);
        }
    })
}

// ---------------------------------------------------------------------------
// Kind style fields
// ---------------------------------------------------------------------------

/// T-shirt sizes and the CSS font sizes they store.
pub const FONT_SIZES: [(&str, &str); 4] = [
    ("S", "0.875rem"),
    ("M", "1rem"),
    ("L", "1.125rem"),
    ("XL", "1.35rem"),
];

fn parse_rem(value: &str) -> Option<f32> {
    let value = value.trim().to_ascii_lowercase();
    value.strip_suffix("rem")?.trim().parse().ok()
}

/// Index into [`FONT_SIZES`] of the size nearest to an arbitrary CSS size
/// (M for anything that is not in rem).
pub fn nearest_font_size(value: &str) -> usize {
    if let Some(ix) = FONT_SIZES.iter().position(|(_, v)| *v == value) {
        return ix;
    }
    let Some(rem) = parse_rem(value) else {
        return 1;
    };
    let mut best = 1;
    let mut best_dist = f32::INFINITY;
    for (ix, (_, v)) in FONT_SIZES.iter().enumerate() {
        let dist = (parse_rem(v).unwrap_or(1.0) - rem).abs();
        if dist < best_dist {
            best = ix;
            best_dist = dist;
        }
    }
    best
}

pub fn is_bold_weight(weight: &str) -> bool {
    match weight.parse::<f32>() {
        Ok(n) => n >= 600.0,
        Err(_) => weight == "bold" || weight == "bolder",
    }
}

fn align_index(style: &KindStyle) -> usize {
    match style.text_align.as_deref() {
        Some("center") => 1,
        Some("justify") => 2,
        _ => 0,
    }
}

type StyleChanged = Rc<dyn Fn(&KindStyle, &mut Window, &mut App)>;

/// The style fields of one Kind: size, colour, align, bold, italic, accent
/// initial, indicate and HTML tag. Every change goes to `on_change` at once.
pub struct KindStyleEditor {
    style: KindStyle,
    html: Entity<SelectState<Vec<SharedString>>>,
    on_change: StyleChanged,
    _sub: Subscription,
}

impl KindStyleEditor {
    pub fn new(
        style: KindStyle,
        on_change: impl Fn(&KindStyle, &mut Window, &mut App) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let tags: Vec<SharedString> = HTML_TAG_ALLOWLIST
            .iter()
            .map(|t| SharedString::from(*t))
            .collect();
        let selected = style
            .html_tag
            .as_deref()
            .and_then(|tag| HTML_TAG_ALLOWLIST.iter().position(|t| *t == tag))
            .map(|row| gpui_kit::component::IndexPath::default().row(row));
        let html = cx.new(|cx| SelectState::new(tags, selected, window, cx));
        let sub = cx.subscribe_in(
            &html,
            window,
            |this, _, event: &SelectEvent<Vec<SharedString>>, window, cx| {
                let SelectEvent::Confirm(value) = event;
                let tag = value.as_ref().map(|v| v.to_string());
                this.patch(window, cx, |s| s.html_tag = tag);
            },
        );
        Self {
            style,
            html,
            on_change: Rc::new(on_change),
            _sub: sub,
        }
    }

    fn patch(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
        f: impl FnOnce(&mut KindStyle),
    ) {
        f(&mut self.style);
        if self.style.html_tag.as_deref() == Some("") {
            self.style.html_tag = None;
        }
        (self.on_change)(&self.style, window, cx);
        cx.notify();
    }
}

impl Render for KindStyleEditor {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = palette(cx).clone();
        let style = self.style.clone();
        let size_ix = nearest_font_size(&style.font_size);
        let color_ix = match normalize_style_color(&style.color) {
            Some(StyleColor::Accent) => 1,
            _ => 0,
        };
        let me = cx.entity();

        let size = {
            let me = me.clone();
            segmented(
                "kind-size",
                &FONT_SIZES.map(|(label, _)| label),
                size_ix,
                move |ix, window, cx| {
                    me.update(cx, |this, cx| {
                        this.patch(window, cx, |s| s.font_size = FONT_SIZES[ix].1.to_owned())
                    })
                },
            )
        };
        let color = {
            let me = me.clone();
            segmented(
                "kind-color",
                &["Base", "Accent"],
                color_ix,
                move |ix, window, cx| {
                    me.update(cx, |this, cx| {
                        this.patch(window, cx, |s| {
                            s.color = if ix == 1 { "accent" } else { "base" }.to_owned()
                        })
                    })
                },
            )
        };
        let align = {
            let me = me.clone();
            segmented(
                "kind-align",
                &["Left", "Center", "Justified"],
                align_index(&style),
                move |ix, window, cx| {
                    me.update(cx, |this, cx| {
                        this.patch(window, cx, |s| {
                            s.text_align = Some(["left", "center", "justify"][ix].to_owned())
                        })
                    })
                },
            )
        };
        let check = |id: &'static str, label: &'static str, on: bool| {
            Checkbox::new(id).label(label).checked(on)
        };
        let bold = check("kind-bold", "Bold", is_bold_weight(&style.font_weight)).on_click(
            cx.listener(|this, on: &bool, window, cx| {
                let on = *on;
                this.patch(window, cx, |s| {
                    s.font_weight = if on { "700" } else { "400" }.to_owned()
                });
            }),
        );
        let italic = check("kind-italic", "Italic", style.font_style == "italic").on_click(
            cx.listener(|this, on: &bool, window, cx| {
                let on = *on;
                this.patch(window, cx, |s| {
                    s.font_style = if on { "italic" } else { "normal" }.to_owned()
                });
            }),
        );
        let initial = check(
            "kind-initial",
            "Accent initial",
            style.initial_cap.as_deref() == Some("true"),
        )
        .on_click(cx.listener(|this, on: &bool, window, cx| {
            let on = *on;
            this.patch(window, cx, |s| {
                s.initial_cap = Some(if on { "true" } else { "false" }.to_owned())
            });
        }));
        let indicate = check(
            "kind-indicate",
            "Indicate",
            style.indicate.as_deref() == Some("true"),
        )
        .on_click(cx.listener(|this, on: &bool, window, cx| {
            let on = *on;
            this.patch(window, cx, |s| {
                s.indicate = Some(if on { "true" } else { "false" }.to_owned())
            });
        }));

        let swatch = |color: Hsla| div().size(px(10.)).rounded_full().bg(color);
        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .flex()
                    .gap_3()
                    .child(div().flex_1().child(field("Size", None, None, cx, size)))
                    .child(
                        div().flex_1().child(field(
                            "Color",
                            None,
                            None,
                            cx,
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(swatch(if color_ix == 1 { p.accent } else { p.base }))
                                .child(color),
                        )),
                    ),
            )
            .child(field("Align", None, None, cx, align))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_x_4()
                    .gap_y_2()
                    .child(bold)
                    .child(italic)
                    .child(initial)
                    .child(indicate),
            )
            .child(field(
                "HTML tag for export",
                None,
                None,
                cx,
                Select::new(&self.html)
                    .placeholder("Default (div)")
                    .cleanable(true)
                    .small(),
            ))
    }
}

#[cfg(test)]
mod tests {
    use super::{is_bold_weight, nearest_font_size};

    #[test]
    fn sizes_snap_to_the_nearest_option() {
        assert_eq!(nearest_font_size("1rem"), 1);
        assert_eq!(nearest_font_size("0.9rem"), 0);
        assert_eq!(nearest_font_size("1.3rem"), 3);
        assert_eq!(nearest_font_size("16px"), 1);
        assert_eq!(nearest_font_size("2rem"), 3);
    }

    #[test]
    fn bold_weights() {
        assert!(is_bold_weight("700"));
        assert!(is_bold_weight("bold"));
        assert!(!is_bold_weight("400"));
        assert!(!is_bold_weight("normal"));
    }
}
