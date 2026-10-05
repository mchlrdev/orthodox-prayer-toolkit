//! Logic of the Export dialog: formats, options, defaults, file names and the
//! export itself (through `prayer-core`).
//!
//! Rewrite of `session/exportPick.ts`, `exportPrayerVariant.ts`,
//! `layoutPrefix.ts` and the option handling of `components/ExportModal.tsx`.
//! Nothing here touches the disk: [`export_prayer`] turns a [`Prayer`] (the
//! in-memory Session draft, unsaved changes included) into bytes plus a
//! default file name; the UI asks for the target path with a save dialog and
//! [`Session::export_variant`](crate::session::Session::export_variant)
//! writes it and remembers the options.

use indexmap::IndexMap;
use prayer_core::export_docx::export_layout_docx;
use prayer_core::export_html::{ExportHtmlOptions, Wrapper, export_html};
use prayer_core::export_rtf::export_layout_rtf;
use prayer_core::export_variant::{export_variant, flat_prayer_json};
use prayer_core::html_tags::is_allowed_wrapper_tag;
use prayer_core::kinds::compare_locale;
use prayer_core::layout::LayoutOptions;
use prayer_core::parse_html_attributes::parse_html_attributes;
use prayer_core::style_prefix::{is_valid_style_prefix_stem, resolve_library_style_prefix_stem};
use prayer_core::tag_map::tag_map_from_styles;
use prayer_core::validate::validate;
use prayer_core::{LibraryManifest, Prayer, StyleMap, VariantNotFound};

use crate::edit::VariantRef;
use crate::prefs::{ExportPrefs, ExportPrefsPatch, HtmlExportPrefs};
use crate::session::Notice;

pub use crate::prefs::LayoutFormat;

/// HTML export settings: Kind to tag map plus the optional wrapper element.
/// The same shape the per-prayer export preferences remember.
pub type HtmlExportOptions = HtmlExportPrefs;

/// Output format chosen in the dialog.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ExportFormat {
    #[default]
    FlatJson,
    Html,
    Layout,
}

impl ExportFormat {
    pub const ALL: [ExportFormat; 3] = [Self::FlatJson, Self::Html, Self::Layout];

    /// Label in the Format select.
    pub fn label(self) -> &'static str {
        match self {
            Self::FlatJson => "Flat JSON",
            Self::Html => "HTML",
            Self::Layout => "Layout",
        }
    }
}

/// Layout (Place) export settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LayoutExportOptions {
    pub format: LayoutFormat,
    /// Style-name prefix stem; empty means bare Kind names.
    pub prefix_stem: String,
}

/// Format plus the options only that format has.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExportTarget {
    FlatJson,
    Html(HtmlExportOptions),
    Layout(LayoutExportOptions),
}

/// Everything an export needs besides the prayer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportRequest {
    pub variant: VariantRef,
    /// Keep Blocks without a translation in this Variant as empty slots.
    pub include_blocks_without_translation: bool,
    pub target: ExportTarget,
}

/// Why an export is not possible. [`ExportError::notice`] gives the toast.
#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    /// The prayer fails validation (toast "Cannot export").
    #[error("Prayer is invalid.")]
    PrayerInvalid,
    /// The prayer file is not JSON.
    #[error("{0}")]
    NotJson(String),
    #[error(transparent)]
    VariantNotFound(#[from] VariantNotFound),
    /// Wrapper attributes that do not parse (messages joined with `; `).
    #[error("{0}")]
    WrapperAttributes(String),
    #[error("Wrapper tag \"{0}\" is not allowed")]
    WrapperTag(String),
    #[error("Style prefix \"{0}\" must be empty or a letter followed by letters and digits")]
    PrefixStem(String),
    #[error(transparent)]
    Docx(#[from] prayer_core::export_docx::ExportDocxError),
    /// Writing the target file failed.
    #[error("{0}")]
    Write(String),
}

impl ExportError {
    /// The toast of Electron: "Cannot export — Prayer is invalid." for an
    /// invalid prayer, "Export failed" for everything else.
    pub fn notice(&self) -> Notice {
        match self {
            Self::PrayerInvalid => Notice::error("Cannot export", self.to_string()),
            _ => Notice::error("Export failed", self.to_string()),
        }
    }
}

/// Parses and validates the text of a prayer file for export (a prayer that
/// is not open in the Session). Not JSON: [`ExportError::NotJson`]; fails the
/// schema: [`ExportError::PrayerInvalid`].
pub fn load_exportable(text: &str) -> Result<Prayer, ExportError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| ExportError::NotJson(e.to_string()))?;
    validate(&value).map_err(|_| ExportError::PrayerInvalid)
}

