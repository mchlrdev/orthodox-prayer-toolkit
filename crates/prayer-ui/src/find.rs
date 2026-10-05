//! The Find and replace bar under the workspace header.
//!
//! Searches the visible Variant columns of the selected prayer (150 ms after
//! typing), highlights every match in the editor and scrolls the current one
//! into view. Replace edits the draft (undoable); nothing is written to disk.
//! The bar's state is remembered per prayer for the app session.

use std::collections::HashMap;
use std::time::Duration;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::{Disableable, IconName, Selectable, Sizable};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use prayer_app::edit::{self, FindMatch, FindOptions};
use prayer_app::history::EditKind;

use crate::dialogs;
use crate::editor::{Highlight, RevealScroll};
use crate::state::AppState;
use crate::theme::palette;

const SEARCH_DELAY: Duration = Duration::from_millis(150);

/// What the bar remembers per prayer.
#[derive(Clone, Default)]
struct Saved {
    query: String,
    replacement: String,
    options: FindOptions,
    expanded: bool,
    index: usize,
}

pub struct FindBar {
    state: Entity<AppState>,
    window: AnyWindowHandle,
    query: Entity<InputState>,
    replacement: Entity<InputState>,
    open: bool,
    expanded: bool,
    options: FindOptions,
    matches: Vec<FindMatch>,
    index: usize,
    /// The prayer the bar was last used for.
    path: Option<String>,
    saved: HashMap<String, Saved>,
    search_task: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl FindBar {
    pub fn new(state: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let query = cx.new(|cx| InputState::new(window, cx).placeholder("Find"));
        let replacement = cx.new(|cx| InputState::new(window, cx).placeholder("Replace"));
        let subscriptions =
            vec![
                cx.subscribe_in(&query, window, |this, _, event: &InputEvent, window, cx| {
                    match event {
                        InputEvent::Change => this.schedule_search(cx),
                        InputEvent::PressEnter { shift, .. } => {
                            if *shift {
                                this.previous(window, cx)
                            } else {
                                this.next(window, cx)
                            }
                        }
                        _ => {}
                    }
                }),
                cx.subscribe_in(
                    &replacement,
                    window,
                    |this, _, event: &InputEvent, window, cx| {
                        if let InputEvent::PressEnter { shift, .. } = event {
                            if *shift {
                                this.previous(window, cx)
                            } else {
                                this.next(window, cx)
                            }
                        }
                    },
                ),
                // Edits, undo and column changes move the matches.
                cx.observe_in(&state, window, |this, _, window, cx| {
                    this.follow_selection(window, cx);
                    if this.open {
                        this.search(false, cx);
                    }
                }),
            ];
        Self {
            window: window.window_handle(),
            state,
            query,
            replacement,
            open: false,
            expanded: false,
            options: FindOptions::default(),
            matches: Vec::new(),
            index: 0,
            path: None,
            saved: HashMap::new(),
            search_task: None,
            _subscriptions: subscriptions,
        }
    }

    pub fn is_open(&self) -> bool {
        self.open
    }

    /// Opens (or focuses) the bar; `replace` expands the Replace row;
    /// `prefill` is the editor's selected text.
    pub fn open(
        &mut self,
        replace: bool,
        prefill: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.state.read(cx).session.selected_draft().is_none() {
            return;
        }
        self.follow_selection(window, cx);
        self.open = true;
        if replace {
            self.expanded = true;
        }
        if let Some(text) = prefill.filter(|t| !t.is_empty() && !t.contains('\n')) {
            self.query.update(cx, |q, cx| q.set_value(text, window, cx));
        }
        let target = if replace {
            &self.replacement
        } else {
            &self.query
        };
        target.update(cx, |input, cx| input.focus(window, cx));
        self.search(true, cx);
        cx.notify();
    }

    /// Cmd+F while open closes it.
    pub fn toggle(&mut self, prefill: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        if self.open {
            self.close(window, cx);
        } else {
            self.open(false, prefill, window, cx);
        }
    }

    pub fn close(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        self.open = false;
        self.remember(cx);
        self.set_highlights(Vec::new(), cx);
        cx.notify();
    }

    pub fn next(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        if self.matches.is_empty() {
            return;
        }
        self.index = (self.index + 1) % self.matches.len();
        self.show_current(true, cx);
    }

    pub fn previous(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        if self.matches.is_empty() {
            return;
        }
        self.index = (self.index + self.matches.len() - 1) % self.matches.len();
        self.show_current(true, cx);
    }

    fn remember(&mut self, cx: &App) {
        if let Some(path) = &self.path {
            self.saved.insert(
                path.clone(),
                Saved {
                    query: self.query.read(cx).value().to_string(),
                    replacement: self.replacement.read(cx).value().to_string(),
                    options: self.options,
                    expanded: self.expanded,
                    index: self.index,
                },
            );
        }
    }

    /// Switching prayers swaps in that prayer's remembered bar.
    fn follow_selection(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let current = self
            .state
            .read(cx)
            .session
            .selected_path()
            .map(str::to_owned);
        if current == self.path {
            return;
        }
        self.remember(cx);
        self.path = current.clone();
        let saved = current
            .and_then(|p| self.saved.get(&p).cloned())
            .unwrap_or_default();
        self.query
            .update(cx, |q, cx| q.set_value(saved.query.clone(), window, cx));
        self.replacement.update(cx, |q, cx| {
            q.set_value(saved.replacement.clone(), window, cx)
        });
        self.options = saved.options;
        self.expanded = saved.expanded;
        self.index = saved.index;
        self.open = false;
        self.matches.clear();
    }

    fn schedule_search(&mut self, cx: &mut Context<Self>) {
        self.search_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(SEARCH_DELAY).await;
            this.update(cx, |this, cx| {
                this.index = 0;
                this.search(true, cx)
            })
            .ok();
        }));
    }

    /// Recomputes the matches; `reveal` scrolls to the current one.
    fn search(&mut self, reveal: bool, cx: &mut Context<Self>) {
        let query = self.query.read(cx).value().to_string();
        let state = self.state.read(cx);
        self.matches = match state.session.selected_draft() {
            Some(draft) if !query.is_empty() => {
                edit::find_matches(draft.prayer(), state.columns(), &query, self.options)
            }
            _ => Vec::new(),
        };
        if self.index >= self.matches.len() {
            self.index = 0;
        }
        self.show_current(reveal, cx);
    }

    fn show_current(&mut self, reveal: bool, cx: &mut Context<Self>) {
        let highlights = self
            .matches
            .iter()
            .enumerate()
            .map(|(i, m)| Highlight {
                block_id: m.block_id.clone(),
                variant: m.variant.clone(),
                range: m.range.clone(),
                current: i == self.index,
            })
            .collect();
        self.set_highlights(highlights, cx);
        if reveal && let Some(current) = self.matches.get(self.index).cloned() {
            let editor = self.state.update(cx, |s, cx| s.selected_editor(cx));
            if let Some(editor) = editor {
                let window = self.window;
                cx.defer(move |cx| {
                    window
                        .update(cx, |_, window, cx| {
                            editor.update(cx, |e, cx| {
                                e.reveal_block(
                                    &current.block_id,
                                    RevealScroll::Nearest,
                                    None,
                                    false,
                                    window,
                                    cx,
                                )
                            })
                        })
                        .ok();
                });
            }
        }
        cx.notify();
    }

    fn set_highlights(&mut self, highlights: Vec<Highlight>, cx: &mut Context<Self>) {
        let editor = self.state.update(cx, |s, cx| s.selected_editor(cx));
        if let Some(editor) = editor {
            editor.update(cx, |e, cx| e.set_highlights(highlights, cx));
        }
    }

    fn toggle_option(&mut self, whole_word: bool, cx: &mut Context<Self>) {
        if whole_word {
            self.options.whole_word = !self.options.whole_word;
        } else {
            self.options.match_case = !self.options.match_case;
        }
        self.search(true, cx);
    }

    fn replace_current(&mut self, cx: &mut Context<Self>) {
        let Some(found) = self.matches.get(self.index).cloned() else {
            return;
        };
        let text = self.replacement.read(cx).value().to_string();
        self.state.update(cx, |s, cx| {
            s.session
                .edit_selected(EditKind::Other, |p| edit::replace_match(p, &found, &text));
            s.notify_all(cx);
        });
        self.search(true, cx);
    }

    fn replace_all(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.matches.is_empty() {
            return;
        }
        let (count, blocks) = edit::summarize_replace_all(&self.matches);
        let message = format!(
            "Replace {count} occurrence{} in {blocks} block{}?",
            if count == 1 { "" } else { "s" },
            if blocks == 1 { "" } else { "s" }
        );
        let this = cx.entity();
        dialogs::confirm::open(
            "Replace all?",
            message,
            "Replace all",
            false,
            move |_, cx| {
                this.update(cx, |this, cx| {
                    let matches = this.matches.clone();
                    let text = this.replacement.read(cx).value().to_string();
                    this.state.update(cx, |s, cx| {
                        s.session.edit_selected(EditKind::Other, |p| {
                            edit::replace_all(p, &matches, &text)
                        });
                        s.notify_all(cx);
                    });
                    this.search(false, cx);
                })
            },
            window,
            cx,
        );
    }
}

