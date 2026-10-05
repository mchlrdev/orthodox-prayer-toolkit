//! Kind style resolution: built-in defaults, app defaults and Library
//! overrides merged into one [`StyleMap`].

use std::sync::LazyLock;

use indexmap::{IndexMap, IndexSet};
use serde::{Deserialize, Serialize};

use crate::model::{KindStyle, StyleMap};

fn style(font_size: &str, color: &str) -> KindStyle {
    KindStyle {
        font_size: font_size.into(),
        color: color.into(),
        font_weight: "400".into(),
        font_style: "normal".into(),
        initial_cap: None,
        indicate: None,
        html_tag: None,
        text_align: None,
        extra: IndexMap::new(),
    }
}

/// Fallback when a Kind has no app or Library style.
pub static FALLBACK_KIND_STYLE: LazyLock<KindStyle> = LazyLock::new(|| style("1rem", "base"));

/// Recommended styles for the preset Kinds (heading, subheading, annotation,
/// verse), in that order.
pub static DEFAULT_KIND_STYLES: LazyLock<StyleMap> = LazyLock::new(|| {
    let tag = |s: &mut KindStyle, tag: &str| s.html_tag = Some(tag.into());
    let mut heading = style("1.125rem", "accent");
    tag(&mut heading, "h2");
    heading.indicate = Some("true".into());

    let mut subheading = style("1rem", "accent");
    tag(&mut subheading, "h3");

    let mut annotation = style("1rem", "accent");
    tag(&mut annotation, "p");
    annotation.text_align = Some("justify".into());

    let mut verse = style("1rem", "base");
    verse.initial_cap = Some("true".into());
    tag(&mut verse, "p");
    verse.text_align = Some("justify".into());

    [
        ("heading", heading),
        ("subheading", subheading),
        ("annotation", annotation),
        ("verse", verse),
    ]
    .into_iter()
    .map(|(kind, style)| (kind.to_owned(), style))
    .collect()
});

/// A possibly partial style, as read from a Library's `styles.json` or the
/// app's persisted defaults: only the tokens that are set override anything.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindStyleOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_cap: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indicate: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html_tag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_align: Option<String>,
    #[serde(flatten)]
    pub extra: IndexMap<String, String>,
}

impl KindStyleOverride {
    /// Writes every token set here over `style`.
    fn apply_to(&self, style: &mut KindStyle) {
        fn set(target: &mut String, value: &Option<String>) {
            if let Some(value) = value {
                target.clone_from(value);
            }
        }
        fn set_opt(target: &mut Option<String>, value: &Option<String>) {
            if value.is_some() {
                target.clone_from(value);
            }
        }
        set(&mut style.font_size, &self.font_size);
        set(&mut style.color, &self.color);
        set(&mut style.font_weight, &self.font_weight);
        set(&mut style.font_style, &self.font_style);
        set_opt(&mut style.initial_cap, &self.initial_cap);
        set_opt(&mut style.indicate, &self.indicate);
        set_opt(&mut style.html_tag, &self.html_tag);
        set_opt(&mut style.text_align, &self.text_align);
        for (key, value) in &self.extra {
            style.extra.insert(key.clone(), value.clone());
        }
    }
}

impl From<&KindStyle> for KindStyleOverride {
    fn from(style: &KindStyle) -> Self {
        Self {
            font_size: Some(style.font_size.clone()),
            color: Some(style.color.clone()),
            font_weight: Some(style.font_weight.clone()),
            font_style: Some(style.font_style.clone()),
            initial_cap: style.initial_cap.clone(),
            indicate: style.indicate.clone(),
            html_tag: style.html_tag.clone(),
            text_align: style.text_align.clone(),
            extra: style.extra.clone(),
        }
    }
}

/// Kind id to partial style.
pub type StyleOverrides = IndexMap<String, KindStyleOverride>;

/// Inputs of [`resolve_styles`] besides the discovered Kinds.
#[derive(Clone, Copy, Debug, Default)]
pub struct ResolveStylesOptions<'a> {
    /// App-persisted defaults, partial; they sit on top of the built-ins.
    pub app_defaults: Option<&'a StyleOverrides>,
    /// The Library's `styles.json`; wins over everything else.
    pub library_overrides: Option<&'a StyleOverrides>,
    /// Style of Kinds with no built-in default; [`FALLBACK_KIND_STYLE`] when
    /// `None`.
    pub default_preset: Option<&'a KindStyle>,
}