/// File produced by an export.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportOutput {
    /// Default name for the save dialog.
    pub file_name: String,
    pub bytes: Vec<u8>,
}

impl ExportRequest {
    /// Settings the Export button is disabled for: wrapper attributes that do
    /// not parse or a wrapper tag outside the allowlist (only while the
    /// wrapper is on), and an invalid Layout prefix stem.
    pub fn check(&self) -> Result<(), ExportError> {
        match &self.target {
            ExportTarget::FlatJson => Ok(()),
            ExportTarget::Html(html) => {
                if html.wrapper_enabled {
                    if !is_allowed_wrapper_tag(&html.wrapper_tag) {
                        return Err(ExportError::WrapperTag(html.wrapper_tag.clone()));
                    }
                    wrapper_attributes(&html.wrapper_attributes)?;
                }
                Ok(())
            }
            ExportTarget::Layout(layout) => {
                if is_valid_style_prefix_stem(&layout.prefix_stem) {
                    Ok(())
                } else {
                    Err(ExportError::PrefixStem(layout.prefix_stem.clone()))
                }
            }
        }
    }

    /// File extension without the dot: `flat.json`, `html`, `docx`, `rtf`.
    pub fn extension(&self) -> &'static str {
        match &self.target {
            ExportTarget::FlatJson => "flat.json",
            ExportTarget::Html(_) => "html",
            ExportTarget::Layout(l) => match l.format {
                LayoutFormat::Docx => "docx",
                LayoutFormat::Rtf => "rtf",
            },
        }
    }

    /// `{id}.{lang}.{variant}.{ext}`, the default name in the save dialog.
    pub fn file_name(&self, prayer_id: &str) -> String {
        format!(
            "{prayer_id}.{}.{}.{}",
            self.variant.lang,
            self.variant.variant,
            self.extension()
        )
    }

    /// Title of the native save dialog.
    pub fn dialog_title(&self) -> &'static str {
        match &self.target {
            ExportTarget::FlatJson => "Export flat variant JSON",
            ExportTarget::Html(_) => "Export HTML",
            ExportTarget::Layout(l) => match l.format {
                LayoutFormat::Docx => "Export Layout DOCX",
                LayoutFormat::Rtf => "Export Layout RTF",
            },
        }
    }

    /// What is remembered per prayer after a successful export: the
    /// include-empty flag always, HTML or Layout settings for those formats.
    pub fn prefs_patch(&self) -> ExportPrefsPatch {
        ExportPrefsPatch {
            include_blocks_without_translation: self.include_blocks_without_translation,
            html: match &self.target {
                ExportTarget::Html(html) => Some(html.clone()),
                _ => None,
            },
            layout: match &self.target {
                ExportTarget::Layout(l) => Some((l.format, l.prefix_stem.clone())),
                _ => None,
            },
        }
    }
}

fn wrapper_attributes(raw: &str) -> Result<IndexMap<String, String>, ExportError> {
    parse_html_attributes(raw).map_err(|errors| {
        ExportError::WrapperAttributes(
            errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; "),
        )
    })
}

