//! RTF serializer for the layout story: blank named styles, soft breaks for
//! `lines`, a character style for notes, no document meta or title.

use indexmap::IndexMap;

use crate::layout::{LayoutOptions, LayoutRun, LayoutStory, VariantNotFound, build_layout_story};
use crate::model::{Prayer, RunRole};

/// RTF character style number of the note style.
const NOTE_CHAR_STYLE: u32 = 10;

/// Escape `\`, `{`, `}` and non-ASCII (`\uN?` per UTF-16 unit, signed 16-bit).
fn escape_rtf(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '{' => out.push_str("\\{"),
            '}' => out.push_str("\\}"),
            ch if ch.is_ascii() => out.push(ch),
            ch => {
                let mut units = [0u16; 2];
                for unit in ch.encode_utf16(&mut units) {
                    out.push_str(&format!("\\u{}?", *unit as i16));
                }
            }
        }
    }
    out
}

fn render_runs(runs: &[LayoutRun]) -> String {
    runs.iter()
        .map(|run| {
            let escaped = escape_rtf(&run.text);
            match run.role {
                RunRole::Note => format!("{{\\cs{NOTE_CHAR_STYLE} {escaped}}}"),
                RunRole::Text => escaped,
            }
        })
        .collect()
}

/// Serialize an already built story. Paragraph style numbers follow first use.
pub fn story_to_rtf(story: &LayoutStory) -> String {
    let mut style_ids: IndexMap<&str, usize> = IndexMap::new();
    for paragraph in &story.paragraphs {
        let next = style_ids.len() + 1;
        style_ids.entry(&paragraph.style_name).or_insert(next);
    }

    let mut lines = vec![
        "{\\rtf1\\ansi\\uc1\\deff0".to_owned(),
        "{\\fonttbl{\\f0\\fnil;}}".to_owned(),
        "{\\stylesheet".to_owned(),
    ];
    lines.extend(
        style_ids
            .iter()
            .map(|(name, id)| format!("{{\\s{id} {};}}", escape_rtf(name))),
    );
    lines.push(format!(
        "{{\\*\\cs{NOTE_CHAR_STYLE} {};}}",
        escape_rtf(&story.note_style_name)
    ));
    lines.push("}".to_owned());

    for paragraph in &story.paragraphs {
        let id = style_ids[paragraph.style_name.as_str()];
        let inner = paragraph
            .lines
            .iter()
            .map(|line| render_runs(line))
            .collect::<Vec<_>>()
            .join("\\line ");
        lines.push(format!("{{\\pard\\s{id} {inner}\\par}}"));
    }
    lines.push("}".to_owned());
    lines.push(String::new());
    lines.join("\n")
}

/// Export one Variant of `prayer` as a Place-friendly RTF story.
pub fn export_layout_rtf(
    prayer: &Prayer,
    options: &LayoutOptions<'_>,
) -> Result<String, VariantNotFound> {
    build_layout_story(prayer, options).map(|story| story_to_rtf(&story))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::test_support::sample_prayer;

    fn rtf(lang: &str, stem: &str, include_empty: bool) -> String {
        let options = LayoutOptions::new(lang, "standard")
            .with_prefix_stem(stem)
            .with_blocks_without_translation(include_empty);
        export_layout_rtf(&sample_prayer(), &options).unwrap()
    }

    #[test]
    fn blank_styles_soft_breaks_and_note_character_style() {
        let rtf = rtf("de", "opt", false);
        assert!(rtf.contains("{\\s1 opt_heading;}"));
        assert!(rtf.contains("{\\s2 opt_annotation;}"));
        assert!(rtf.contains("{\\s3 opt_verse;}"));
        assert!(rtf.contains("{\\*\\cs10 opt_note;}"));
        assert!(rtf.contains("Trisagion"));
        assert!(rtf.contains("\\line "));
        assert!(rtf.contains("{\\cs10 Starker}"));
        // Blank canvas: no font size or italic baked into the stylesheet.
        assert!(!rtf.contains("\\fs"));
        assert!(!rtf.contains("\\i "));
        // No title or meta paragraphs.
        assert!(!rtf.contains("Probegebet"));
        assert!(!rtf.contains("CC0"));
    }

    #[test]
    fn omits_blocks_without_translation_by_default() {
        let rtf = rtf("en", "", false);
        assert!(rtf.contains("{\\s1 verse;}"));
        assert!(!rtf.contains("heading"));
        assert!(!rtf.contains("annotation"));
        assert!(rtf.contains("Holy God"));
    }

    #[test]
    fn keeps_empty_styled_paragraphs_when_asked() {
        let rtf = rtf("en", "opt", true);
        assert!(rtf.contains("{\\s1 opt_heading;}"));
        assert!(rtf.contains("{\\s2 opt_annotation;}"));
        assert!(rtf.contains("{\\pard\\s1 \\par}"));
        assert!(rtf.contains("{\\pard\\s2 \\par}"));
        assert!(rtf.contains("Holy God"));
    }

    #[test]
    fn bare_style_names_when_prefix_stem_is_empty() {
        let rtf = rtf("de", "", false);
        assert!(rtf.contains("{\\s1 heading;}"));
        assert!(rtf.contains("{\\*\\cs10 note;}"));
        assert!(!rtf.contains("opt_"));
    }

    #[test]
    fn escapes_specials_and_non_ascii() {
        assert_eq!(escape_rtf("a\\{b}"), "a\\\\\\{b\\}");
        assert_eq!(escape_rtf("Ж"), "\\u1046?");
        // U+FFFF-range values above 32767 are written as negative numbers.
        assert_eq!(escape_rtf("\u{FB01}"), "\\u-1279?");
    }

    /// The TS core wrote astral characters as one wrong signed value; the port
    /// writes the UTF-16 surrogate pair.
    #[test]
    fn astral_characters_become_surrogate_pairs() {
        assert_eq!(escape_rtf("\u{1F54A}"), "\\u-10179?\\u-8886?");
    }
}
