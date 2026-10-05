//! "Edit kind" (rename across the Library, Kind style) and "New kind", plus
//! the Kind flows the Prayer settings Kinds pane shares: write a Library
//! style, rename across the Library (with its confirm), delete.

use std::cell::RefCell;
use std::rc::Rc;

use gpui_kit::component::WindowExt;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::InputState;
use gpui_kit::component::{Disableable, IconName};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use prayer_app::catalog::EntryStatus;
use prayer_app::edit;
use prayer_app::history::EditKind;
use prayer_app::session::KindRenameRequest;
use prayer_core::resolve_styles::FALLBACK_KIND_STYLE;
use prayer_core::validate_styles::{is_valid_kind_id, sanitize_kind_id_input};
use prayer_core::{KindStyle, KindStyleOverride, is_kind_preset, kind_display_label};

use super::confirm;
use super::fields::{Edited, KindStyleEditor, field, input_view, set_text, text_input};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Shared flows
// ---------------------------------------------------------------------------

/// Every Kind to offer: presets, the Kinds of the Library (open drafts
/// count with their unsaved state, not the file's) and the Kinds with a
/// Library style; presets first.
pub fn known_kinds(state: &AppState) -> Vec<String> {
    let session = &state.session;
    let mut extra: Vec<&str> = Vec::new();
    if let Some(library) = session.library() {
        extra.extend(library.styles().keys().map(String::as_str));
    }
    if let Some(catalog) = session.catalog() {
        for entry in catalog.entries() {
            if session.draft(&entry.path).is_some() {
                continue;
            }
            if let EntryStatus::Valid(summary) = &entry.status {
                extra.extend(summary.kinds.iter().map(String::as_str));
            }
        }
    }
    for path in session.open_paths() {
        if let Some(draft) = session.draft(path) {
            extra.extend(draft.prayer().structure.iter().map(|b| b.kind.as_str()));
        }
    }
    edit::order_kinds(
        prayer_core::KIND_PRESETS
            .iter()
            .copied()
            .chain(extra.iter().copied()),
    )
}

/// The style the Kind has now (resolved), else the fallback preset.
pub fn style_of(state: &AppState, kind: &str) -> KindStyle {
    state
        .styles()
        .get(kind)
        .cloned()
        .unwrap_or_else(|| FALLBACK_KIND_STYLE.clone())
}

/// Writes the Library style of `kind` at once (outside undo). Errors become
/// the "Cannot save library styles" toast.
pub fn write_style(state: &Entity<AppState>, kind: &str, style: &KindStyle, cx: &mut App) {
    state.update(cx, |s, cx| {
        let mut styles = s
            .session
            .library()
            .map(|l| l.styles().clone())
            .unwrap_or_default();
        styles.insert(kind.to_owned(), KindStyleOverride::from(style));
        let result = s.session.set_library_styles(&styles);
        s.report(result, cx);
        s.notify_all(cx);
    });
}

/// Renames a Kind across the Library. More than one affected prayer asks
/// "Rename kind in library?" first; `on_done` runs once the rename happened
/// (not when the confirm is cancelled).
pub fn rename_flow(
    state: &Entity<AppState>,
    from: &str,
    to: &str,
    on_done: impl Fn(&mut Window, &mut App) + 'static,
    window: &mut Window,
    cx: &mut App,
) {
    let request = state.update(cx, |s, cx| {
        let result = s.session.request_kind_rename(from, to);
        let request = s.report(result, cx);
        s.notify_all(cx);
        request
    });
    match request {
        Some(KindRenameRequest::Applied(_)) => on_done(window, cx),
        Some(KindRenameRequest::Confirm(plan)) => {
            let message = format!(
                "Rename “{}” to “{}” in {} prayers? This writes those files now.",
                kind_display_label(&plan.from),
                kind_display_label(&plan.to),
                plan.affected.len()
            );
            let state = state.clone();
            confirm::open(
                "Rename kind in library?",
                message,
                "Rename",
                false,
                move |window, cx| {
                    state.update(cx, |s, cx| {
                        let result = s.session.apply_kind_rename(&plan);
                        s.report(result, cx);
                        s.notify_all(cx);
                    });
                    on_done(window, cx);
                },
                window,
                cx,
            );
        }
        Some(KindRenameRequest::Ignored) | None => {}
    }
}

/// Deletes a custom Kind: its Library style goes, Blocks of the open prayer
/// that use it become `verse` (`annotation` for `verse`).
pub fn delete_kind(state: &Entity<AppState>, kind: &str, cx: &mut App) {
    state.update(cx, |s, cx| {
        let result = s.session.delete_kind(kind);
        s.report(result, cx);
        s.notify_all(cx);
    });
}

