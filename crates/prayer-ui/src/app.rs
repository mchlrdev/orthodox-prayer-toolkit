//! The window's root: Library sidebar, workspace and Content outline.

use std::path::PathBuf;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputEvent, InputState};
use gpui_kit::component::menu::{ContextMenuExt, DropdownMenu, PopupMenu, PopupMenuItem};
use gpui_kit::component::notification::{Notification, NotificationType};
use gpui_kit::component::{Disableable, IconName, Sizable, WindowExt};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use prayer_app::edit::VariantRef;
use prayer_app::session::{DiskChange, NoticeLevel, PendingAction, SelectOutcome, SidebarEntry};
use prayer_core::display_title::resolve_display_title;

use crate::actions::*;
use crate::dialogs;
use crate::editor::EditorEvent;
use crate::find::FindBar;
use crate::outline::Outline;
use crate::screens;
use crate::state::{AppEvent, AppState};
use crate::theme::{Palette, palette};
use crate::updates::Updates;

const SIDEBAR_WIDTH: f32 = 280.;
const OUTLINE_WIDTH: f32 = 260.;

pub struct Root {
    state: Entity<AppState>,
    updates: Entity<Updates>,
    filter: Entity<InputState>,
    find: Entity<FindBar>,
    outline: Entity<Outline>,
    focus_handle: FocusHandle,
    /// The window may close (the unsaved-changes decision was made).
    closing: bool,
    _subscriptions: Vec<Subscription>,
}

impl Root {
    pub fn new(updates: Entity<Updates>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let state = cx.new(AppState::new);
        let filter = cx.new(|cx| InputState::new(window, cx).placeholder("Filter prayers…"));
        let find = cx.new(|cx| FindBar::new(state.clone(), window, cx));
        let outline = cx.new(|cx| Outline::new(state.clone(), cx));
        let subscriptions = vec![
            cx.observe(&state, |_, _, cx| cx.notify()),
            cx.observe(&updates, |_, _, cx| cx.notify()),
            cx.subscribe_in(&filter, window, |_, _, event: &InputEvent, _, cx| {
                if matches!(event, InputEvent::Change) {
                    cx.notify();
                }
            }),
            cx.subscribe_in(&state, window, Self::on_app_event),
        ];
        // Ask before the window closes with unsaved changes.
        let root = cx.entity().downgrade();
        window.on_window_should_close(cx, move |window, cx| {
            root.update(cx, |this, cx| this.should_close(window, cx))
                .unwrap_or(true)
        });
        Self {
            state,
            updates,
            filter,
            find,
            outline,
            focus_handle: cx.focus_handle(),
            closing: false,
            _subscriptions: subscriptions,
        }
    }