/// Exports one Variant of `prayer` (always the in-memory prayer, unsaved
/// changes included) in the requested format, via `prayer-core`.
pub fn export_prayer(
    prayer: &Prayer,
    request: &ExportRequest,
) -> Result<ExportOutput, ExportError> {
    request.check()?;
    let key = request.variant.key();
    let include = request.include_blocks_without_translation;
    let bytes = match &request.target {
        ExportTarget::FlatJson => {
            let flat = export_variant(prayer, key, include)?;
            flat_prayer_json(&flat).into_bytes()
        }
        ExportTarget::Html(html) => {
            let wrapper = if html.wrapper_enabled {
                Some(Wrapper {
                    tag: Some(html.wrapper_tag.clone()),
                    attributes: wrapper_attributes(&html.wrapper_attributes)?,
                })
            } else {
                None
            };
            let options = ExportHtmlOptions {
                key,
                tag_map: &html.tag_map,
                wrapper,
                include_blocks_without_translation: include,
            };
            export_html(prayer, &options)?.into_bytes()
        }
        ExportTarget::Layout(layout) => {
            let options = LayoutOptions::new(key.lang, key.variant)
                .with_prefix_stem(&layout.prefix_stem)
                .with_blocks_without_translation(include);
            match layout.format {
                LayoutFormat::Docx => export_layout_docx(prayer, &options)?,
                LayoutFormat::Rtf => export_layout_rtf(prayer, &options)?.into_bytes(),
            }
        }
    };
    Ok(ExportOutput {
        file_name: request.file_name(&prayer.id),
        bytes,
    })
}

/// Prefill for the dialog's Language: the Library default Variant when the
/// prayer has it, else the first Variant; `None` for a prayer without
/// Variants.
pub fn pick_export_variant(
    prayer: &Prayer,
    library_default: Option<&VariantRef>,
) -> Option<VariantRef> {
    library_default
        .and_then(|d| prayer.variants.iter().find(|v| v.key() == d.key()))
        .or_else(|| prayer.variants.first())
        .map(VariantRef::from)
}

/// Layout prefix stem the dialog starts with: the stem remembered for the
/// prayer when there is one (an empty stem means bare names), else the
/// Library stem, else `opt`.
pub fn resolve_export_prefix_stem(
    prefs_stem: Option<&str>,
    manifest: Option<&LibraryManifest>,
) -> String {
    match prefs_stem {
        Some(stem) => stem.to_owned(),
        None => {
            resolve_library_style_prefix_stem(manifest.and_then(|m| m.style_prefix_stem.as_deref()))
                .to_owned()
        }
    }
}

/// Kinds listed in the HTML tag table: those the prayer uses plus those with
/// a style, sorted.
pub fn kinds_for_tag_map(prayer: &Prayer, styles: &StyleMap) -> Vec<String> {
    let mut kinds: Vec<String> = Vec::new();
    for kind in prayer
        .structure
        .iter()
        .map(|b| b.kind.as_str())
        .chain(styles.keys().map(String::as_str))
    {
        if !kinds.iter().any(|k| k == kind) {
            kinds.push(kind.to_owned());
        }
    }
    kinds.sort_by(|a, b| compare_locale(a, b));
    kinds
}

/// Variants offered in the Language select: `lang / variant`, sorted by that
/// label.
pub fn language_options(prayer: &Prayer) -> Vec<VariantRef> {
    let mut options: Vec<VariantRef> = prayer.variants.iter().map(VariantRef::from).collect();
    options.sort_by(|a, b| compare_locale(&variant_label(a), &variant_label(b)));
    options
}

/// `lang / variant`.
pub fn variant_label(variant: &VariantRef) -> String {
    format!("{} / {}", variant.lang, variant.variant)
}

/// State of the Export dialog when it opens. Format and language start fresh
/// each time; the rest comes from what was remembered for this prayer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportDefaults {
    /// `None`: the prayer has no Variant (hint "Add a language in prayer
    /// settings before exporting."; Export stays disabled).
    pub variant: Option<VariantRef>,
    /// The Language select's options, see [`language_options`].
    pub languages: Vec<VariantRef>,
    pub format: ExportFormat,
    pub include_blocks_without_translation: bool,
    pub html: HtmlExportOptions,
    pub layout: LayoutExportOptions,
    /// Kinds for the tag table, see [`kinds_for_tag_map`].
    pub kinds: Vec<String>,
    /// The stem "Reset" in the Layout section goes back to.
    pub library_prefix_stem: String,
}

