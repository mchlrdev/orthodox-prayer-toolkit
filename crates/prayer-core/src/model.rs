//! Prayer document types, mirroring `prayer.schema.json`.
//!
//! Field order in the structs is the order keys are written to JSON, which
//! matches what the TypeScript core writes. Optional keys are omitted when
//! absent rather than written as `null` (schema: no empty translation keys).

use indexmap::IndexMap;
use std::fmt;

use serde::{Deserialize, Serialize};

/// Canonical prayer document: shared structure, per-block translations.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Prayer {
    pub id: String,
    #[serde(rename = "type")]
    pub prayer_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occasion: Option<String>,
    /// `None`: key absent. `Some(None)`: explicit `null`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    pub tone: Option<Option<u8>>,
    /// Short summary of the prayer (not language-specific).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub variants: Vec<VariantMeta>,
    pub structure: Vec<Block>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Meta>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Meta {
    /// Values are strings, numbers, booleans or null (schema-enforced).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom: Option<serde_json::Map<String, serde_json::Value>>,
}

/// One language + edition of the prayer, e.g. `de` / `standard`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct VariantMeta {
    pub lang: String,
    pub variant: String,
    pub title: String,
    pub license: String,
    pub source: String,
}

impl VariantMeta {
    pub fn key(&self) -> VariantKey<'_> {
        VariantKey {
            lang: &self.lang,
            variant: &self.variant,
        }
    }
}

/// Export of a Variant the prayer does not have.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VariantNotFound {
    pub lang: String,
    pub variant: String,
}

impl VariantNotFound {
    pub fn new(key: VariantKey<'_>) -> Self {
        Self {
            lang: key.lang.to_owned(),
            variant: key.variant.to_owned(),
        }
    }
}

impl fmt::Display for VariantNotFound {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Variant not found: lang=\"{}\" variant=\"{}\"",
            self.lang, self.variant
        )
    }
}

impl std::error::Error for VariantNotFound {}

/// Borrowed `lang` + `variant` pair identifying a Variant.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct VariantKey<'a> {
    pub lang: &'a str,
    pub variant: &'a str,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Block {
    pub id: String,
    pub kind: String,
    pub translations: Vec<Translation>,
}

impl Block {
    pub fn translation(&self, key: VariantKey<'_>) -> Option<&Translation> {
        self.translations.iter().find(|t| t.key() == key)
    }
}

/// Text of one Block in one Variant: text-based kinds use `text`, verse uses
/// `lines`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Translation {
    pub lang: String,
    pub variant: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<InlineContent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<InlineContent>>,
}

impl Translation {
    pub fn key(&self) -> VariantKey<'_> {
        VariantKey {
            lang: &self.lang,
            variant: &self.variant,
        }
    }
}

/// Plain string, or runs when inline notes are present. Stored as a string
/// whenever there are no notes.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum InlineContent {
    Plain(String),
    Runs(Vec<TextRun>),
}

impl InlineContent {
    /// Runs as stored (not normalized); an empty string has no runs.
    pub fn to_runs(&self) -> Vec<TextRun> {
        match self {
            Self::Plain(text) if text.is_empty() => Vec::new(),
            Self::Plain(text) => vec![TextRun::text(text.as_str())],
            Self::Runs(runs) => runs.clone(),
        }
    }

    /// All run texts concatenated.
    pub fn plain_text(&self) -> String {
        match self {
            Self::Plain(text) => text.clone(),
            Self::Runs(runs) => runs.iter().map(|r| r.text.as_str()).collect(),
        }
    }
}

impl Default for InlineContent {
    fn default() -> Self {
        Self::Plain(String::new())
    }
}

impl From<&str> for InlineContent {
    fn from(text: &str) -> Self {
        Self::Plain(text.to_owned())
    }
}

/// Inline segment: prayer text or a liturgical note/rubric.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextRun {
    #[serde(rename = "t")]
    pub role: RunRole,
    #[serde(rename = "v")]
    pub text: String,
}