    fn should_close(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> bool {
        if self.closing || !self.state.read(cx).session.has_unsaved() {
            return true;
        }
        self.state
            .update(cx, |s, cx| s.request(PendingAction::CloseWindow, cx));
        false
    }

    fn on_app_event(
        &mut self,
        _: &Entity<AppState>,
        event: &AppEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match event {
            AppEvent::Notice(notice) => {
                let kind = match notice.level {
                    NoticeLevel::Info => NotificationType::Info,
                    NoticeLevel::Warning => NotificationType::Warning,
                    NoticeLevel::Error => NotificationType::Error,
                };
                let mut note = Notification::new()
                    .with_type(kind)
                    .title(notice.title.clone())
                    .message(notice.message.clone());
                if notice.level != NoticeLevel::Info {
                    note = note.autohide(false);
                }
                window.push_notification(note, cx);
            }
            AppEvent::UnsavedChanges => dialogs::unsaved::open(self.state.clone(), window, cx),
            AppEvent::CloseWindow => {
                self.closing = true;
                window.remove_window();
            }
            AppEvent::InstallUpdate => self.updates.update(cx, |u, cx| u.install(cx)),
        }
    }

    // -- actions --------------------------------------------------------------

    fn pick_library(&mut self, cx: &mut Context<Self>) {
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Open".into()),
        });
        let state = self.state.clone();
        cx.spawn(async move |_, cx| {
            if let Ok(Ok(Some(paths))) = paths.await
                && let Some(path) = paths.into_iter().next()
            {
                state.update(cx, |s, cx| s.open_library(path, cx));
            }
        })
        .detach();
    }

    fn open_recent(&mut self, path: String, cx: &mut Context<Self>) {
        self.state
            .update(cx, |s, cx| s.open_library(PathBuf::from(path), cx));
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.state
            .update(cx, |s, cx| s.request(PendingAction::Refresh, cx));
    }

    fn select(&mut self, path: String, window: &mut Window, cx: &mut Context<Self>) {
        let outcome = self.state.update(cx, |s, cx| s.select(&path, cx));
        if let Some(SelectOutcome::Opened) = outcome {
            self.focus_editor(window, cx);
        }
    }

    fn focus_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let editor = self.state.update(cx, |s, cx| s.selected_editor(cx));
        if let Some(editor) = editor {
            let handle = editor.read(cx).focus_handle().clone();
            window.focus(&handle, cx);
            self.subscribe_editor(&editor, window, cx);
        }
    }

    fn subscribe_editor(
        &mut self,
        editor: &Entity<crate::editor::PrayerEditor>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let state = self.state.clone();
        let sub = cx.subscribe_in(
            editor,
            window,
            move |_, _, event: &EditorEvent, window, cx| match event {
                EditorEvent::EditKind(kind) => {
                    dialogs::kind::open_edit(state.clone(), kind.clone(), window, cx)
                }
                EditorEvent::NewKind { block_id } => {
                    dialogs::kind::open_new(state.clone(), block_id.clone(), window, cx)
                }
            },
        );
        self._subscriptions.push(sub);
    }

    fn on_save(&mut self, _: &Save, _: &mut Window, cx: &mut Context<Self>) {
        self.state.update(cx, |s, cx| s.save_selected(cx));
    }

    fn on_save_all(&mut self, _: &SaveAll, _: &mut Window, cx: &mut Context<Self>) {
        self.state.update(cx, |s, cx| {
            let result = s.session.save_all();
            s.report(result, cx);
            s.notify_all(cx);
        });
    }

    fn on_open_library(&mut self, _: &OpenLibrary, _: &mut Window, cx: &mut Context<Self>) {
        self.pick_library(cx);
    }

    fn on_new_prayer(&mut self, _: &NewPrayer, window: &mut Window, cx: &mut Context<Self>) {
        if self.state.read(cx).session.library().is_some() {
            dialogs::new_prayer::open(self.state.clone(), window, cx);
        }
    }

    fn on_settings(&mut self, _: &OpenSettings, window: &mut Window, cx: &mut Context<Self>) {
        crate::app_settings::open(self.state.clone(), self.updates.clone(), window, cx);
    }

    fn on_undo(&mut self, _: &Undo, _: &mut Window, cx: &mut Context<Self>) {
        self.state.update(cx, |s, cx| s.undo(cx));
    }

    fn on_redo(&mut self, _: &Redo, _: &mut Window, cx: &mut Context<Self>) {
        self.state.update(cx, |s, cx| s.redo(cx));
    }

    fn selected_text(&self, cx: &mut Context<Self>) -> Option<String> {
        let editor = self.state.update(cx, |s, cx| s.selected_editor(cx))?;
        editor.read(cx).selected_text()
    }

    fn on_find(&mut self, _: &Find, window: &mut Window, cx: &mut Context<Self>) {
        let prefill = self.selected_text(cx);
        self.find.update(cx, |f, cx| f.toggle(prefill, window, cx));
    }

    fn on_find_replace(&mut self, _: &FindReplace, window: &mut Window, cx: &mut Context<Self>) {
        let prefill = self.selected_text(cx);
        self.find
            .update(cx, |f, cx| f.open(true, prefill, window, cx));
    }

    fn on_find_next(&mut self, _: &FindNext, window: &mut Window, cx: &mut Context<Self>) {
        let prefill = self.selected_text(cx);
        self.find.update(cx, |f, cx| {
            if f.is_open() {
                f.next(window, cx)
            } else {
                f.open(false, prefill, window, cx)
            }
        });
    }

    fn on_find_previous(&mut self, _: &FindPrevious, window: &mut Window, cx: &mut Context<Self>) {
        self.find.update(cx, |f, cx| {
            if f.is_open() {
                f.previous(window, cx)
            }
        });
    }

    fn on_close_find(&mut self, _: &CloseFind, window: &mut Window, cx: &mut Context<Self>) {
        let open = self.find.read(cx).is_open();
        if open {
            self.find.update(cx, |f, cx| f.close(window, cx));
            self.focus_editor(window, cx);
        } else {
            cx.propagate();
        }
    }

    fn toggle_library_sidebar(&mut self, cx: &mut Context<Self>) {
        self.state.update(cx, |s, cx| {
            s.session
                .update_prefs(|p| p.sidebar.library_collapsed = !p.sidebar.library_collapsed);
            cx.notify();
        });
    }

    fn toggle_content_sidebar(&mut self, cx: &mut Context<Self>) {
        self.state.update(cx, |s, cx| {
            s.session
                .update_prefs(|p| p.sidebar.content_collapsed = !p.sidebar.content_collapsed);
            cx.notify();
        });
    }

    fn on_quit(&mut self, _: &Quit, window: &mut Window, cx: &mut Context<Self>) {
        if self.should_close(window, cx) {
            cx.quit();
        }
    }

    fn on_close_window(&mut self, _: &CloseWindow, window: &mut Window, cx: &mut Context<Self>) {
        if self.should_close(window, cx) {
            window.remove_window();
        }
    }

    // -- sidebar ----------------------------------------------------------------

    fn library_menu(&self, menu: PopupMenu, cx: &App) -> PopupMenu {
        let state = self.state.read(cx);
        let has_library = state.session.library().is_some();
        let busy = state.is_scanning();
        let current = state
            .session
            .library()
            .map(|l| l.path().to_string_lossy().to_string());
        let recent: Vec<String> = state
            .session
            .prefs()
            .recent_libraries
            .iter()
            .take(8)
            .map(|r| r.path.clone())
            .collect();
        let this = self.state.clone();
        let updates = self.updates.clone();
        let (s1, s2, s3, s4, s5) = (
            this.clone(),
            this.clone(),
            this.clone(),
            this.clone(),
            this.clone(),
        );

        let mut menu = menu
            .item(
                PopupMenuItem::new("Open library…")
                    .disabled(busy)
                    .on_click(|_, window, cx| window.dispatch_action(Box::new(OpenLibrary), cx)),
            )
            .item(
                PopupMenuItem::new("New library…")
                    .disabled(busy)
                    .on_click(move |_, window, cx| {
                        dialogs::new_library::open(s1.clone(), window, cx)
                    }),
            );
        if !recent.is_empty() {
            menu = menu.separator().label("Recent");
            for path in recent {
                let is_current = current.as_deref() == Some(path.as_str());
                let name = folder_name(&path);
                let label = if is_current {
                    format!("{name} (current)")
                } else {
                    name
                };
                let state = this.clone();
                menu = menu.item(
                    PopupMenuItem::new(label)
                        .disabled(is_current || busy)
                        .on_click(move |_, _, cx| {
                            state.update(cx, |s, cx| s.open_library(PathBuf::from(&path), cx))
                        }),
                );
            }
        }
        menu = menu.separator().item(
            PopupMenuItem::new("App settings")
                .icon(IconName::Settings)
                .on_click(move |_, window, cx| {
                    crate::app_settings::open(s2.clone(), updates.clone(), window, cx)
                }),
        );
        if has_library {
            menu = menu
                .item(
                    PopupMenuItem::new("Library settings").on_click(move |_, window, cx| {
                        dialogs::library_settings::open(s3.clone(), window, cx)
                    }),
                )
                .item(
                    PopupMenuItem::new("Import prayer JSON…")
                        .disabled(busy)
                        .on_click(move |_, _, cx| import_prayer(s4.clone(), cx)),
                )
                .item(
                    PopupMenuItem::new("Refresh")
                        .icon(IconName::RefreshCw)
                        .disabled(busy)
                        .on_click(move |_, _, cx| {
                            s5.update(cx, |s, cx| s.request(PendingAction::Refresh, cx))
                        }),
                );
        }
        menu
    }

    fn render_sidebar(
        &mut self,
        p: &Palette,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let state = self.state.read(cx);
        let library = state.session.library();
        let (title, description) = match library {
            Some(l) => (
                l.folder_name(),
                l.manifest().and_then(|m| m.description.clone()),
            ),
            None => ("No library".to_string(), None),
        };
        let has_library = library.is_some();
        let query = self.filter.read(cx).value().to_string();
        let entries = state.session.sidebar_entries(&query);
        let selected = state.session.selected_path().map(str::to_owned);
        let collisions: Vec<String> = state
            .session
            .collisions()
            .iter()
            .map(|c| c.id.clone())
            .collect();
        let _ = window;

        let header = div()
            .flex()
            .items_start()
            .gap_2()
            .px_3()
            .pt_3()
            .pb_2()
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .truncate()
                            .child(title),
                    )
                    .children(description.map(|d| {
                        div()
                            .text_xs()
                            .text_color(p.text_secondary)
                            .line_clamp(2)
                            .child(d)
                    })),
            )
            .child({
                let root = cx.entity();
                Button::new("library-menu")
                    .ghost()
                    .small()
                    .icon(IconName::Ellipsis)
                    .tooltip("Library")
                    .dropdown_menu(move |menu, _, cx| root.read(cx).library_menu(menu, cx))
            });

        let filter_row = div()
            .flex()
            .items_center()
            .gap_1()
            .px_3()
            .pb_2()
            .when(has_library, |d| {
                d.child(Input::new(&self.filter).small().cleanable(true))
                    .child(
                        Button::new("new-prayer")
                            .ghost()
                            .small()
                            .icon(IconName::Plus)
                            .tooltip("New prayer")
                            .on_click(|_, window, cx| {
                                window.dispatch_action(Box::new(NewPrayer), cx)
                            }),
                    )
            });

        let body: AnyElement = if !has_library {
            div()
                .px_3()
                .text_xs()
                .text_color(p.text_secondary)
                .child("Open or create a library to list prayers.")
                .into_any_element()
        } else if entries.is_empty() && !query.trim().is_empty() {
            div()
                .px_3()
                .text_xs()
                .text_color(p.text_secondary)
                .child("No prayers match.")
                .into_any_element()
        } else {
            let root = cx.entity();
            let p2 = p.clone();
            uniform_list("prayers", entries.len(), move |range, _, cx| {
                range
                    .map(|ix| {
                        let entry = &entries[ix];
                        let active = selected.as_deref() == Some(entry.path.as_str());
                        prayer_row(ix, entry, active, &root, &p2, cx)
                    })
                    .collect()
            })
            .flex_1()
            .w_full()
            .into_any_element()
        };

        div()
            .w(px(SIDEBAR_WIDTH))
            .flex_none()
            .h_full()
            .flex()
            .flex_col()
            .border_r_1()
            .border_color(p.border)
            .bg(p.surface)
            .child(header)
            .when(!collisions.is_empty(), |d| {
                d.child(
                    div()
                        .mx_3()
                        .mb_2()
                        .p_2()
                        .rounded_md()
                        .bg(Palette::fade(p.accent, 0.1))
                        .text_xs()
                        .text_color(p.accent)
                        .child(
                            div()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child("Duplicate ids"),
                        )
                        .child(collisions.join(", ")),
                )
            })
            .child(filter_row)
            .child(body)
            .into_any_element()
    }

    // -- workspace --------------------------------------------------------------

    fn render_header(&mut self, p: &Palette, cx: &mut Context<Self>) -> AnyElement {
        let state = self.state.read(cx);
        let library_collapsed = state.session.prefs().sidebar.library_collapsed;
        let content_collapsed = state.session.prefs().sidebar.content_collapsed;
        let draft = state.session.selected_draft();
        let path = state.session.selected_path().map(str::to_owned);
        let columns = state.columns().to_vec();
        let title = draft.map(|d| {
            let prayer = d.prayer();
            let key = columns.first().map(VariantRef::key);
            resolve_display_title(&prayer.id, &prayer.variants, key).to_owned()
        });
        let dirty = draft.is_some_and(|d| d.is_dirty());
        let errors = draft.map_or(0, |d| d.errors().len());
        let error_list = draft.map(|d| d.errors().to_vec()).unwrap_or_default();
        let has_draft = draft.is_some();
        let update_ready = self.updates.read(cx).is_ready();

        div()
            .flex()
            .items_center()
            .gap_2()
            .h(px(48.))
            .px_3()
            .border_b_1()
            .border_color(p.border)
            .child(
                Button::new("toggle-library")
                    .ghost()
                    .small()
                    .icon(if library_collapsed {
                        IconName::PanelLeftOpen
                    } else {
                        IconName::PanelLeftClose
                    })
                    .tooltip(if library_collapsed {
                        "Expand library sidebar"
                    } else {
                        "Collapse library sidebar"
                    })
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_library_sidebar(cx))),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap_2()
                    .children(title.map(|t| {
                        div()
                            .text_size(px(15.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .truncate()
                            .child(t)
                    }))
                    .when(dirty, |d| {
                        d.child(badge("Unsaved", p.text_secondary, p.hover_strong))
                    })
                    .when(errors > 0, |d| {
                        let label = if errors == 1 {
                            "1 error".to_string()
                        } else {
                            format!("{errors} errors")
                        };
                        d.child(
                            div()
                                .id("error-badge")
                                .cursor_pointer()
                                .child(badge(label, p.on_accent, p.accent))
                                .on_click(move |_, window, cx| {
                                    dialogs::validation::open(error_list.clone(), window, cx)
                                }),
                        )
                    }),
            )
            .when(update_ready, |d| {
                let state = self.state.clone();
                d.child(
                    Button::new("restart-update")
                        .small()
                        .primary()
                        .label("Restart to update")
                        .on_click(move |_, _, cx| {
                            state.update(cx, |s, cx| s.request(PendingAction::InstallUpdate, cx))
                        }),
                )
            })
            .when(has_draft, |d| {
                let state = self.state.clone();
                let state2 = self.state.clone();
                let path = path.clone().unwrap_or_default();
                d.child(
                    Button::new("find")
                        .ghost()
                        .small()
                        .icon(IconName::Search)
                        .tooltip(if cfg!(target_os = "macos") {
                            "Find (⌘F)"
                        } else {
                            "Find (Ctrl+F)"
                        })
                        .on_click(|_, window, cx| window.dispatch_action(Box::new(Find), cx)),
                )
                .child(
                    Button::new("settings")
                        .ghost()
                        .small()
                        .icon(IconName::Settings)
                        .tooltip("Settings")
                        .on_click(move |_, window, cx| {
                            dialogs::prayer_settings::open(state.clone(), window, cx)
                        }),
                )
                .child(
                    Button::new("export")
                        .ghost()
                        .small()
                        .label("Export")
                        .on_click(move |_, window, cx| {
                            dialogs::export::open(state2.clone(), path.clone(), window, cx)
                        }),
                )
                .child(
                    Button::new("save")
                        .small()
                        .primary()
                        .label("Save")
                        .disabled(!dirty)
                        .on_click(|_, window, cx| window.dispatch_action(Box::new(Save), cx)),
                )
            })
            .child(
                Button::new("toggle-content")
                    .ghost()
                    .small()
                    .icon(if content_collapsed {
                        IconName::PanelRightOpen
                    } else {
                        IconName::PanelRightClose
                    })
                    .tooltip(if content_collapsed {
                        "Expand content sidebar"
                    } else {
                        "Collapse content sidebar"
                    })
                    .on_click(cx.listener(|this, _, _, cx| this.toggle_content_sidebar(cx))),
            )
            .into_any_element()
    }

    /// The column bar: one chip per visible Variant, switch/remove/add.
    fn render_columns(&mut self, p: &Palette, cx: &mut Context<Self>) -> Option<AnyElement> {
        let state = self.state.read(cx);
        let draft = state.session.selected_draft()?;
        let variants: Vec<(VariantRef, String)> = draft
            .prayer()
            .variants
            .iter()
            .map(|v| (VariantRef::from(v), v.title.clone()))
            .collect();
        if variants.len() < 2 {
            return None;
        }
        let columns = state.columns().to_vec();
        let hidden: Vec<(VariantRef, String)> = variants
            .iter()
            .filter(|(v, _)| !columns.contains(v))
            .cloned()
            .collect();
        let state_entity = self.state.clone();

        let chips = columns.iter().enumerate().map(|(ix, col)| {
            let title = variants
                .iter()
                .find(|(v, _)| v == col)
                .map(|(_, t)| t.clone())
                .unwrap_or_default();
            let all = variants.clone();
            let cols = columns.clone();
            let state = state_entity.clone();
            let state_remove = state_entity.clone();
            let cols_remove = columns.clone();
            let can_remove = columns.len() > 1;
            div()
                .flex()
                .items_center()
                .rounded_md()
                .border_1()
                .border_color(p.border)
                .child(
                    Button::new(("column", ix))
                        .ghost()
                        .xsmall()
                        .label(format!("{} / {}", col.lang, col.variant))
                        .tooltip(title)
                        .dropdown_caret(true)
                        .dropdown_menu(move |mut menu, _, _| {
                            menu = menu.label("Switch column");
                            for (v, t) in &all {
                                let state = state.clone();
                                let cols = cols.clone();
                                let v2 = v.clone();
                                menu = menu.item(
                                    PopupMenuItem::new(format!(
                                        "{} / {} — {}",
                                        v.lang, v.variant, t
                                    ))
                                    .checked(*v == cols[ix])
                                    .on_click(
                                        move |_, _, cx| {
                                            let next = switch_column(&cols, ix, &v2);
                                            state.update(cx, |s, cx| s.set_columns(next, cx));
                                        },
                                    ),
                                );
                            }
                            menu
                        }),
                )
                .when(can_remove, |d| {
                    d.child(
                        Button::new(("remove-column", ix))
                            .ghost()
                            .xsmall()
                            .icon(IconName::Close)
                            .tooltip("Remove column")
                            .on_click(move |_, _, cx| {
                                let mut next = cols_remove.clone();
                                next.remove(ix);
                                state_remove.update(cx, |s, cx| s.set_columns(next, cx));
                            }),
                    )
                })
        });

        let add = (!hidden.is_empty()).then(|| {
            let state = state_entity.clone();
            let cols = columns.clone();
            let hidden2 = hidden.clone();
            Button::new("add-column")
                .ghost()
                .xsmall()
                .icon(IconName::Plus)
                .label("Add")
                .dropdown_menu(move |mut menu, _, _| {
                    menu = menu.label("Add translation");
                    for (v, t) in &hidden2 {
                        let state = state.clone();
                        let mut next = cols.clone();
                        next.push(v.clone());
                        menu = menu.item(
                            PopupMenuItem::new(format!("{} / {} — {}", v.lang, v.variant, t))
                                .on_click(move |_, _, cx| {
                                    let next = next.clone();
                                    state.update(cx, |s, cx| s.set_columns(next, cx))
                                }),
                        );
                    }
                    menu
                })
        });
        let show_all = (hidden.len() > 1).then(|| {
            let state = state_entity.clone();
            let all: Vec<VariantRef> = variants.iter().map(|(v, _)| v.clone()).collect();
            Button::new("show-all")
                .ghost()
                .xsmall()
                .label("Show all")
                .on_click(move |_, _, cx| {
                    let all = all.clone();
                    state.update(cx, |s, cx| s.set_columns(all, cx))
                })
        });

        Some(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap_2()
                .px_3()
                .py_1()
                .border_b_1()
                .border_color(p.border)
                .children(chips)
                .children(add)
                .children(show_all)
                .into_any_element(),
        )
    }

    /// "Changed on disk" / "Deleted on disk" banner for the selected prayer.
    fn render_disk_banner(&mut self, p: &Palette, cx: &mut Context<Self>) -> Option<AnyElement> {
        let state = self.state.read(cx);
        let path = state.session.selected_path()?.to_owned();
        let change = *state.disk.get(&path)?;
        let (title, text) = match change {
            DiskChange::ChangedOnDisk => (
                "Changed on disk",
                "This prayer was changed outside the app while you have unsaved changes.",
            ),
            DiskChange::DeletedOnDisk => (
                "Deleted on disk",
                "The file was deleted outside the app. Saving recreates it.",
            ),
            _ => return None,
        };
        let s1 = self.state.clone();
        let s2 = self.state.clone();
        let (p1, p2) = (path.clone(), path.clone());
        Some(
            div()
                .flex()
                .items_center()
                .gap_3()
                .px_3()
                .py_2()
                .bg(Palette::fade(p.accent, 0.08))
                .border_b_1()
                .border_color(p.border)
                .text_sm()
                .child(
                    div()
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(p.accent)
                        .child(title),
                )
                .child(div().flex_1().child(text))
                .when(change == DiskChange::ChangedOnDisk, |d| {
                    d.child(Button::new("reload").small().label("Reload").on_click(
                        move |_, _, cx| s1.update(cx, |s, cx| s.reload_from_disk(&p1, cx)),
                    ))
                    .child(
                        Button::new("keep")
                            .small()
                            .ghost()
                            .label("Keep mine")
                            .on_click(move |_, _, cx| s2.update(cx, |s, cx| s.keep_mine(&p2, cx))),
                    )
                })
                .into_any_element(),
        )
    }

    fn render_workspace(
        &mut self,
        p: &Palette,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let (has_library, invalid, has_draft) = {
            let s = self.state.read(cx);
            (
                s.session.library().is_some(),
                s.session.selected_invalid().is_some(),
                s.session.selected_draft().is_some() && !s.columns().is_empty(),
            )
        };
        let header = self.render_header(p, cx);
        let body: AnyElement = if !has_library {
            screens::welcome(&self.state, cx)
        } else if invalid {
            screens::invalid(&self.state, cx)
        } else if has_draft {
            let editor = self.state.update(cx, |s, cx| s.selected_editor(cx));
            match editor {
                Some(editor) => {
                    if !self.is_subscribed(&editor) {
                        self.subscribe_editor(&editor, window, cx);
                    }
                    div()
                        .flex_1()
                        .min_h_0()
                        .flex()
                        .flex_col()
                        .children(self.render_columns(p, cx))
                        .children(self.render_disk_banner(p, cx))
                        .child(self.find.clone())
                        .child(div().flex_1().min_h_0().child(editor))
                        .into_any_element()
                }
                None => screens::nothing_selected(cx),
            }
        } else {
            screens::nothing_selected(cx)
        };
        div()
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .bg(p.surface)
            .child(header)
            .child(div().flex_1().min_h_0().flex().flex_col().child(body))
            .into_any_element()
    }

    fn is_subscribed(&self, editor: &Entity<crate::editor::PrayerEditor>) -> bool {
        // One subscription per editor entity, remembered by id.
        SUBSCRIBED.with(|s| !s.borrow_mut().insert(editor.entity_id()))
    }
}

