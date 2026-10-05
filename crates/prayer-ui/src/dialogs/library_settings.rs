//! Library settings (manifest): description, default language, layout style
//! prefix. Saved with `Session::save_library_settings`.

use gpui_kit::component::Disableable;
use gpui_kit::component::IndexPath;
use gpui_kit::component::WindowExt;
use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{InputState, TextareaState};
use gpui_kit::component::searchable_list::{SearchableListItem, SearchableVec};
use gpui_kit::component::select::{Select, SelectEvent, SelectState};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use prayer_core::style_prefix::is_valid_style_prefix_stem;
use prayer_core::{DefaultVariant, LibraryManifest};

use super::fields::{Edited, area_view, dimmed, field, input_view, text_area, text_input};
use crate::state::AppState;

pub fn open(state: Entity<AppState>, window: &mut Window, cx: &mut App) {
    if state.read(cx).session.library().is_none() {
        return;
    }
    let form = cx.new(|cx| LibrarySettingsForm::new(state, window, cx));
    window.open_dialog(cx, move |dialog, _, _| {
        dialog
            .title("Library settings")
            .w(px(480.))
            .on_ok(|_, _, _| false)
            .child(form.clone())
    });
}

/// One `lang / variant` choice; the value is `lang::variant`.
#[derive(Clone)]
struct VariantItem {
    key: SharedString,
    label: SharedString,
}

impl SearchableListItem for VariantItem {
    type Value = SharedString;

    fn title(&self) -> SharedString {
        self.label.clone()
    }

    fn value(&self) -> &Self::Value {
        &self.key
    }
}

fn variant_key(lang: &str, variant: &str) -> String {
    format!("{lang}::{variant}")
}

fn variant_label(lang: &str, variant: &str) -> String {
    format!("{lang} / {variant}")
}

fn parse_variant_key(key: &str) -> Option<DefaultVariant> {
    let (lang, variant) = key.split_once("::")?;
    (!lang.is_empty() && !variant.is_empty()).then(|| DefaultVariant {
        lang: lang.to_owned(),
        variant: variant.to_owned(),
    })
}

/// The form state turned into the manifest to write.
fn to_manifest(description: &str, default_key: Option<&str>, stem: &str) -> LibraryManifest {
    let mut manifest = LibraryManifest::default();
    let description = description.trim();
    if !description.is_empty() {
        manifest.description = Some(description.to_owned());
    }
    manifest.default_variant = default_key.and_then(parse_variant_key);
    let stem = stem.trim();
    if !stem.is_empty() && is_valid_style_prefix_stem(stem) {
        manifest.style_prefix_stem = Some(stem.to_owned());
    }
    manifest
}

struct LibrarySettingsForm {
    state: Entity<AppState>,
    description: Entity<TextareaState>,
    default: Entity<SelectState<SearchableVec<VariantItem>>>,
    default_key: Option<String>,
    has_choices: bool,
    stem: Entity<InputState>,
    stem_text: String,
    focused: bool,
    _subs: Vec<Subscription>,
}

