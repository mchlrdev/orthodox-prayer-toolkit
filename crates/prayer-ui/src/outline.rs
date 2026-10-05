//! The Content outline (right sidebar): headings and subheadings of the
//! primary Variant, with scrollspy.

use std::collections::{HashMap, HashSet};

use gpui_kit::assets::IconName as Lucide;
use gpui_kit::component::IconName;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{Icon, Sizable};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use prayer_app::edit::{self, OutlineEntry, OutlineKind};

use crate::editor::{EditorEvent, PrayerEditor, RevealScroll};
use crate::state::AppState;
use crate::theme::{Palette, palette};

/// The user jumped to a heading (narrow windows close the outline).
pub struct Jumped;

pub struct Outline {
    state: Entity<AppState>,
    editor: Option<Entity<PrayerEditor>>,
    editor_subscription: Option<Subscription>,
    /// Expanded heading groups (by Block id), kept while they survive.
    expanded: HashSet<String>,
    /// The scrollspy result of the last render.
    active: Option<String>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<Jumped> for Outline {}

impl Outline {
    pub fn new(state: Entity<AppState>, cx: &mut Context<Self>) -> Self {
        let subscription = cx.observe(&state, |this, _, cx| this.follow_editor(cx));
        Self {
            state,
            editor: None,
            editor_subscription: None,
            expanded: HashSet::new(),
            active: None,
            _subscriptions: vec![subscription],
        }
    }

    /// Tracks the selected prayer's editor so scrolling updates the
    /// highlighted heading.
    fn follow_editor(&mut self, cx: &mut Context<Self>) {
        let editor = self.state.update(cx, |s, cx| s.selected_editor(cx));
        if editor.as_ref().map(Entity::entity_id) == self.editor.as_ref().map(Entity::entity_id) {
            return;
        }
        self.editor_subscription = editor.as_ref().map(|editor| {
            cx.subscribe(editor, |_, _, event: &EditorEvent, cx| {
                if matches!(event, EditorEvent::Scrolled) {
                    cx.notify();
                }
            })
        });
        self.editor = editor;
        cx.notify();
    }

    fn jump(&mut self, block_id: &str, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(editor) = &self.editor {
            editor.update(cx, |e, cx| {
                e.reveal_block(block_id, RevealScroll::Start, None, true, window, cx)
            });
        }
        cx.emit(Jumped);
    }

    fn toggle(&mut self, block_id: &str, cx: &mut Context<Self>) {
        if !self.expanded.remove(block_id) {
            self.expanded.insert(block_id.to_owned());
        }
        cx.notify();
    }

    /// The outline of the selected prayer in its primary Variant.
    fn entries(&self, cx: &App) -> Vec<OutlineEntry> {
        let state = self.state.read(cx);
        let Some(draft) = state.session.selected_draft() else {
            return Vec::new();
        };
        let Some(primary) = state.columns().first() else {
            return Vec::new();
        };
        edit::build_outline(draft.prayer(), primary.key())
    }

    /// Scrollspy: the last heading (or orphan subheading) at or above the
    /// Block at the top of the viewport.
    fn compute_active(&self, entries: &[OutlineEntry], cx: &App) -> Option<String> {
        let editor = self.editor.as_ref()?;
        let top = editor.read(cx).top_block()?;
        let state = self.state.read(cx);
        let prayer = state.session.selected_draft()?.prayer();
        let index: HashMap<&str, usize> = prayer
            .structure
            .iter()
            .enumerate()
            .map(|(i, b)| (b.id.as_str(), i))
            .collect();
        let top_ix = *index.get(top.as_ref())?;
        let anchors: Vec<edit::OutlineAnchor> = edit::flatten_outline(entries)
            .into_iter()
            .filter_map(|(block_id, kind, orphan)| {
                let top = *index.get(block_id.as_str())? as f32;
                Some(edit::OutlineAnchor {
                    block_id,
                    kind,
                    top,
                    orphan,
                })
            })
            .collect();
        // Block indices stand in for pixel tops; the slack must not reach
        // the next Block.
        edit::active_outline_id(
            &anchors,
            top_ix as f32 - edit::OUTLINE_ACTIVE_THRESHOLD_SLACK,
            0.,
        )
        .map(str::to_owned)
    }