thread_local! {
    static SUBSCRIBED: std::cell::RefCell<std::collections::HashSet<EntityId>> =
        Default::default();
}

fn badge(label: impl Into<SharedString>, fg: Hsla, bg: Hsla) -> Div {
    div()
        .px(px(7.))
        .py(px(1.))
        .rounded_full()
        .text_xs()
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(fg)
        .bg(bg)
        .child(label.into())
}

fn folder_name(path: &str) -> String {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .to_string()
}

/// Puts `variant` at column `ix`; if it was already shown, the two swap.
fn switch_column(columns: &[VariantRef], ix: usize, variant: &VariantRef) -> Vec<VariantRef> {
    let mut next = columns.to_vec();
    if let Some(other) = next.iter().position(|c| c == variant) {
        next.swap(ix, other);
    } else {
        next[ix] = variant.clone();
    }
    next
}

fn import_prayer(state: Entity<AppState>, cx: &mut App) {
    let paths = cx.prompt_for_paths(PathPromptOptions {
        files: true,
        directories: false,
        multiple: false,
        prompt: Some("Import".into()),
    });
    cx.spawn(async move |cx| {
        if let Ok(Ok(Some(paths))) = paths.await
            && let Some(path) = paths.into_iter().next()
        {
            state.update(cx, |s, cx| {
                let result = s.session.import_prayer(&path);
                if let Some(new_path) = s.report(result, cx) {
                    s.select(&new_path, cx);
                }
                s.notify_all(cx);
            });
        }
    })
    .detach();
}