impl LibrarySettingsForm {
    fn new(state: Entity<AppState>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (manifest, mut choices) = {
            let s = state.read(cx);
            let manifest = s
                .session
                .library()
                .and_then(|l| l.manifest().cloned())
                .unwrap_or_default();
            let mut choices: Vec<(String, String)> = Vec::new();
            let mut add = |lang: &str, variant: &str| {
                let key = variant_key(lang, variant);
                if !choices.iter().any(|(k, _)| *k == key) {
                    choices.push((key, variant_label(lang, variant)));
                }
            };
            if let Some(catalog) = s.session.catalog() {
                for v in catalog.variants() {
                    add(&v.lang, &v.variant);
                }
            }
            for path in s.session.open_paths() {
                if let Some(draft) = s.session.draft(path) {
                    for v in &draft.prayer().variants {
                        add(&v.lang, &v.variant);
                    }
                }
            }
            (manifest, choices)
        };
        let default_key = manifest
            .default_variant
            .as_ref()
            .map(|v| variant_key(&v.lang, &v.variant));
        if let Some(key) = &default_key
            && !choices.iter().any(|(k, _)| k == key)
            && let Some(v) = &manifest.default_variant
        {
            choices.push((
                key.clone(),
                format!("{} (not in library)", variant_label(&v.lang, &v.variant)),
            ));
        }
        choices.sort_by_key(|a| a.1.to_lowercase());
        let has_choices = !choices.is_empty();
        let selected = default_key
            .as_ref()
            .and_then(|key| choices.iter().position(|(k, _)| k == key))
            .map(|row| IndexPath::default().row(row));
        let items: Vec<VariantItem> = choices
            .into_iter()
            .map(|(key, label)| VariantItem {
                key: key.into(),
                label: label.into(),
            })
            .collect();

        let mut subs = Vec::new();
        let description = text_area(
            manifest.description.as_deref().unwrap_or(""),
            &mut subs,
            window,
            cx,
            |_: &mut Self, _: Edited, _, _| {},
        );
        let default = cx.new(|cx| {
            SelectState::new(SearchableVec::new(items), selected, window, cx).searchable(true)
        });
        subs.push(cx.subscribe_in(
            &default,
            window,
            |this, _, event: &SelectEvent<SearchableVec<VariantItem>>, _, cx| {
                let SelectEvent::Confirm(value) = event;
                this.default_key = value.as_ref().map(|v| v.to_string());
                cx.notify();
            },
        ));
        let stem_text = manifest.style_prefix_stem.clone().unwrap_or_default();
        let stem = text_input(
            &stem_text,
            "opt",
            &mut subs,
            window,
            cx,
            |this: &mut Self, edit, _, cx| {
                if let Edited::Change(text) = edit {
                    this.stem_text = text;
                    cx.notify();
                }
            },
        );
        Self {
            state,
            description,
            default,
            default_key,
            has_choices,
            stem,
            stem_text,
            focused: false,
            _subs: subs,
        }
    }

    fn stem_valid(&self) -> bool {
        is_valid_style_prefix_stem(self.stem_text.trim())
    }

    fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.stem_valid() {
            return;
        }
        let description = self.description.read(cx).value().to_string();
        let manifest = to_manifest(&description, self.default_key.as_deref(), &self.stem_text);
        let saved = self.state.update(cx, |s, cx| {
            let result = s.session.save_library_settings(manifest);
            let saved = s.report(result, cx).is_some();
            s.notify_all(cx);
            saved
        });
        if saved {
            window.close_dialog(cx);
        }
    }
}

impl Render for LibrarySettingsForm {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !std::mem::replace(&mut self.focused, true) {
            self.description
                .update(cx, |input, cx| input.focus(window, cx));
        }
        let stem_valid = self.stem_valid();
        let default_empty = !self.has_choices && self.default_key.is_none();
        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(field(
                "Description",
                None,
                None,
                cx,
                area_view(&self.description),
            ))
            .child(field(
                "Default language",
                None,
                None,
                cx,
                Select::new(&self.default)
                    .placeholder(if self.has_choices {
                        "None (first language per prayer)"
                    } else {
                        "No languages in library yet"
                    })
                    .search_placeholder("Search")
                    .cleanable(true)
                    .disabled(default_empty),
            ))
            .child(field(
                "Layout style prefix",
                Some(
                    "Stem only — underscore is added automatically (e.g. opt → opt_heading). Leave empty for the app default opt.",
                ),
                (!stem_valid)
                    .then_some("Use letters/digits only, starting with a letter — or leave empty"),
                cx,
                input_view(&self.stem).suffix(div().pr_2().child("_")),
            ))
            .when(default_empty, |this| {
                this.child(
                    dimmed(
                        "Add a language to a prayer first, then pick a library default here.",
                        cx,
                    )
                    .text_xs(),
                )
            })
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
                        Button::new("save")
                            .label("Save")
                            .primary()
                            .disabled(!stem_valid)
                            .on_click(cx.listener(|this, _, window, cx| this.save(window, cx))),
                    ),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::to_manifest;

    #[test]
    fn manifest_keeps_only_what_is_set() {
        let empty = to_manifest("  ", None, "");
        assert_eq!(empty, Default::default());

        let full = to_manifest(" Hours ", Some("de::standard"), "opt2");
        assert_eq!(full.description.as_deref(), Some("Hours"));
        let dv = full.default_variant.unwrap();
        assert_eq!((dv.lang.as_str(), dv.variant.as_str()), ("de", "standard"));
        assert_eq!(full.style_prefix_stem.as_deref(), Some("opt2"));
    }

    #[test]
    fn invalid_stem_and_key_are_dropped() {
        let manifest = to_manifest("", Some("broken"), "9x");
        assert_eq!(manifest, Default::default());
    }
}