impl ExportDefaults {
    /// Defaults for `prayer`. `library_default` is the manifest default
    /// Variant, `styles` the resolved Kind styles (for the default tags) and
    /// `saved` the preferences remembered after the last export.
    pub fn new(
        prayer: &Prayer,
        manifest: Option<&LibraryManifest>,
        styles: &StyleMap,
        saved: Option<&ExportPrefs>,
    ) -> Self {
        let library_default = manifest
            .and_then(|m| m.default_variant.as_ref())
            .map(|d| VariantRef::new(d.lang.as_str(), d.variant.as_str()));
        let default_html = Self::default_html(styles);
        let html = saved.and_then(|s| s.html.clone()).unwrap_or(default_html);
        Self {
            variant: pick_export_variant(prayer, library_default.as_ref()),
            languages: language_options(prayer),
            format: ExportFormat::FlatJson,
            include_blocks_without_translation: saved
                .and_then(|s| s.include_blocks_without_translation)
                .unwrap_or(false),
            html,
            layout: LayoutExportOptions {
                format: saved
                    .and_then(|s| s.layout_format)
                    .unwrap_or(LayoutFormat::Docx),
                prefix_stem: resolve_export_prefix_stem(
                    saved.and_then(|s| s.layout_prefix_stem.as_deref()),
                    manifest,
                ),
            },
            kinds: kinds_for_tag_map(prayer, styles),
            library_prefix_stem: resolve_library_style_prefix_stem(
                manifest.and_then(|m| m.style_prefix_stem.as_deref()),
            )
            .to_owned(),
        }
    }

    /// Tags from the Kind styles, no wrapper (the "Reset tags" state).
    pub fn default_html(styles: &StyleMap) -> HtmlExportOptions {
        HtmlExportPrefs {
            tag_map: tag_map_from_styles(styles),
            wrapper_enabled: false,
            wrapper_tag: "article".to_owned(),
            wrapper_attributes: String::new(),
        }
    }

    /// "Reset tags".
    pub fn reset_tag_map(&mut self, styles: &StyleMap) {
        self.html.tag_map = tag_map_from_styles(styles);
    }

    /// "Reset" of the Layout style prefix.
    pub fn reset_prefix_stem(&mut self) {
        self.layout.prefix_stem = self.library_prefix_stem.clone();
    }

    /// The request for the current dialog state; `None` without a language.
    pub fn request(&self) -> Option<ExportRequest> {
        Some(ExportRequest {
            variant: self.variant.clone()?,
            include_blocks_without_translation: self.include_blocks_without_translation,
            target: match self.format {
                ExportFormat::FlatJson => ExportTarget::FlatJson,
                ExportFormat::Html => ExportTarget::Html(self.html.clone()),
                ExportFormat::Layout => ExportTarget::Layout(self.layout.clone()),
            },
        })
    }