/// The Electron "Delete kind?" confirm, then [`delete_kind`].
fn confirm_delete(
    state: &Entity<AppState>,
    kind: &str,
    on_done: impl Fn(&mut Window, &mut App) + 'static,
    window: &mut Window,
    cx: &mut App,
) {
    let label = kind_display_label(kind);
    let fallback = if kind == "verse" {
        "annotation"
    } else {
        "verse"
    };
    let message = format!(
        "Delete “{label}”? Blocks using it become {fallback}. Style overrides for this kind are removed."
    );
    let state = state.clone();
    let kind = kind.to_owned();
    confirm::open(
        "Delete kind?",
        message,
        "Delete",
        true,
        move |window, cx| {
            delete_kind(&state, &kind, cx);
            on_done(window, cx);
        },
        window,
        cx,
    );
}

/// Shows the validation message for a Kind name field, none while empty.
fn name_issue(from: &str, text: &str, known: &[String]) -> Option<&'static str> {
    if text.trim().is_empty() && from.is_empty() {
        return None;
    }
    edit::kind_rename_issue(from, text, known.iter().map(String::as_str))
}

/// Keeps a name input to valid Kind characters while typing.
fn sanitized(input: &Entity<InputState>, raw: &str, window: &mut Window, cx: &mut App) -> String {
    let clean = sanitize_kind_id_input(raw);
    if clean != raw {
        set_text(input, &clean, window, cx);
    }
    clean
}

// ---------------------------------------------------------------------------
// Edit kind
// ---------------------------------------------------------------------------

/// Edit an existing Kind: name (renames it in every prayer of the Library)
/// and its style.
pub fn open_edit(state: Entity<AppState>, kind: String, window: &mut Window, cx: &mut App) {
    let form = cx.new(|cx| EditKindForm::new(state, kind.clone(), window, cx));
    let title = format!("Edit kind “{}”", kind_display_label(&kind));
    window.open_dialog(cx, move |dialog, _, _| {
        dialog
            .title(title.clone())
            .w(px(420.))
            .on_ok(|_, _, _| false)
            .child(form.clone())
    });
}

struct EditKindForm {
    state: Entity<AppState>,
    kind: String,
    name: Entity<InputState>,
    name_text: String,
    editor: Option<Entity<KindStyleEditor>>,
    focused: bool,
    _subs: Vec<Subscription>,
}

impl EditKindForm {
    fn new(
        state: Entity<AppState>,
        kind: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut subs = Vec::new();
        let name = text_input(
            &kind,
            "",
            &mut subs,
            window,
            cx,
            |this: &mut Self, edit, window, cx| match edit {
                Edited::Change(raw) => {
                    this.name_text = sanitized(&this.name, &raw, window, cx);
                    cx.notify();
                }
                Edited::Enter => this.finish(window, cx),
                Edited::Blur => {}
            },
        );
        let library_open = state.read(cx).session.library().is_some();
        let editor = library_open.then(|| {
            let style = style_of(state.read(cx), &kind);
            let (state, kind) = (state.clone(), kind.clone());
            cx.new(|cx| {
                KindStyleEditor::new(
                    style,
                    move |style, _, cx| write_style(&state, &kind, style, cx),
                    window,
                    cx,
                )
            })
        });
        Self {
            state,
            name,
            name_text: kind.clone(),
            kind,
            editor,
            focused: false,
            _subs: subs,
        }
    }

    fn issue(&self, cx: &App) -> Option<&'static str> {
        if is_kind_preset(&self.kind) {
            return None;
        }
        name_issue(
            &self.kind,
            &self.name_text,
            &known_kinds(self.state.read(cx)),
        )
    }

    fn finish(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.issue(cx).is_some() {
            return;
        }
        let next = self.name_text.trim().to_owned();
        if !is_kind_preset(&self.kind) && next != self.kind {
            rename_flow(&self.state, &self.kind, &next, |_, _| {}, window, cx);
        }
        window.close_dialog(cx);
    }

    fn delete(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        confirm_delete(
            &self.state,
            &self.kind,
            |window, cx| window.close_all_dialogs(cx),
            window,
            cx,
        );
    }
}