fn export_prayer_json(state: Entity<AppState>, path: String, cx: &mut App) {
    let (dir, name) = {
        let s = state.read(cx);
        let name = s.session.prayer_json_file_name(&path);
        let dir = dirs_home();
        (dir, name)
    };
    let target = cx.prompt_for_new_path(&dir, Some(&name));
    cx.spawn(async move |cx| {
        if let Ok(Ok(Some(target))) = target.await {
            state.update(cx, |s, cx| {
                let result = s.session.export_prayer_json(&path, &target);
                s.report(result, cx);
            });
        }
    })
    .detach();
}

fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn delete_prayer(state: Entity<AppState>, path: String, window: &mut Window, cx: &mut App) {
    dialogs::confirm::open(
        "Delete prayer?",
        "This cannot be undone.",
        "Delete",
        true,
        move |_, cx| {
            state.update(cx, |s, cx| {
                let result = s.session.delete_prayer(&path);
                s.report(result, cx);
                s.notify_all(cx);
            })
        },
        window,
        cx,
    );
}

fn prayer_row(
    ix: usize,
    entry: &SidebarEntry,
    active: bool,
    root: &Entity<Root>,
    p: &Palette,
    _cx: &mut App,
) -> AnyElement {
    let path = entry.path.clone();
    let id = entry
        .id
        .clone()
        .unwrap_or_else(|| entry.path.trim_end_matches(".json").to_string());
    let subtitle = match (&entry.title, entry.valid) {
        (Some(title), true) => Some(title.clone()),
        _ if !entry.scanned || !entry.valid => Some(entry.path.clone()),
        _ => None,
    };
    let description = entry.description.clone().filter(|_| entry.valid);
    let root_click = root.clone();
    let path_click = path.clone();
    let state = root.read(_cx).state.clone();
    let (s_export, s_delete) = (state.clone(), state.clone());
    let (p_export, p_delete) = (path.clone(), path.clone());
    div()
        .id(("prayer-row", ix))
        .w_full()
        .mx_2()
        .px_2()
        .py(px(6.))
        .rounded_md()
        .flex()
        .items_start()
        .gap_2()
        .cursor_pointer()
        .when(active, |d| d.bg(p.hover_strong))
        .when(!active, |d| d.hover(|d| d.bg(p.hover)))
        .on_click(move |_, window, cx| {
            let path = path_click.clone();
            root_click.update(cx, |this, cx| this.select(path, window, cx));
        })
        .context_menu(move |menu, _, _| {
            let (s1, s2) = (s_export.clone(), s_delete.clone());
            let (p1, p2) = (p_export.clone(), p_delete.clone());
            menu.item(
                PopupMenuItem::new("Export prayer JSON…")
                    .on_click(move |_, _, cx| export_prayer_json(s1.clone(), p1.clone(), cx)),
            )
            .separator()
            .item(
                PopupMenuItem::new("Delete")
                    .icon(IconName::Delete)
                    .on_click(move |_, window, cx| {
                        delete_prayer(s2.clone(), p2.clone(), window, cx)
                    }),
            )
        })
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_1()
                        .child(
                            div()
                                .text_sm()
                                .font_weight(FontWeight::MEDIUM)
                                .truncate()
                                .child(id),
                        )
                        .when(entry.dirty, |d| {
                            d.child(
                                div()
                                    .id(("dirty", ix))
                                    .size(px(7.))
                                    .rounded_full()
                                    .bg(p.accent)
                                    .tooltip(|window, cx| {
                                        gpui_kit::component::tooltip::Tooltip::new(
                                            "Unsaved changes",
                                        )
                                        .build(window, cx)
                                    }),
                            )
                        }),
                )
                .children(subtitle.map(|s| {
                    div()
                        .text_xs()
                        .text_color(p.text_secondary)
                        .truncate()
                        .child(s)
                }))
                .children(description.map(|s| {
                    div()
                        .text_xs()
                        .text_color(p.text_secondary)
                        .opacity(0.8)
                        .truncate()
                        .child(s)
                })),
        )
        .when(!entry.valid && entry.scanned, |d| {
            d.child(badge("!", p.on_accent, p.accent))
        })
        .into_any_element()
}