    /// Whether Export is enabled: a language is chosen and the settings of
    /// the current format are valid.
    pub fn can_export(&self) -> bool {
        self.request().is_some_and(|r| r.check().is_ok())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prayer_core::resolve_styles::{ResolveStylesOptions, resolve_styles};
    use prayer_core::{DefaultVariant, StyleOverrides};
    use serde_json::json;

    fn prayer() -> Prayer {
        serde_json::from_value(json!({
            "id": "gebet",
            "type": "prayer",
            "variants": [
                {"lang": "de", "variant": "standard", "title": "Gebet", "license": "CC0", "source": "x"},
                {"lang": "en", "variant": "standard", "title": "Prayer", "license": "CC0", "source": "y"}
            ],
            "structure": [
                {"id": "h", "kind": "heading", "translations": [
                    {"lang": "de", "variant": "standard", "text": "Titel"}]},
                {"id": "v", "kind": "verse", "translations": [
                    {"lang": "de", "variant": "standard", "lines": ["Eins", "Zwei"]}]}
            ]
        }))
        .unwrap()
    }

    fn styles(prayer: &Prayer) -> StyleMap {
        resolve_styles(
            prayer.structure.iter().map(|b| b.kind.clone()),
            &ResolveStylesOptions {
                library_overrides: Some(&StyleOverrides::new()),
                ..Default::default()
            },
        )
    }

    fn manifest(stem: Option<&str>, default: Option<(&str, &str)>) -> LibraryManifest {
        LibraryManifest {
            description: None,
            default_variant: default.map(|(l, v)| DefaultVariant {
                lang: l.into(),
                variant: v.into(),
            }),
            style_prefix_stem: stem.map(Into::into),
        }
    }

    fn request(target: ExportTarget) -> ExportRequest {
        ExportRequest {
            variant: VariantRef::new("de", "standard"),
            include_blocks_without_translation: false,
            target,
        }
    }

    // Checklist 16: Language prefilled with the Library default, else first.
    #[test]
    fn variant_prefill_prefers_library_default() {
        let p = prayer();
        let en = VariantRef::new("en", "standard");
        assert_eq!(pick_export_variant(&p, Some(&en)), Some(en));
        let missing = VariantRef::new("fr", "standard");
        assert_eq!(
            pick_export_variant(&p, Some(&missing)),
            Some(VariantRef::new("de", "standard"))
        );
        assert_eq!(
            pick_export_variant(&p, None),
            Some(VariantRef::new("de", "standard"))
        );
        let mut none = p;
        none.variants.clear();
        assert_eq!(pick_export_variant(&none, None), None);
    }

    // Checklist 16: format resets to Flat JSON, include-empty off, DOCX,
    // Library prefix chain, tags from styles, no wrapper.
    #[test]
    fn defaults_without_saved_prefs() {
        let p = prayer();
        let s = styles(&p);
        let m = manifest(Some("lit"), Some(("en", "standard")));
        let d = ExportDefaults::new(&p, Some(&m), &s, None);
        assert_eq!(d.variant, Some(VariantRef::new("en", "standard")));
        assert_eq!(
            d.languages,
            vec![
                VariantRef::new("de", "standard"),
                VariantRef::new("en", "standard")
            ]
        );
        assert_eq!(d.format, ExportFormat::FlatJson);
        assert!(!d.include_blocks_without_translation);
        assert_eq!(d.layout.format, LayoutFormat::Docx);
        assert_eq!(d.layout.prefix_stem, "lit");
        assert_eq!(d.library_prefix_stem, "lit");
        assert!(!d.html.wrapper_enabled);
        assert_eq!(d.html.wrapper_tag, "article");
        assert_eq!(d.html.wrapper_attributes, "");
        assert_eq!(d.html.tag_map["heading"], "h2");
        assert_eq!(d.html.tag_map["verse"], "p");
        assert_eq!(d.kinds, ["annotation", "heading", "subheading", "verse"]);
        assert!(d.can_export());

        let bare = ExportDefaults::new(&p, None, &s, None);
        assert_eq!(bare.layout.prefix_stem, "opt");
    }

    // Checklist 16: remembered prefs win; an empty remembered stem means bare
    // names and beats the Library stem.
    #[test]
    fn defaults_use_saved_prefs() {
        let p = prayer();
        let s = styles(&p);
        let m = manifest(Some("lit"), None);
        let saved = ExportPrefs {
            include_blocks_without_translation: Some(true),
            html: Some(HtmlExportPrefs {
                tag_map: IndexMap::from([("verse".to_owned(), "p".to_owned())]),
                wrapper_enabled: true,
                wrapper_tag: "section".into(),
                wrapper_attributes: "class=\"x\"".into(),
            }),
            layout_format: Some(LayoutFormat::Rtf),
            layout_prefix_stem: Some(String::new()),
        };
        let d = ExportDefaults::new(&p, Some(&m), &s, Some(&saved));
        assert!(d.include_blocks_without_translation);
        assert_eq!(d.html.tag_map.len(), 1);
        assert!(d.html.wrapper_enabled);
        assert_eq!(d.layout.format, LayoutFormat::Rtf);
        assert_eq!(d.layout.prefix_stem, "");
        assert_eq!(d.library_prefix_stem, "lit");
        let mut d = d;
        d.reset_prefix_stem();
        assert_eq!(d.layout.prefix_stem, "lit");
        d.reset_tag_map(&s);
        assert_eq!(d.html.tag_map["heading"], "h2");
    }

    // Checklist 16: hint and disabled Export without a language.
    #[test]
    fn no_variant_cannot_export() {
        let mut p = prayer();
        p.variants.clear();
        let d = ExportDefaults::new(&p, None, &styles(&p), None);
        assert!(d.variant.is_none() && d.request().is_none() && !d.can_export());
    }

    // Checklist 16: output file names and dialog titles per format.
    #[test]
    fn file_names_and_titles() {
        let flat = request(ExportTarget::FlatJson);
        assert_eq!(flat.file_name("gebet"), "gebet.de.standard.flat.json");
        assert_eq!(flat.dialog_title(), "Export flat variant JSON");
        let html = request(ExportTarget::Html(ExportDefaults::default_html(
            &StyleMap::new(),
        )));
        assert_eq!(html.file_name("gebet"), "gebet.de.standard.html");
        assert_eq!(html.dialog_title(), "Export HTML");
        let layout = |format| {
            request(ExportTarget::Layout(LayoutExportOptions {
                format,
                prefix_stem: "opt".into(),
            }))
        };
        assert_eq!(
            layout(LayoutFormat::Docx).file_name("gebet"),
            "gebet.de.standard.docx"
        );
        assert_eq!(
            layout(LayoutFormat::Rtf).file_name("gebet"),
            "gebet.de.standard.rtf"
        );
        assert_eq!(
            layout(LayoutFormat::Docx).dialog_title(),
            "Export Layout DOCX"
        );
        assert_eq!(
            layout(LayoutFormat::Rtf).dialog_title(),
            "Export Layout RTF"
        );
    }

    // Checklist 16: Core produces every format.
    #[test]
    fn exports_each_format() {
        let p = prayer();
        let s = styles(&p);

        let flat = export_prayer(&p, &request(ExportTarget::FlatJson)).unwrap();
        let text = String::from_utf8(flat.bytes).unwrap();
        assert!(text.ends_with("}\n"));
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["title"], "Gebet");
        assert_eq!(value["structure"].as_array().unwrap().len(), 2);

        let html_opts = ExportDefaults::default_html(&s);
        let html = export_prayer(&p, &request(ExportTarget::Html(html_opts.clone()))).unwrap();
        let text = String::from_utf8(html.bytes).unwrap();
        assert!(text.contains("<h2 data-kind=\"heading\">Titel</h2>"));
        assert!(text.contains("Eins<br>Zwei"));
        assert!(!text.contains("<article"));

        let wrapped = HtmlExportPrefs {
            wrapper_enabled: true,
            wrapper_attributes: "class=\"x\"".into(),
            ..html_opts
        };
        let html = export_prayer(&p, &request(ExportTarget::Html(wrapped))).unwrap();
        let text = String::from_utf8(html.bytes).unwrap();
        assert!(text.starts_with("<article"));
        assert!(text.contains("class=\"x\""));

        let layout = |format| {
            request(ExportTarget::Layout(LayoutExportOptions {
                format,
                prefix_stem: "opt".into(),
            }))
        };
        let rtf = export_prayer(&p, &layout(LayoutFormat::Rtf)).unwrap();
        assert!(
            String::from_utf8(rtf.bytes)
                .unwrap()
                .contains("opt_heading")
        );
        let docx = export_prayer(&p, &layout(LayoutFormat::Docx)).unwrap();
        assert_eq!(docx.file_name, "gebet.de.standard.docx");
        // A DOCX is a zip; entry names are stored uncompressed.
        assert_eq!(&docx.bytes[..2], b"PK");
        let raw = String::from_utf8_lossy(&docx.bytes);
        assert!(raw.contains("word/document.xml") && raw.contains("word/styles.xml"));
    }