/// Resolves one style per Kind: built-in default (or the preset for unknown
/// Kinds), then app defaults, then Library overrides on top.
///
/// Every discovered Kind gets an entry, and so does every Kind named in the
/// app defaults, the Library overrides and the built-ins. Entries appear in
/// that order of first mention.
pub fn resolve_styles<K: AsRef<str>>(
    discovered_kinds: impl IntoIterator<Item = K>,
    options: &ResolveStylesOptions<'_>,
) -> StyleMap {
    let preset = options.default_preset.unwrap_or(&FALLBACK_KIND_STYLE);
    let named = |overrides: Option<&StyleOverrides>| -> Vec<String> {
        overrides.map_or_else(Vec::new, |o| o.keys().cloned().collect())
    };

    let kinds: IndexSet<String> = discovered_kinds
        .into_iter()
        .map(|kind| kind.as_ref().to_owned())
        .chain(named(options.app_defaults))
        .chain(named(options.library_overrides))
        .chain(DEFAULT_KIND_STYLES.keys().cloned())
        .collect();

    kinds
        .into_iter()
        .map(|kind| {
            let mut resolved = DEFAULT_KIND_STYLES.get(&kind).unwrap_or(preset).clone();
            for overrides in [options.app_defaults, options.library_overrides]
                .into_iter()
                .flatten()
            {
                if let Some(over) = overrides.get(&kind) {
                    over.apply_to(&mut resolved);
                }
            }
            (kind, resolved)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overrides(json: &str) -> StyleOverrides {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn defaults_for_presets_and_fallback_for_unknown() {
        let styles = resolve_styles(["annotation", "custom-kind"], &Default::default());
        assert_eq!(styles["annotation"], DEFAULT_KIND_STYLES["annotation"]);
        assert_eq!(styles["custom-kind"], *FALLBACK_KIND_STYLE);
        let order: Vec<_> = styles.keys().map(String::as_str).collect();
        assert_eq!(
            order,
            [
                "annotation",
                "custom-kind",
                "heading",
                "subheading",
                "verse"
            ]
        );
    }

    #[test]
    fn builtin_defaults() {
        let d = &*DEFAULT_KIND_STYLES;
        assert_eq!(d["heading"].html_tag.as_deref(), Some("h2"));
        assert_eq!(d["heading"].indicate.as_deref(), Some("true"));
        assert_eq!(d["subheading"].html_tag.as_deref(), Some("h3"));
        assert_eq!(d["verse"].html_tag.as_deref(), Some("p"));
        assert_eq!(d["verse"].font_size, "1rem");
        assert_eq!(d["verse"].text_align.as_deref(), Some("justify"));
        assert_eq!(d["annotation"].html_tag.as_deref(), Some("p"));
        assert_eq!(d["annotation"].text_align.as_deref(), Some("justify"));
        assert_eq!(FALLBACK_KIND_STYLE.html_tag, None);
    }

    #[test]
    fn app_defaults_without_text_align_keep_builtin_align() {
        let app = overrides(
            r#"{"verse":{"fontSize":"1rem","color":"base","fontWeight":"400","fontStyle":"normal"},
                "annotation":{"fontSize":"1rem","color":"accent","fontWeight":"400","fontStyle":"normal"}}"#,
        );
        let options = ResolveStylesOptions {
            app_defaults: Some(&app),
            ..Default::default()
        };
        let styles = resolve_styles(["verse", "annotation"], &options);
        assert_eq!(styles["verse"].text_align.as_deref(), Some("justify"));
        assert_eq!(styles["annotation"].text_align.as_deref(), Some("justify"));
    }

    #[test]
    fn library_overrides_win_over_app_defaults() {
        let app = overrides(r#"{"verse":{"fontSize":"2rem","fontWeight":"700","htmlTag":"div"}}"#);
        let library = overrides(r#"{"verse":{"fontSize":"1.5rem","htmlTag":"blockquote"}}"#);
        let options = ResolveStylesOptions {
            app_defaults: Some(&app),
            library_overrides: Some(&library),
            ..Default::default()
        };
        let verse = &resolve_styles(["verse"], &options)["verse"];
        assert_eq!(verse.font_size, "1.5rem");
        assert_eq!(verse.font_weight, "700");
        assert_eq!(verse.html_tag.as_deref(), Some("blockquote"));
        assert_eq!(verse.initial_cap.as_deref(), Some("true"));
    }

    #[test]
    fn partial_library_overrides_fill_from_defaults() {
        let library = overrides(r##"{"verse":{"color":"#8b2942"}}"##);
        let options = ResolveStylesOptions {
            library_overrides: Some(&library),
            ..Default::default()
        };
        let verse = &resolve_styles(["verse"], &options)["verse"];
        assert_eq!(verse.color, "#8b2942");
        assert_eq!(verse.font_size, DEFAULT_KIND_STYLES["verse"].font_size);
    }

    #[test]
    fn library_only_kinds_and_custom_preset() {
        let library = overrides(r#"{"epistle":{"fontStyle":"italic","x-custom":"1"}}"#);
        let preset = style("2rem", "accent");
        let options = ResolveStylesOptions {
            library_overrides: Some(&library),
            default_preset: Some(&preset),
            ..Default::default()
        };
        let styles = resolve_styles(["other"], &options);
        assert_eq!(styles["other"], preset);
        assert_eq!(styles["epistle"].font_size, "2rem");
        assert_eq!(styles["epistle"].font_style, "italic");
        assert_eq!(styles["epistle"].extra["x-custom"], "1");
    }
}
