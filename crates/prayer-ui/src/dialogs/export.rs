//! The Export dialog (flat JSON, HTML, Layout RTF/DOCX). Logic (defaults,
//! options, file names, the export itself) lives in `prayer_app::export` and
//! `Session::export_variant`; this file is the form.

use std::path::PathBuf;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::input::{Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::component::{Disableable, IndexPath, Sizable, WindowExt};
use gpui_kit::*;
use prayer_app::export::{ExportDefaults, ExportFormat, LayoutFormat, variant_label};
use prayer_core::html_tags::{HTML_TAG_ALLOWLIST, resolve_html_tag};
use prayer_core::kind_display_label;
use prayer_core::parse_html_attributes::parse_html_attributes;
use prayer_core::style_prefix::is_valid_style_prefix_stem;

use super::new_prayer::field;
use crate::state::AppState;
use crate::theme::palette;

type Choice = SelectState<Vec<SharedString>>;

pub fn open(state: Entity<AppState>, path: String, window: &mut Window, cx: &mut App) {
    let defaults = state.update(cx, |s, cx| {
        let result = s
            .session
            .export_defaults(&path)
            .map(prayer_app::session::Done::new);
        s.report(result, cx)
    });
    let Some(defaults) = defaults else {
        return;
    };
    let view = cx.new(|cx| ExportView::new(state, path, defaults, window, cx));
    window.open_dialog(cx, move |dialog, _, _| {
        dialog.title("Export").w(px(480.)).child(view.clone())
    });
}

/// The wrapper element tags: `article` plus the Kind tags.
fn wrapper_tags() -> Vec<SharedString> {
    std::iter::once("article")
        .chain(HTML_TAG_ALLOWLIST)
        .map(SharedString::from)
        .collect()
}

fn tag_items() -> Vec<SharedString> {
    HTML_TAG_ALLOWLIST
        .iter()
        .map(|t| SharedString::from(*t))
        .collect()
}

struct ExportView {
    state: Entity<AppState>,
    path: String,
    defaults: ExportDefaults,
    language: Entity<Choice>,
    format: Entity<Choice>,
    /// One tag select per Kind, in the order of `defaults.kinds`.
    tags: Vec<(String, Entity<Choice>)>,
    wrapper_tag: Entity<Choice>,
    wrapper_attributes: Entity<TextareaState>,
    prefix: Entity<InputState>,
    exporting: bool,
    _subscriptions: Vec<Subscription>,
}

impl ExportView {
    fn new(
        state: Entity<AppState>,
        path: String,
        defaults: ExportDefaults,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut subscriptions = Vec::new();

        let labels: Vec<SharedString> = defaults
            .languages
            .iter()
            .map(|v| SharedString::from(variant_label(v)))
            .collect();
        let selected = defaults
            .variant
            .as_ref()
            .and_then(|v| defaults.languages.iter().position(|l| l == v));
        let language = cx.new(|cx| {
            SelectState::new(
                labels,
                selected.map(|ix| IndexPath::default().row(ix)),
                window,
                cx,
            )
            .searchable(true)
        });
        subscriptions.push(cx.subscribe_in(
            &language,
            window,
            |this, _, event: &SelectEvent<Vec<SharedString>>, _, cx| {
                let SelectEvent::Confirm(Some(label)) = event else {
                    return;
                };
                this.defaults.variant = this
                    .defaults
                    .languages
                    .iter()
                    .find(|v| variant_label(v) == label.as_ref())
                    .cloned();
                cx.notify();
            },
        ));

        let formats: Vec<SharedString> = ExportFormat::ALL
            .iter()
            .map(|f| SharedString::from(f.label()))
            .collect();
        let format =
            cx.new(|cx| SelectState::new(formats, Some(IndexPath::default().row(0)), window, cx));
        subscriptions.push(cx.subscribe_in(
            &format,
            window,
            |this, _, event: &SelectEvent<Vec<SharedString>>, _, cx| {
                let SelectEvent::Confirm(Some(label)) = event else {
                    return;
                };
                if let Some(f) = ExportFormat::ALL
                    .iter()
                    .find(|f| f.label() == label.as_ref())
                {
                    this.defaults.format = *f;
                    cx.notify();
                }
            },
        ));

        let tags = defaults
            .kinds
            .iter()
            .map(|kind| {
                let current = defaults
                    .html
                    .tag_map
                    .get(kind)
                    .map(String::as_str)
                    .unwrap_or("div");
                let items = tag_items();
                let ix = items.iter().position(|t| t.as_ref() == current);
                let select = cx.new(|cx| {
                    SelectState::new(items, ix.map(|ix| IndexPath::default().row(ix)), window, cx)
                });
                let kind_key = kind.clone();
                subscriptions.push(cx.subscribe_in(
                    &select,
                    window,
                    move |this, _, event: &SelectEvent<Vec<SharedString>>, _, cx| {
                        if let SelectEvent::Confirm(Some(tag)) = event {
                            this.defaults
                                .html
                                .tag_map
                                .insert(kind_key.clone(), tag.to_string());
                            cx.notify();
                        }
                    },
                ));
                (kind.clone(), select)
            })
            .collect();

        let wrapper_items = wrapper_tags();
        let wrapper_ix = wrapper_items
            .iter()
            .position(|t| t.as_ref() == defaults.html.wrapper_tag);
        let wrapper_tag = cx.new(|cx| {
            SelectState::new(
                wrapper_items,
                wrapper_ix.map(|ix| IndexPath::default().row(ix)),
                window,
                cx,
            )
        });
        subscriptions.push(cx.subscribe_in(
            &wrapper_tag,
            window,
            |this, _, event: &SelectEvent<Vec<SharedString>>, _, cx| {
                if let SelectEvent::Confirm(Some(tag)) = event {
                    this.defaults.html.wrapper_tag = tag.to_string();
                    cx.notify();
                }
            },
        ));

        let attrs = defaults.html.wrapper_attributes.clone();
        let wrapper_attributes = cx.new(|cx| {
            let mut state = TextareaState::new(window, cx).placeholder("class=\"prayer\"");
            state.set_value(attrs, window, cx);
            state
        });
        let prefix_value = defaults.layout.prefix_stem.clone();
        let prefix = cx.new(|cx| InputState::new(window, cx).default_value(prefix_value));
        subscriptions.push(cx.subscribe_in(
            &prefix,
            window,
            |this, input, event: &InputEvent, _, cx| {
                if matches!(event, InputEvent::Change) {
                    this.defaults.layout.prefix_stem = input.read(cx).value().to_string();
                    cx.notify();
                }
            },
        ));

        Self {
            state,
            path,
            defaults,
            language,
            format,
            tags,
            wrapper_tag,
            wrapper_attributes,
            prefix,
            exporting: false,
            _subscriptions: subscriptions,
        }
    }

    /// Pulls the text of the wrapper attributes (a Textarea has no change
    /// subscription here) into the options.
    fn sync(&mut self, cx: &App) {
        self.defaults.html.wrapper_attributes =
            self.wrapper_attributes.read(cx).value().to_string();
    }

    fn reset_tags(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let styles = self.state.read(cx).styles().clone();
        let tag_map = ExportDefaults::default_html(&styles).tag_map;
        for (kind, select) in &self.tags {
            let tag = SharedString::from(resolve_html_tag(tag_map.get(kind).map(String::as_str)));
            self.defaults
                .html
                .tag_map
                .insert(kind.clone(), tag.to_string());
            select.update(cx, |s, cx| s.set_selected_value(&tag, window, cx));
        }
        cx.notify();
    }

    fn reset_prefix(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.defaults.reset_prefix_stem();
        let stem = self.defaults.layout.prefix_stem.clone();
        self.prefix
            .update(cx, |s, cx| s.set_value(stem, window, cx));
        cx.notify();
    }

    fn export(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.sync(cx);
        let Some(request) = self.defaults.request() else {
            return;
        };
        if request.check().is_err() || self.exporting {
            return;
        }
        let prayer_id = self
            .state
            .read(cx)
            .session
            .draft(&self.path)
            .map(|d| d.prayer().id.clone())
            .unwrap_or_else(|| {
                self.path
                    .trim_end_matches(".json")
                    .rsplit('/')
                    .next()
                    .unwrap_or_default()
                    .to_owned()
            });
        let file_name = request.file_name(&prayer_id);
        let dir = std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let target = cx.prompt_for_new_path(&dir, Some(&file_name));
        self.exporting = true;
        cx.notify();
        cx.spawn_in(window, async move |this, cx| {
            let target = match target.await {
                Ok(Ok(target)) => target,
                _ => None,
            };
            this.update_in(cx, |this, window, cx| {
                this.exporting = false;
                // Cancelling the save dialog closes the modal, a failed
                // export keeps it open (Electron).
                let keep_open = match target {
                    Some(target) => this.state.update(cx, |s, cx| {
                        let result = s.session.export_variant(&this.path, &request, &target);
                        s.report(result, cx).is_none()
                    }),
                    None => false,
                };
                if !keep_open {
                    window.close_dialog(cx);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

impl Render for ExportView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync(cx);
        let p = palette(cx).clone();
        let sec = p.text_secondary;
        let d = &self.defaults;
        let format = d.format;
        let wrapper_enabled = d.html.wrapper_enabled;
        let attrs_error = if format == ExportFormat::Html && wrapper_enabled {
            parse_html_attributes(&d.html.wrapper_attributes)
                .err()
                .map(|errors| {
                    errors
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join(" · ")
                })
        } else {
            None
        };
        let stem_valid = is_valid_style_prefix_stem(&d.layout.prefix_stem);
        let can_export = d.can_export();
        let no_languages = d.languages.is_empty();
        let layout_format = d.layout.format;
        let include = d.include_blocks_without_translation;

        let mut body = div().flex().flex_col().gap_3();
        body = body
            .child(field(
                "Language",
                None,
                sec,
                Select::new(&self.language)
                    .placeholder(if no_languages {
                        "No languages on this prayer"
                    } else {
                        "Select language"
                    })
                    .search_placeholder("Search")
                    .disabled(no_languages),
            ))
            .child(field("Format", None, sec, Select::new(&self.format)));

        if format == ExportFormat::Html {
            let kind_rows = self.tags.iter().map(|(kind, select)| {
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_3()
                    .child(div().text_sm().child(kind_display_label(kind).to_owned()))
                    .child(div().w(px(140.)).child(Select::new(select).small()))
            });
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child("Kind → HTML tag"),
                            )
                            .child(
                                Button::new("reset-tags")
                                    .ghost()
                                    .small()
                                    .label("Reset tags")
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.reset_tags(window, cx)
                                    })),
                            ),
                    )
                    .children(kind_rows)
                    .child(
                        Checkbox::new("wrapper")
                            .label("Wrap in root element")
                            .checked(wrapper_enabled)
                            .on_click(cx.listener(|this, checked: &bool, _, cx| {
                                this.defaults.html.wrapper_enabled = *checked;
                                cx.notify();
                            })),
                    )
                    .children(wrapper_enabled.then(|| {
                        div()
                            .flex()
                            .flex_col()
                            .gap_3()
                            .child(field(
                                "Wrapper tag",
                                None,
                                sec,
                                Select::new(&self.wrapper_tag),
                            ))
                            .child(
                                field(
                                    "Wrapper attributes",
                                    None,
                                    sec,
                                    Textarea::new(&self.wrapper_attributes).h(px(56.)),
                                )
                                .children(
                                    attrs_error
                                        .clone()
                                        .map(|e| div().text_xs().text_color(p.accent).child(e)),
                                ),
                            )
                    })),
            );
        }

        if format == ExportFormat::Layout {
            let type_button = |id: &'static str, label: &'static str, value: LayoutFormat| {
                let button = Button::new(id).label(label).flex_1().on_click(cx.listener(
                    move |this, _, _, cx| {
                        this.defaults.layout.format = value;
                        cx.notify();
                    },
                ));
                if layout_format == value {
                    button.primary()
                } else {
                    button
                }
            };
            body = body
                .child(field(
                    "File type",
                    None,
                    sec,
                    div()
                        .flex()
                        .gap_1()
                        .child(type_button("docx", "DOCX", LayoutFormat::Docx))
                        .child(type_button("rtf", "RTF", LayoutFormat::Rtf)),
                ))
                .child(
                    div()
                        .flex()
                        .items_end()
                        .gap_2()
                        .child(
                            field(
                                "Style prefix",
                                None,
                                sec,
                                Input::new(&self.prefix).suffix(
                                    div().text_sm().text_color(sec).pr_1().child("_"),
                                ),
                            )
                            .children((!stem_valid).then(|| {
                                div().text_xs().text_color(p.accent).child(
                                    "Use letters/digits only, starting with a letter — or leave empty",
                                )
                            })),
                        )
                        .child(
                            Button::new("reset-prefix")
                                .ghost()
                                .label("Reset")
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.reset_prefix(window, cx)
                                })),
                        ),
                );
        }

        body = body.child(
            Checkbox::new("include")
                .label("Include blocks without translation")
                .checked(include)
                .on_click(cx.listener(|this, checked: &bool, _, cx| {
                    this.defaults.include_blocks_without_translation = *checked;
                    cx.notify();
                })),
        );
        if no_languages {
            body = body.child(
                div()
                    .text_xs()
                    .text_color(sec)
                    .child("Add a language in prayer settings before exporting."),
            );
        }

        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div()
                    .id("export-body")
                    .max_h(px(520.))
                    .overflow_y_scroll()
                    .child(body),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap_2()
                    .child(
                        Button::new("cancel")
                            .label("Cancel")
                            .disabled(self.exporting)
                            .on_click(|_, window, cx| window.close_dialog(cx)),
                    )
                    .child(
                        Button::new("export")
                            .label("Export")
                            .primary()
                            .loading(self.exporting)
                            .disabled(!can_export)
                            .on_click(cx.listener(|this, _, window, cx| this.export(window, cx))),
                    ),
            )
    }
}