impl Focusable for Root {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for Root {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = palette(cx).clone();
        let (library_collapsed, content_collapsed, has_draft) = {
            let s = self.state.read(cx);
            (
                s.session.prefs().sidebar.library_collapsed,
                s.session.prefs().sidebar.content_collapsed,
                s.session.selected_draft().is_some(),
            )
        };
        let sidebar = (!library_collapsed).then(|| self.render_sidebar(&p, window, cx));
        let workspace = self.render_workspace(&p, window, cx);
        let outline = (!content_collapsed && has_draft).then(|| {
            div()
                .w(px(OUTLINE_WIDTH))
                .flex_none()
                .h_full()
                .border_l_1()
                .border_color(p.border)
                .bg(p.surface)
                .child(self.outline.clone())
        });

        div()
            .id("root")
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::on_save))
            .on_action(cx.listener(Self::on_save_all))
            .on_action(cx.listener(Self::on_open_library))
            .on_action(cx.listener(Self::on_new_prayer))
            .on_action(cx.listener(Self::on_settings))
            .on_action(cx.listener(Self::on_undo))
            .on_action(cx.listener(Self::on_redo))
            .on_action(cx.listener(Self::on_find))
            .on_action(cx.listener(Self::on_find_replace))
            .on_action(cx.listener(Self::on_find_next))
            .on_action(cx.listener(Self::on_find_previous))
            .on_action(cx.listener(Self::on_close_find))
            .on_action(cx.listener(Self::on_quit))
            .on_action(cx.listener(Self::on_close_window))
            .on_action(
                cx.listener(|this, _: &ToggleLibrarySidebar, _, cx| {
                    this.toggle_library_sidebar(cx)
                }),
            )
            .on_action(
                cx.listener(|this, _: &ToggleContentSidebar, _, cx| {
                    this.toggle_content_sidebar(cx)
                }),
            )
            .on_action(cx.listener(|this, _: &CheckForUpdates, _, cx| {
                this.updates.update(cx, |u, cx| u.check(cx))
            }))
            .size_full()
            .flex()
            .flex_row()
            .bg(p.bg)
            .text_color(p.text)
            .children(sidebar)
            .child(workspace)
            .children(outline)
    }
}

// Re-exported for screens and dialogs that open a library.
pub fn pick_and_open_library(state: Entity<AppState>, cx: &mut App) {
    let paths = cx.prompt_for_paths(PathPromptOptions {
        files: false,
        directories: true,
        multiple: false,
        prompt: Some("Open".into()),
    });
    cx.spawn(async move |cx| {
        if let Ok(Ok(Some(paths))) = paths.await
            && let Some(path) = paths.into_iter().next()
        {
            state.update(cx, |s, cx| s.open_library(path, cx));
        }
    })
    .detach();
}

#[cfg(test)]
mod tests {
    use super::{VariantRef, folder_name, switch_column};

    #[test]
    fn switching_columns_swaps_when_shown() {
        let a = VariantRef::new("de", "a");
        let b = VariantRef::new("ru", "b");
        let c = VariantRef::new("el", "c");
        assert_eq!(
            switch_column(&[a.clone(), b.clone()], 0, &b),
            vec![b.clone(), a.clone()]
        );
        assert_eq!(switch_column(&[a.clone(), b.clone()], 1, &c), vec![a, c]);
        assert_eq!(folder_name("/x/y/lib/"), "lib");
        assert_eq!(folder_name("C:\\x\\lib"), "lib");
    }
}