impl Render for FindBar {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.open {
            return div().into_any_element();
        }
        let p = palette(cx).clone();
        let total = self.matches.len();
        let counter = if total == 0 {
            "0 / 0".to_string()
        } else {
            format!("{} / {}", self.index + 1, total)
        };
        let none = total == 0;
        let replace_tip = if self.expanded {
            "Hide replace"
        } else if cfg!(target_os = "macos") {
            "Replace (⌥⌘F)"
        } else {
            "Replace (Ctrl+Alt+F)"
        };

        let find_row = div()
            .flex()
            .items_center()
            .gap_1()
            .child(
                div().w(px(280.)).child(
                    Input::new(&self.query)
                        .small()
                        .prefix(div().text_color(p.text_secondary).child(IconName::Search)),
                ),
            )
            .child(
                Button::new("match-case")
                    .ghost()
                    .xsmall()
                    .label("Aa")
                    .tooltip("Match case")
                    .selected(self.options.match_case)
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_option(false, cx))),
            )
            .child(
                Button::new("whole-word")
                    .ghost()
                    .xsmall()
                    .label("W")
                    .tooltip("Whole word")
                    .selected(self.options.whole_word)
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_option(true, cx))),
            )
            .child(
                div()
                    .min_w(px(52.))
                    .text_xs()
                    .text_center()
                    .text_color(p.text_secondary)
                    .when(none, |d| d.opacity(0.6))
                    .child(counter),
            )
            .child(
                Button::new("previous")
                    .ghost()
                    .xsmall()
                    .icon(IconName::ChevronUp)
                    .tooltip("Previous (Shift+Enter)")
                    .disabled(none)
                    .on_click(cx.listener(|this, _, window, cx| this.previous(window, cx))),
            )
            .child(
                Button::new("next")
                    .ghost()
                    .xsmall()
                    .icon(IconName::ChevronDown)
                    .tooltip("Next (Enter)")
                    .disabled(none)
                    .on_click(cx.listener(|this, _, window, cx| this.next(window, cx))),
            )
            .child(div().flex_1())
            .child(
                Button::new("toggle-replace")
                    .ghost()
                    .xsmall()
                    .icon(IconName::Replace)
                    .tooltip(replace_tip)
                    .selected(self.expanded)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.expanded = !this.expanded;
                        cx.notify();
                    })),
            )
            .child(
                Button::new("close-find")
                    .ghost()
                    .xsmall()
                    .icon(IconName::Close)
                    .tooltip("Close (Esc)")
                    .on_click(cx.listener(|this, _, window, cx| this.close(window, cx))),
            );

        let replace_row = self.expanded.then(|| {
            div()
                .flex()
                .items_center()
                .gap_1()
                .child(
                    div()
                        .w(px(280.))
                        .child(Input::new(&self.replacement).small()),
                )
                .child(
                    Button::new("replace")
                        .small()
                        .label("Replace")
                        .disabled(none)
                        .on_click(cx.listener(|this, _, _, cx| this.replace_current(cx))),
                )
                .child(
                    Button::new("replace-all")
                        .small()
                        .label("Replace all")
                        .disabled(none)
                        .on_click(cx.listener(|this, _, window, cx| this.replace_all(window, cx))),
                )
        });

        div()
            .flex()
            .flex_col()
            .gap_1()
            .px_3()
            .py_2()
            .border_b_1()
            .border_color(p.border)
            .bg(p.surface)
            .child(find_row)
            .children(replace_row)
            .into_any_element()
    }
}
