//! Layout story: the blank-styled Place model shared by the RTF and DOCX
//! serializers. One Block becomes one paragraph; `lines` become soft breaks.

use std::fmt;

use serde::Serialize;

use crate::model::{Prayer, TextRun, Translation, VariantKey};
use crate::style_prefix::style_name_with_prefix;

/// One inline run of a layout line (text or note).
pub type LayoutRun = TextRun;

/// Which Variant to export and how to name the styles.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LayoutOptions<'a> {
    pub lang: &'a str,
    pub variant: &'a str,
    /// Style-name prefix stem. Empty means bare `kind` / `note` names; callers
    /// resolve the Library/prefs chain before passing it in.
    pub prefix_stem: &'a str,
    /// Keep an empty paragraph for Blocks that have no translation in the Variant.
    pub include_blocks_without_translation: bool,
}

impl<'a> LayoutOptions<'a> {
    /// Bare style names, Blocks without translation omitted.
    pub fn new(lang: &'a str, variant: &'a str) -> Self {
        Self {
            lang,
            variant,
            prefix_stem: "",
            include_blocks_without_translation: false,
        }
    }

    pub fn with_prefix_stem(mut self, stem: &'a str) -> Self {
        self.prefix_stem = stem;
        self
    }

    pub fn with_blocks_without_translation(mut self, include: bool) -> Self {
        self.include_blocks_without_translation = include;
        self
    }

    fn key(&self) -> VariantKey<'a> {
        VariantKey {
            lang: self.lang,
            variant: self.variant,
        }
    }
}

/// One Block as a single paragraph (soft breaks between lines).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutParagraph {
    pub kind: String,
    pub style_name: String,
    /// Each entry is one visual line; serializers join lines with soft breaks.
    pub lines: Vec<Vec<LayoutRun>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutStory {
    pub note_style_name: String,
    pub paragraphs: Vec<LayoutParagraph>,
}

/// The prayer has no entry for the requested Variant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VariantNotFound {
    pub lang: String,
    pub variant: String,
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

/// Lines of one translation; a missing translation is one empty line.
fn lines_from_translation(translation: Option<&Translation>) -> Vec<Vec<LayoutRun>> {
    let Some(translation) = translation else {
        return vec![Vec::new()];
    };
    match (&translation.lines, &translation.text) {
        (Some(lines), _) => lines.iter().map(|line| line.to_runs()).collect(),
        (None, Some(text)) => vec![text.to_runs()],
        (None, None) => vec![Vec::new()],
    }
}

/// Build the layout story for one Variant of `prayer`.
pub fn build_layout_story(
    prayer: &Prayer,
    options: &LayoutOptions<'_>,
) -> Result<LayoutStory, VariantNotFound> {
    let key = options.key();
    if !prayer.variants.iter().any(|v| v.key() == key) {
        return Err(VariantNotFound {
            lang: options.lang.to_owned(),
            variant: options.variant.to_owned(),
        });
    }

    let stem = options.prefix_stem;
    let paragraphs = prayer
        .structure
        .iter()
        .filter_map(|block| {
            let translation = block.translation(key);
            if translation.is_none() && !options.include_blocks_without_translation {
                return None;
            }
            Some(LayoutParagraph {
                kind: block.kind.clone(),
                style_name: style_name_with_prefix(stem, &block.kind),
                lines: lines_from_translation(translation),
            })
        })
        .collect();

    Ok(LayoutStory {
        note_style_name: style_name_with_prefix(stem, "note"),
        paragraphs,
    })
}

#[cfg(test)]
pub(crate) mod test_support {
    use crate::model::Prayer;

    /// The shared `html-export-sample` fixture (de has heading, annotation,
    /// verse with a note; en has only the verse).
    pub fn sample_prayer() -> Prayer {
        serde_json::from_str(include_str!(
            "../tests/golden/layout/inputs/html-export-sample.json"
        ))
        .expect("fixture parses")
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::sample_prayer;
    use super::*;

    #[test]
    fn de_story_has_prefixed_names_and_note_run() {
        let story = build_layout_story(
            &sample_prayer(),
            &LayoutOptions::new("de", "standard").with_prefix_stem("opt"),
        )
        .unwrap();
        assert_eq!(story.note_style_name, "opt_note");
        let names: Vec<_> = story
            .paragraphs
            .iter()
            .map(|p| p.style_name.as_str())
            .collect();
        assert_eq!(names, ["opt_heading", "opt_annotation", "opt_verse"]);
        let verse = &story.paragraphs[2];
        assert_eq!(verse.lines.len(), 3);
        assert_eq!(
            verse.lines[1],
            [
                TextRun::text("heiliger "),
                TextRun::note("Starker"),
                TextRun::text(",")
            ]
        );
    }

    #[test]
    fn blocks_without_translation_are_omitted_or_kept_empty() {
        let prayer = sample_prayer();
        let base = LayoutOptions::new("en", "standard");
        let story = build_layout_story(&prayer, &base).unwrap();
        assert_eq!(story.paragraphs.len(), 1);
        let kept =
            build_layout_story(&prayer, &base.with_blocks_without_translation(true)).unwrap();
        assert_eq!(kept.paragraphs.len(), 3);
        assert_eq!(kept.paragraphs[0].lines, [Vec::<LayoutRun>::new()]);
    }

    #[test]
    fn unknown_variant_is_an_error() {
        let err = build_layout_story(&sample_prayer(), &LayoutOptions::new("fr", "standard"))
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "Variant not found: lang=\"fr\" variant=\"standard\""
        );
    }

    #[test]
    fn serializes_to_the_ts_shape() {
        let story =
            build_layout_story(&sample_prayer(), &LayoutOptions::new("en", "standard")).unwrap();
        assert_eq!(
            serde_json::to_string(&story).unwrap(),
            r#"{"noteStyleName":"note","paragraphs":[{"kind":"verse","styleName":"verse","lines":[[{"t":"text","v":"Holy God, Holy Mighty, Holy Immortal, have mercy on us."}]]}]}"#
        );
    }
}
