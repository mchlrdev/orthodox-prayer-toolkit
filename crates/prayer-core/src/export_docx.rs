//! DOCX serializer for the layout story: blank named paragraph styles, soft
//! breaks for `lines`, a character style for notes, one section, no document
//! meta or title.

use std::fmt;
use std::io::Cursor;

use docx_rs::{BreakType, Docx, Paragraph, Run, Style, StyleType};
use indexmap::IndexSet;

use crate::layout::{LayoutOptions, LayoutRun, LayoutStory, build_layout_story};
use crate::model::VariantNotFound;
use crate::model::{Prayer, RunRole};

/// Why a DOCX export failed.
#[derive(Debug)]
pub enum ExportDocxError {
    VariantNotFound(VariantNotFound),
    /// Writing the zip package failed.
    Pack(String),
}

impl fmt::Display for ExportDocxError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::VariantNotFound(err) => err.fmt(f),
            Self::Pack(err) => write!(f, "could not write DOCX: {err}"),
        }
    }
}

impl std::error::Error for ExportDocxError {}

impl From<VariantNotFound> for ExportDocxError {
    fn from(err: VariantNotFound) -> Self {
        Self::VariantNotFound(err)
    }
}

/// Blank paragraph style: no fonts, colours or spacing, so Place can restyle.
fn paragraph_style(name: &str) -> Style {
    Style::new(name, StyleType::Paragraph)
        .name(name)
        .based_on("Normal")
        .next("Normal")
}

fn note_character_style(name: &str) -> Style {
    Style::new(name, StyleType::Character)
        .name(name)
        .based_on("DefaultParagraphFont")
}

fn layout_run(run: &LayoutRun, note_style: &str) -> Run {
    let docx_run = Run::new().add_text(run.text.as_str());
    match run.role {
        RunRole::Note => docx_run.style(note_style),
        RunRole::Text => docx_run,
    }
}

/// One paragraph: runs of each line, a soft break between lines.
fn layout_paragraph(style_name: &str, lines: &[Vec<LayoutRun>], note_style: &str) -> Paragraph {
    let mut paragraph = Paragraph::new().style(style_name);
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            paragraph = paragraph.add_run(Run::new().add_break(BreakType::TextWrapping));
        }
        for run in line {
            paragraph = paragraph.add_run(layout_run(run, note_style));
        }
    }
    paragraph
}

/// Serialize an already built story to DOCX bytes.
pub fn story_to_docx(story: &LayoutStory) -> Result<Vec<u8>, ExportDocxError> {
    let style_names: IndexSet<&str> = story
        .paragraphs
        .iter()
        .map(|p| p.style_name.as_str())
        .collect();

    let mut docx = Docx::new();
    for name in style_names {
        docx = docx.add_style(paragraph_style(name));
    }
    docx = docx.add_style(note_character_style(&story.note_style_name));
    for paragraph in &story.paragraphs {
        docx = docx.add_paragraph(layout_paragraph(
            &paragraph.style_name,
            &paragraph.lines,
            &story.note_style_name,
        ));
    }

    let mut buffer = Cursor::new(Vec::new());
    docx.build()
        .pack(&mut buffer)
        .map_err(|err| ExportDocxError::Pack(err.to_string()))?;
    Ok(buffer.into_inner())
}

/// Export one Variant of `prayer` as a Place-friendly DOCX story.
pub fn export_layout_docx(
    prayer: &Prayer,
    options: &LayoutOptions<'_>,
) -> Result<Vec<u8>, ExportDocxError> {
    story_to_docx(&build_layout_story(prayer, options)?)
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Read};

    use super::*;
    use crate::layout::test_support::sample_prayer;

    /// `(styles.xml, document.xml)` of the exported package.
    fn export_parts(lang: &str, stem: &str, include_empty: bool) -> (String, String) {
        let options = LayoutOptions::new(lang, "standard")
            .with_prefix_stem(stem)
            .with_blocks_without_translation(include_empty);
        let bytes = export_layout_docx(&sample_prayer(), &options).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut read = |name: &str| {
            let mut out = String::new();
            archive
                .by_name(name)
                .unwrap()
                .read_to_string(&mut out)
                .unwrap();
            out
        };
        (read("word/styles.xml"), read("word/document.xml"))
    }

    #[test]
    fn blank_styles_soft_breaks_and_note_character_style() {
        let (styles, document) = export_parts("de", "opt", false);
        for id in ["opt_heading", "opt_annotation", "opt_verse", "opt_note"] {
            assert!(styles.contains(&format!("w:styleId=\"{id}\"")), "{id}");
        }
        // Blank: no italics or bold forced on the note character style.
        let note = &styles[styles.find("w:styleId=\"opt_note\"").unwrap()..];
        let note = &note[..note.find("</w:style>").unwrap()];
        assert!(!note.contains("<w:i ") && !note.contains("<w:i/>"));
        assert!(!note.contains("<w:b ") && !note.contains("<w:b/>"));
        assert!(document.contains("Trisagion"));
        assert!(document.contains("<w:br"));
        assert!(document.contains("w:rStyle w:val=\"opt_note\""));
        assert!(document.contains("Starker"));
        assert!(!document.contains("Probegebet"));
    }

    #[test]
    fn keeps_empty_paragraphs_when_asked() {
        let (_, document) = export_parts("en", "opt", true);
        assert!(document.contains("w:pStyle w:val=\"opt_heading\""));
        assert!(document.contains("w:pStyle w:val=\"opt_annotation\""));
        assert!(document.contains("Holy God"));
    }

    #[test]
    fn bare_style_names_when_prefix_stem_is_empty() {
        let (styles, _) = export_parts("de", "", false);
        assert!(styles.contains("w:styleId=\"heading\""));
        assert!(styles.contains("w:styleId=\"note\""));
        assert!(!styles.contains("opt_"));
    }

    #[test]
    fn unknown_variant_is_an_error() {
        let err = export_layout_docx(&sample_prayer(), &LayoutOptions::new("fr", "standard"))
            .unwrap_err();
        assert!(matches!(err, ExportDocxError::VariantNotFound(_)));
    }
}