    fn render_link(
        &self,
        entry: &OutlineEntry,
        nested: bool,
        p: &Palette,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let active = self.active.as_deref() == Some(entry.block_id.as_str());
        let untitled = entry.label.is_empty();
        let subheading = entry.kind == OutlineKind::Subheading;
        let label: SharedString = if untitled {
            "Untitled".into()
        } else {
            entry.label.clone().into()
        };
        let (color, weight) = if active {
            (p.accent, FontWeight(550.))
        } else if untitled || subheading {
            (p.text_secondary, FontWeight(450.))
        } else {
            (p.text, FontWeight(550.))
        };
        let id = entry.block_id.clone();
        div()
            .id(SharedString::from(format!("outline-{}", entry.block_id)))
            .flex_1()
            .min_w_0()
            .px(px(8.))
            .py(px(5.))
            .rounded(px(6.))
            .border_1()
            .border_color(if active && p.dark {
                p.border
            } else {
                transparent_black()
            })
            .text_size(px(if subheading { 12.5 } else { 13. }))
            .font_weight(weight)
            .text_color(color)
            .when(untitled, |d| d.italic())
            .when(nested, |d| d.w_full())
            .truncate()
            .cursor_pointer()
            .when(active, |d| d.bg(Palette::fade(p.accent, 0.22)))
            .when(!active, |d| d.hover(|s| s.bg(p.hover)))
            .on_click(cx.listener(move |this, _, window, cx| this.jump(&id, window, cx)))
            .child(label)
    }

    fn render_entry(
        &self,
        entry: &OutlineEntry,
        p: &Palette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let group = entry.kind == OutlineKind::Heading && !entry.children.is_empty();
        let expanded = group && self.expanded.contains(&entry.block_id);
        let id = entry.block_id.clone();
        let chevron = group.then(|| {
            div()
                .id(SharedString::from(format!(
                    "outline-chevron-{}",
                    entry.block_id
                )))
                .flex_none()
                .size(px(22.))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(4.))
                .text_color(p.text_secondary)
                .hover(|s| s.bg(p.hover).text_color(p.text))
                .cursor_pointer()
                .on_click(cx.listener(move |this, _, _, cx| this.toggle(&id, cx)))
                .child(
                    Icon::new(if expanded {
                        IconName::ChevronDown
                    } else {
                        IconName::ChevronRight
                    })
                    .xsmall(),
                )
        });
        let children = expanded.then(|| {
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .ml(px(8.))
                .pl(px(3.))
                .mt(px(2.))
                .mb(px(4.))
                .border_l_1()
                .border_color(p.border_strong)
                .children(
                    entry
                        .children
                        .iter()
                        .map(|child| self.render_link(child, true, p, cx)),
                )
        });
        div()
            .flex()
            .flex_col()
            .min_w_0()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(2.))
                    .min_w_0()
                    .child(self.render_link(entry, false, p, cx))
                    .children(chevron),
            )
            .children(children)
            .into_any_element()
    }
}

impl Render for Outline {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.editor.is_none() {
            self.follow_editor(cx);
        }
        let p = palette(cx).clone();
        let entries = self.entries(cx);

        let expandable: Vec<String> = entries
            .iter()
            .filter(|e| e.kind == OutlineKind::Heading && !e.children.is_empty())
            .map(|e| e.block_id.clone())
            .collect();
        self.expanded.retain(|id| expandable.contains(id));

        let active = self.compute_active(&entries, cx);
        if active != self.active {
            // Keep the active heading's group open so the highlight shows.
            if let Some(id) = &active
                && let Some(parent) = entries
                    .iter()
                    .find(|e| &e.block_id == id || e.children.iter().any(|c| &c.block_id == id))
                && !parent.children.is_empty()
            {
                self.expanded.insert(parent.block_id.clone());
            }
            self.active = active;
        }

        let all_expanded =
            !expandable.is_empty() && expandable.iter().all(|id| self.expanded.contains(id));
        let toggle_all = (!expandable.is_empty()).then(|| {
            Button::new("outline-toggle-all")
                .ghost()
                .small()
                .icon(if all_expanded {
                    Lucide::ChevronsUp
                } else {
                    Lucide::ChevronsDown
                })
                .tooltip(if all_expanded {
                    "Collapse all"
                } else {
                    "Expand all"
                })
                .on_click(cx.listener(move |this, _, _, cx| {
                    if all_expanded {
                        this.expanded.clear();
                    } else {
                        this.expanded.extend(expandable.iter().cloned());
                    }
                    cx.notify();
                }))
        });

        let header = div()
            .flex()
            .items_center()
            .gap_2()
            .px_3()
            .pt_3()
            .pb_2()
            .child(
                div()
                    .flex_1()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Content"),
            )
            .children(toggle_all);

        let body = if entries.is_empty() {
            div()
                .mx_2()
                .my_3()
                .text_size(px(13.))
                .text_color(p.text_secondary)
                .child("No heading")
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .children(
                    entries
                        .iter()
                        .map(|e| self.render_entry(e, &p, cx))
                        .collect::<Vec<_>>(),
                )
                .into_any_element()
        };

        div().size_full().flex().flex_col().child(header).child(
            div()
                .id("outline-scroll")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .px_2()
                .pb_3()
                .child(body),
        )
    }
}