impl Render for EditKindForm {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let preset = is_kind_preset(&self.kind);
        if !std::mem::replace(&mut self.focused, true) && !preset {
            self.name.update(cx, |input, cx| input.focus(window, cx));
        }
        let issue = self.issue(cx);
        div()
            .flex()
            .flex_col()
            .gap_3()
            .when(!preset, |this| {
                this.child(field("Kind", None, issue, cx, input_view(&self.name)))
            })
            .when_some(self.editor.clone(), |this, editor| this.child(editor))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .mt_1()
                    .child(div().when(!preset, |this| {
                        this.child(
                            Button::new("delete-kind")
                                .label("Delete")
                                .icon(IconName::Delete)
                                .ghost()
                                .danger()
                                .on_click(
                                    cx.listener(|this, _, window, cx| this.delete(window, cx)),
                                ),
                        )
                    }))
                    .child(
                        Button::new("done")
                            .label("Done")
                            .primary()
                            .disabled(issue.is_some())
                            .on_click(cx.listener(|this, _, window, cx| this.finish(window, cx))),
                    ),
            )
    }
}

// ---------------------------------------------------------------------------
// New kind
// ---------------------------------------------------------------------------

/// Create a Kind and give it to Block `block_id` of the selected prayer.
pub fn open_new(state: Entity<AppState>, block_id: String, window: &mut Window, cx: &mut App) {
    let form = cx.new(|cx| NewKindForm::new(state, block_id, window, cx));
    window.open_dialog(cx, move |dialog, _, _| {
        dialog
            .title("New kind")
            .w(px(420.))
            .on_ok(|_, _, _| false)
            .child(form.clone())
    });
}

struct NewKindForm {
    state: Entity<AppState>,
    block_id: String,
    name: Entity<InputState>,
    name_text: String,
    style: Rc<RefCell<KindStyle>>,
    editor: Option<Entity<KindStyleEditor>>,
    focused: bool,
    _subs: Vec<Subscription>,
}

impl NewKindForm {
    fn new(
        state: Entity<AppState>,
        block_id: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut subs = Vec::new();
        let name = text_input(
            "",
            "new-kind",
            &mut subs,
            window,
            cx,
            |this: &mut Self, edit, window, cx| match edit {
                Edited::Change(raw) => {
                    this.name_text = sanitized(&this.name, &raw, window, cx);
                    cx.notify();
                }
                Edited::Enter => this.add(window, cx),
                Edited::Blur => {}
            },
        );
        let style = Rc::new(RefCell::new(FALLBACK_KIND_STYLE.clone()));
        let library_open = state.read(cx).session.library().is_some();
        let editor = library_open.then(|| {
            let shared = style.clone();
            let initial = style.borrow().clone();
            cx.new(|cx| {
                KindStyleEditor::new(
                    initial,
                    move |style, _, _| *shared.borrow_mut() = style.clone(),
                    window,
                    cx,
                )
            })
        });
        Self {
            state,
            block_id,
            name,
            name_text: String::new(),
            style,
            editor,
            focused: false,
            _subs: subs,
        }
    }

    /// The validation message; `None` while the field is empty or valid.
    fn issue(&self, cx: &App) -> Option<&'static str> {
        name_issue("", &self.name_text, &known_kinds(self.state.read(cx)))
    }

    fn can_add(&self, cx: &App) -> bool {
        let id = self.name_text.trim();
        is_valid_kind_id(id) && self.issue(cx).is_none()
    }

    fn add(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.can_add(cx) {
            return;
        }
        let id = self.name_text.trim().to_owned();
        if self.state.read(cx).session.library().is_some() {
            write_style(&self.state, &id, &self.style.borrow().clone(), cx);
        }
        let block_id = self.block_id.clone();
        self.state.update(cx, |s, cx| {
            s.session.edit_selected(EditKind::Other, |p| {
                if let Some(index) = p.structure.iter().position(|b| b.id == block_id) {
                    edit::set_block_kind(p, index, &id);
                }
            });
            s.notify_all(cx);
        });
        window.close_dialog(cx);
    }
}

impl Render for NewKindForm {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !std::mem::replace(&mut self.focused, true) {
            // The name field takes the keyboard when the dialog opens.
            self.name.update(cx, |input, cx| input.focus(window, cx));
        }
        let issue = self.issue(cx);
        let can_add = self.can_add(cx);
        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(field("Kind", None, issue, cx, input_view(&self.name)))
            .when_some(self.editor.clone(), |this, editor| this.child(editor))
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap_2()
                    .mt_1()
                    .child(
                        Button::new("cancel")
                            .label("Cancel")
                            .on_click(|_, window, cx| window.close_dialog(cx)),
                    )
                    .child(
                        Button::new("add")
                            .label("Add")
                            .primary()
                            .disabled(!can_add)
                            .on_click(cx.listener(|this, _, window, cx| this.add(window, cx))),
                    ),
            )
    }
}
