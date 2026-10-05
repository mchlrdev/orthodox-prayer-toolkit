//! Semantic HTML export of one Variant (a fragment, optionally wrapped; no CSS).

use indexmap::IndexMap;

use crate::html_tags::{resolve_html_tag, resolve_wrapper_tag};
use crate::model::VariantNotFound;
use crate::model::{InlineContent, Prayer, RunRole, Translation, VariantKey, VariantMeta};
use crate::tag_map::TagMap;

/// Root element around the exported blocks.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Wrapper {
    /// Root tag; missing or disallowed becomes `article`.
    pub tag: Option<String>,
    /// User attributes; they override the automatic metadata attributes.
    /// `id` and `data-id` are never written.
    pub attributes: IndexMap<String, String>,
}

/// What to export and how.
#[derive(Clone, Debug)]
pub struct ExportHtmlOptions<'a> {
    pub key: VariantKey<'a>,
    /// Kind to tag; missing or disallowed becomes `div`.
    pub tag_map: &'a TagMap,
    /// `None`: just the block elements.
    pub wrapper: Option<Wrapper>,
    /// Keep blocks without a translation as empty elements with `data-kind`.
    pub include_blocks_without_translation: bool,
}

/// Escapes for element content.
fn escape_text(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c => out.push(c),
        }
    }
    out
}

/// Escapes for double-quoted attribute values.
fn escape_attr(value: &str) -> String {
    escape_text(value).replace('\'', "&#39;")
}

fn render_inline(content: &InlineContent) -> String {
    content
        .to_runs()
        .iter()
        .map(|run| {
            let escaped = escape_text(&run.text);
            match run.role {
                RunRole::Note => format!("<span data-kind=\"annotation\">{escaped}</span>"),
                RunRole::Text => escaped,
            }
        })
        .collect()
}

/// Verse `lines` joined by `<br>`; else the `text`; else nothing.
fn render_payload(tr: &Translation) -> String {
    if let Some(lines) = &tr.lines {
        lines
            .iter()
            .map(render_inline)
            .collect::<Vec<_>>()
            .join("<br>")
    } else {
        tr.text.as_ref().map(render_inline).unwrap_or_default()
    }
}

fn open_tag<'a>(tag: &str, attrs: impl IntoIterator<Item = (&'a str, &'a str)>) -> String {
    let mut out = format!("<{tag}");
    for (name, value) in attrs {
        out.push_str(&format!(" {name}=\"{}\"", escape_attr(value)));
    }
    out.push('>');
    out
}

/// Metadata attribute names, in the order they are written.
const META_ATTRS: [&str; 10] = [
    "lang",
    "data-lang",
    "data-variant",
    "data-title",
    "data-license",
    "data-source",
    "data-type",
    "data-book",
    "data-occasion",
    "data-tone",
];

/// Automatic value of a metadata attribute; `None` when the prayer has none.
fn auto_meta_attr(
    name: &str,
    prayer: &Prayer,
    key: VariantKey<'_>,
    meta: &VariantMeta,
) -> Option<String> {
    Some(match name {
        "lang" | "data-lang" => key.lang.to_owned(),
        "data-variant" => key.variant.to_owned(),
        "data-title" => meta.title.clone(),
        "data-license" => meta.license.clone(),
        "data-source" => meta.source.clone(),
        "data-type" => prayer.prayer_type.clone(),
        "data-book" => prayer.book.clone()?,
        "data-occasion" => prayer.occasion.clone()?,
        "data-tone" => prayer.tone.flatten()?.to_string(),
        _ => return None,
    })
}

/// Wrapper attributes: metadata first (fixed order, a user value replacing the
/// automatic one or supplying a missing one), then the remaining user
/// attributes sorted by name (JavaScript string order).
fn wrapper_attrs(
    prayer: &Prayer,
    key: VariantKey<'_>,
    meta: &VariantMeta,
    user: &IndexMap<String, String>,
) -> Vec<(String, String)> {
    let mut attrs: Vec<(String, String)> = META_ATTRS
        .iter()
        .filter_map(|&name| {
            let value = user
                .get(name)
                .cloned()
                .or_else(|| auto_meta_attr(name, prayer, key, meta))?;
            Some((name.to_owned(), value))
        })
        .collect();
    let mut rest: Vec<(&String, &String)> = user
        .iter()
        .filter(|(name, _)| !META_ATTRS.contains(&name.as_str()))
        .collect();
    rest.sort_by_key(|(name, _)| name.encode_utf16().collect::<Vec<_>>());
    attrs.extend(rest.into_iter().map(|(n, v)| (n.clone(), v.clone())));
    // Never emit prayer or block ids on the wrapper.
    attrs.retain(|(name, _)| name != "data-id" && name != "id");
    attrs
}

