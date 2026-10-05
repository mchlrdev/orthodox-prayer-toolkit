//! Single-Variant flat export.

use std::fmt;

use serde_json::{Map, Value};

use crate::model::{Block, FlatBlock, FlatPrayer, InlineContent, Prayer, Translation, VariantKey};

/// Export of a Variant the prayer does not have.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VariantNotFound {
    pub lang: String,
    pub variant: String,
}

impl VariantNotFound {
    pub(crate) fn new(key: VariantKey<'_>) -> Self {
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

/// Flat export of one Variant.
///
/// Blocks without a translation for the Variant are omitted unless
/// `include_blocks_without_translation` is set; then they stay as empty
/// slots shaped like their other translations.
pub fn export_variant(
    prayer: &Prayer,
    key: VariantKey<'_>,
    include_blocks_without_translation: bool,
) -> Result<FlatPrayer, VariantNotFound> {
    let meta = prayer
        .variants
        .iter()
        .find(|v| v.key() == key)
        .ok_or_else(|| VariantNotFound::new(key))?;

    let structure = prayer
        .structure
        .iter()
        .filter_map(|block| match block.translation(key) {
            Some(tr) => Some(flat_block(block, tr.text.clone(), tr.lines.clone())),
            None if include_blocks_without_translation => Some(empty_slot(block)),
            None => None,
        })
        .collect();

    Ok(FlatPrayer {
        id: prayer.id.clone(),
        title: meta.title.clone(),
        prayer_type: prayer.prayer_type.clone(),
        lang: key.lang.to_owned(),
        variant: key.variant.to_owned(),
        book: prayer.book.clone(),
        occasion: prayer.occasion.clone(),
        tone: prayer.tone,
        description: prayer.description.clone(),
        license: meta.license.clone(),
        source: meta.source.clone(),
        structure,
        meta: prayer.meta.clone(),
    })
}

/// The exact text the app writes for a flat export to `*.flat.json`:
/// 2-space pretty JSON, trailing newline, keys in the order the TypeScript
/// core wrote them (the `FlatPrayer` struct order differs).
pub fn flat_prayer_json(flat: &FlatPrayer) -> String {
    let mut doc = Map::new();
    doc.insert("id".into(), flat.id.clone().into());
    doc.insert("title".into(), flat.title.clone().into());
    doc.insert("type".into(), flat.prayer_type.clone().into());
    doc.insert("lang".into(), flat.lang.clone().into());
    doc.insert("variant".into(), flat.variant.clone().into());
    doc.insert("license".into(), flat.license.clone().into());
    doc.insert("source".into(), flat.source.clone().into());
    doc.insert(
        "structure".into(),
        serde_json::to_value(&flat.structure).expect("flat blocks serialize"),
    );
    if let Some(book) = &flat.book {
        doc.insert("book".into(), book.clone().into());
    }
    if let Some(occasion) = &flat.occasion {
        doc.insert("occasion".into(), occasion.clone().into());
    }
    if let Some(tone) = flat.tone {
        doc.insert("tone".into(), tone.into());
    }
    if let Some(description) = &flat.description {
        doc.insert("description".into(), description.clone().into());
    }
    if let Some(meta) = &flat.meta {
        doc.insert(
            "meta".into(),
            serde_json::to_value(meta).expect("meta serializes"),
        );
    }
    let mut text = serde_json::to_string_pretty(&Value::Object(doc)).expect("JSON value");
    text.push('\n');
    text
}

fn flat_block(
    block: &Block,
    text: Option<InlineContent>,
    lines: Option<Vec<InlineContent>>,
) -> FlatBlock {
    FlatBlock {
        id: block.id.clone(),
        kind: block.kind.clone(),
        text,
        lines,
    }
}

/// Empty slot shaped like the first translation that has content keys:
/// `lines: []` for verse-like blocks, else `text: ""`.
fn empty_slot(block: &Block) -> FlatBlock {
    let verse_like = block
        .translations
        .iter()
        .find_map(shape_of)
        .is_some_and(|shape| shape == Shape::Lines);
    if verse_like {
        flat_block(block, None, Some(Vec::new()))
    } else {
        flat_block(block, Some(InlineContent::default()), None)
    }
}

#[derive(PartialEq)]
enum Shape {
    Lines,
    Text,
}

fn shape_of(tr: &Translation) -> Option<Shape> {
    if tr.lines.is_some() {
        Some(Shape::Lines)
    } else if tr.text.is_some() {
        Some(Shape::Text)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prayer() -> Prayer {
        serde_json::from_str(
            r#"{"id":"shape","type":"prayer","tone":null,
            "variants":[
              {"lang":"de","variant":"standard","title":"T","license":"u","source":"s"},
              {"lang":"en","variant":"standard","title":"T","license":"u","source":"s"}],
            "structure":[
              {"id":"v1","kind":"verse","translations":[
                {"lang":"de","variant":"standard","lines":["a","b"]}]},
              {"id":"a1","kind":"annotation","translations":[
                {"lang":"de","variant":"standard","text":"x"}]}]}"#,
        )
        .unwrap()
    }

    const EN: VariantKey<'static> = VariantKey {
        lang: "en",
        variant: "standard",
    };

    #[test]
    fn omits_blocks_without_translation() {
        let flat = export_variant(&prayer(), EN, false).unwrap();
        assert!(flat.structure.is_empty());
    }

    #[test]
    fn empty_slots_follow_sibling_shape() {
        let flat = export_variant(&prayer(), EN, true).unwrap();
        assert_eq!(flat.structure[0].lines, Some(Vec::new()));
        assert_eq!(flat.structure[0].text, None);
        assert_eq!(flat.structure[1].text, Some(InlineContent::default()));
        assert_eq!(flat.tone, Some(None));
    }

    #[test]
    fn unknown_variant_is_an_error() {
        let key = VariantKey {
            lang: "fr",
            variant: "standard",
        };
        let err = export_variant(&prayer(), key, false).unwrap_err();
        assert_eq!(
            err.to_string(),
            "Variant not found: lang=\"fr\" variant=\"standard\""
        );
    }

    #[test]
    fn json_text_uses_ts_key_order() {
        let flat = export_variant(&prayer(), EN, true).unwrap();
        let text = flat_prayer_json(&flat);
        assert!(text.ends_with("}\n"));
        let at = |k: &str| text.find(&format!("\"{k}\"")).unwrap();
        assert!(at("source") < at("structure") && at("structure") < at("tone"));
    }
}