    // Checklist 16: include blocks without translation.
    #[test]
    fn include_blocks_without_translation_keeps_empty_slots() {
        let p = prayer();
        let mut req = request(ExportTarget::FlatJson);
        req.variant = VariantRef::new("en", "standard");
        let omitted = export_prayer(&p, &req).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&omitted.bytes).unwrap();
        assert!(v["structure"].as_array().unwrap().is_empty());
        req.include_blocks_without_translation = true;
        let kept = export_prayer(&p, &req).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&kept.bytes).unwrap();
        assert_eq!(v["structure"].as_array().unwrap().len(), 2);
    }

    // Checklist 16: invalid wrapper attributes or tag block the export.
    #[test]
    fn invalid_options_block_export() {
        let p = prayer();
        let base = ExportDefaults::default_html(&StyleMap::new());
        let bad_attrs = HtmlExportPrefs {
            wrapper_enabled: true,
            wrapper_attributes: "style=\"x\"".into(),
            ..base.clone()
        };
        let err = export_prayer(&p, &request(ExportTarget::Html(bad_attrs))).unwrap_err();
        assert_eq!(err.to_string(), "attribute \"style\" is not allowed");
        assert_eq!(err.notice().title, "Export failed");

        let bad_tag = HtmlExportPrefs {
            wrapper_enabled: true,
            wrapper_tag: "script".into(),
            ..base.clone()
        };
        assert!(matches!(
            request(ExportTarget::Html(bad_tag)).check(),
            Err(ExportError::WrapperTag(_))
        ));
        // Disabled wrapper: its fields do not matter.
        let off = HtmlExportPrefs {
            wrapper_attributes: "style=x".into(),
            ..base
        };
        assert!(request(ExportTarget::Html(off)).check().is_ok());

        let bad_stem = request(ExportTarget::Layout(LayoutExportOptions {
            format: LayoutFormat::Rtf,
            prefix_stem: "1x".into(),
        }));
        assert!(matches!(bad_stem.check(), Err(ExportError::PrefixStem(_))));
        assert!(export_prayer(&p, &bad_stem).is_err());
    }

    #[test]
    fn unknown_variant_is_export_failed() {
        let mut req = request(ExportTarget::FlatJson);
        req.variant = VariantRef::new("fr", "standard");
        let err = export_prayer(&prayer(), &req).unwrap_err();
        assert_eq!(
            err.to_string(),
            "Variant not found: lang=\"fr\" variant=\"standard\""
        );
        assert_eq!(err.notice().title, "Export failed");
    }

    // Checklist 19: "Cannot export — Prayer is invalid." for a file that is
    // not a valid prayer; "Export failed" when it is not even JSON.
    #[test]
    fn load_exportable_rules() {
        let ok = serde_json::to_string(&prayer()).unwrap();
        assert_eq!(load_exportable(&ok).unwrap(), prayer());
        let invalid = load_exportable("{\"id\": 1}").unwrap_err();
        assert!(matches!(invalid, ExportError::PrayerInvalid));
        let notice = invalid.notice();
        assert_eq!(notice.title, "Cannot export");
        assert_eq!(notice.message, "Prayer is invalid.");
        let not_json = load_exportable("{nope").unwrap_err();
        assert_eq!(not_json.notice().title, "Export failed");
    }

    // Checklist 16: preferences remembered after each successful export.
    #[test]
    fn prefs_patch_per_format() {
        let mut req = request(ExportTarget::FlatJson);
        req.include_blocks_without_translation = true;
        let patch = req.prefs_patch();
        assert!(patch.include_blocks_without_translation);
        assert!(patch.html.is_none() && patch.layout.is_none());

        let layout = request(ExportTarget::Layout(LayoutExportOptions {
            format: LayoutFormat::Rtf,
            prefix_stem: String::new(),
        }));
        assert_eq!(
            layout.prefs_patch().layout,
            Some((LayoutFormat::Rtf, String::new()))
        );
        let html = request(ExportTarget::Html(ExportDefaults::default_html(
            &StyleMap::new(),
        )));
        assert!(html.prefs_patch().html.is_some());
    }

    #[test]
    fn language_options_sorted_by_label() {
        let mut p = prayer();
        p.variants.reverse();
        let labels: Vec<_> = language_options(&p).iter().map(variant_label).collect();
        assert_eq!(labels, ["de / standard", "en / standard"]);
    }
}