/// Semantic HTML for one Variant: one element per Block (`data-kind` set to
/// the Kind, inline notes as `<span data-kind="annotation">`, verse lines
/// separated by `<br>`), each followed by a newline. Blocks without a
/// translation are omitted unless asked for.
pub fn export_html(
    prayer: &Prayer,
    options: &ExportHtmlOptions<'_>,
) -> Result<String, VariantNotFound> {
    let key = options.key;
    // Checked even without a wrapper, consistent with the flat export.
    let meta = prayer
        .variants
        .iter()
        .find(|v| v.key() == key)
        .ok_or_else(|| VariantNotFound::new(key))?;

    let elements: Vec<String> = prayer
        .structure
        .iter()
        .filter_map(|block| {
            let tr = block.translation(key);
            if tr.is_none() && !options.include_blocks_without_translation {
                return None;
            }
            let tag = resolve_html_tag(options.tag_map.get(&block.kind).map(String::as_str));
            let inner = tr.map(render_payload).unwrap_or_default();
            let open = open_tag(tag, [("data-kind", block.kind.as_str())]);
            Some(format!("{open}{inner}</{tag}>"))
        })
        .collect();

    let Some(wrapper) = &options.wrapper else {
        return Ok(elements.iter().map(|e| format!("{e}\n")).collect());
    };

    let root = resolve_wrapper_tag(wrapper.tag.as_deref());
    let attrs = wrapper_attrs(prayer, key, meta, &wrapper.attributes);
    let open = open_tag(root, attrs.iter().map(|(n, v)| (n.as_str(), v.as_str())));
    Ok(format!("{open}{}</{root}>\n", elements.join("\n")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str =
        include_str!("../tests/golden/export_html/prayers/html-export-sample.json");

    fn sample() -> Prayer {
        serde_json::from_str(SAMPLE).unwrap()
    }

    fn tags() -> TagMap {
        [("heading", "h2"), ("annotation", "p"), ("verse", "p")]
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v.to_owned()))
            .collect()
    }

    fn options<'a>(lang: &'a str, tag_map: &'a TagMap) -> ExportHtmlOptions<'a> {
        ExportHtmlOptions {
            key: VariantKey {
                lang,
                variant: "standard",
            },
            tag_map,
            wrapper: None,
            include_blocks_without_translation: false,
        }
    }

    #[test]
    fn exports_fragment_with_inline_note() {
        let tags = tags();
        let html = export_html(&sample(), &options("de", &tags)).unwrap();
        assert_eq!(
            html,
            "<h2 data-kind=\"heading\">Trisagion</h2>\n\
             <p data-kind=\"annotation\">Dreimal:</p>\n\
             <p data-kind=\"verse\">Heiliger Gott,<br>heiliger <span data-kind=\"annotation\">Starker</span>,<br>heiliger Unsterblicher, erbarme dich unser.</p>\n"
        );
    }

    #[test]
    fn omits_or_keeps_blocks_without_translation() {
        let tags = tags();
        let mut opts = options("en", &tags);
        let verse =
            "<p data-kind=\"verse\">Holy God, Holy Mighty, Holy Immortal, have mercy on us.</p>\n";
        assert_eq!(export_html(&sample(), &opts).unwrap(), verse);
        opts.include_blocks_without_translation = true;
        assert_eq!(
            export_html(&sample(), &opts).unwrap(),
            format!("<h2 data-kind=\"heading\"></h2>\n<p data-kind=\"annotation\"></p>\n{verse}")
        );
    }

    #[test]
    fn disallowed_tags_become_div() {
        let tags: TagMap = [("verse".to_owned(), "script".to_owned())].into();
        let html = export_html(&sample(), &options("en", &tags)).unwrap();
        assert!(html.starts_with("<div data-kind=\"verse\">"));
        assert!(html.ends_with("</div>\n"));
    }

    #[test]
    fn escapes_text_and_attributes() {
        assert_eq!(
            escape_text("A <B> & \"C\" 'D'"),
            "A &lt;B&gt; &amp; &quot;C&quot; 'D'"
        );
        assert_eq!(escape_attr("'"), "&#39;");
    }

    #[test]
    fn wrapper_carries_metadata_and_user_overrides() {
        let tags = tags();
        let mut opts = options("en", &tags);
        opts.wrapper = Some(Wrapper {
            tag: Some("section".into()),
            attributes: [
                ("data-title".to_owned(), "Override".to_owned()),
                ("class".to_owned(), "prayer".to_owned()),
                ("id".to_owned(), "v1".to_owned()),
                ("data-id".to_owned(), "x".to_owned()),
            ]
            .into(),
        });
        let html = export_html(&sample(), &opts).unwrap();
        assert!(html.starts_with(
            "<section lang=\"en\" data-lang=\"en\" data-variant=\"standard\" data-title=\"Override\" data-license=\"CC0\" data-source=\"test fixture\" data-type=\"prayer\" data-book=\"horologion\" data-occasion=\"morning\" data-tone=\"5\" class=\"prayer\">"
        ));
        assert!(!html.contains("data-id=") && !html.contains(" id="));
        assert!(html.ends_with("</p></section>\n"));
    }

    #[test]
    fn unknown_variant_is_an_error() {
        let tags = tags();
        let opts = options("fr", &tags);
        assert!(export_html(&sample(), &opts).is_err());
    }
}