impl TextRun {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            role: RunRole::Text,
            text: text.into(),
        }
    }

    pub fn note(text: impl Into<String>) -> Self {
        Self {
            role: RunRole::Note,
            text: text.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunRole {
    Text,
    Note,
}

/// Flat single-variant export for downstream consumers. Fields are in the
/// order the export writes them: required keys first, then the optional ones.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FlatPrayer {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub prayer_type: String,
    pub lang: String,
    pub variant: String,
    pub license: String,
    pub source: String,
    pub structure: Vec<FlatBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occasion: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "double_option"
    )]
    pub tone: Option<Option<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Meta>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FlatBlock {
    pub id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<InlineContent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<InlineContent>>,
}

/// Presentation of one Kind. Values are CSS-like strings, as in the
/// library's `styles.json`; unknown keys are kept in `extra`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindStyle {
    pub font_size: String,
    pub color: String,
    pub font_weight: String,
    pub font_style: String,
    /// `"true"`: the first letter uses Accent (liturgical initial).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_cap: Option<String>,
    /// `"true"`: the editor marks blocks of this Kind.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indicate: Option<String>,
    /// Preferred HTML element for this Kind in HTML export.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html_tag: Option<String>,
    /// `left`, `center` or `justify`; missing means left.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_align: Option<String>,
    #[serde(flatten)]
    pub extra: IndexMap<String, String>,
}

/// Kind id to style, in insertion order.
pub type StyleMap = IndexMap<String, KindStyle>;

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

/// One schema or rule violation: JSON-pointer-like `path` plus a message.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationError {
    pub path: String,
    pub message: String,
}

/// Optional `manifest.json` at the Library root.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryManifest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_variant: Option<DefaultVariant>,
    /// Style-name prefix stem for Layout export, without trailing `_`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_prefix_stem: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DefaultVariant {
    pub lang: String,
    pub variant: String,
}

/// Several files in a Library claiming the same prayer id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IdCollision {
    pub id: String,
    pub paths: Vec<String>,
}

/// Built-in Kinds. Not a schema enum: Kinds are open strings, these are the
/// editor's fixed presets (not renameable or deletable, styles editable).
pub const KIND_PRESETS: [&str; 4] = ["heading", "subheading", "annotation", "verse"];

pub fn is_kind_preset(kind: &str) -> bool {
    KIND_PRESETS.contains(&kind)
}

/// Display label for a Kind id: presets title-cased, custom ids as-is.
pub fn kind_display_label(kind: &str) -> &str {
    match kind {
        "heading" => "Heading",
        "subheading" => "Subheading",
        "annotation" => "Annotation",
        "verse" => "Verse",
        other => other,
    }
}

/// Distinguishes an absent key from an explicit `null`.
mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer, T: Serialize>(
        value: &Option<Option<T>>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        match value {
            Some(inner) => inner.serialize(serializer),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
        deserializer: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Option::<T>::deserialize(deserializer).map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tone_keeps_absent_and_null_apart() {
        let base = r#"{"id":"x","type":"t","variants":[],"structure":[]}"#;
        let absent: Prayer = serde_json::from_str(base).unwrap();
        assert_eq!(absent.tone, None);
        let null: Prayer = serde_json::from_str(
            r#"{"id":"x","type":"t","tone":null,"variants":[],"structure":[]}"#,
        )
        .unwrap();
        assert_eq!(null.tone, Some(None));
        assert!(
            serde_json::to_string(&null)
                .unwrap()
                .contains(r#""tone":null"#)
        );
        assert!(!serde_json::to_string(&absent).unwrap().contains("tone"));
    }

    #[test]
    fn inline_content_is_string_or_runs() {
        let plain: InlineContent = serde_json::from_str(r#""Amen""#).unwrap();
        assert_eq!(plain, InlineContent::from("Amen"));
        let runs: InlineContent =
            serde_json::from_str(r#"[{"t":"text","v":"A "},{"t":"note","v":"(x)"}]"#).unwrap();
        assert_eq!(
            runs,
            InlineContent::Runs(vec![TextRun::text("A "), TextRun::note("(x)")])
        );
    }

    #[test]
    fn fixture_round_trips_byte_equal() {
        let raw = include_str!("../../../packages/core/tests/fixtures/valid-tropar-prokopios.json");
        let prayer: Prayer = serde_json::from_str(raw).unwrap();
        let written = serde_json::to_string_pretty(&prayer).unwrap() + "\n";
        assert_eq!(written, raw);
    }
}
