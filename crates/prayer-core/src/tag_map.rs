//! Kind to HTML tag map derived from styles.

use indexmap::IndexMap;

use crate::html_tags::is_allowed_html_tag;
use crate::model::StyleMap;

/// Kind id to HTML tag, as consumed by HTML export.
pub type TagMap = IndexMap<String, String>;

/// Kind to tag map from resolved styles; only allowlisted tags are kept.
pub fn tag_map_from_styles(styles: &StyleMap) -> TagMap {
    styles
        .iter()
        .filter_map(|(kind, style)| {
            let tag = style.html_tag.as_deref()?;
            is_allowed_html_tag(tag).then(|| (kind.clone(), tag.to_owned()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::KindStyle;

    fn style(html_tag: Option<&str>) -> KindStyle {
        KindStyle {
            font_size: "12pt".into(),
            color: "#000000".into(),
            font_weight: "normal".into(),
            font_style: "normal".into(),
            initial_cap: None,
            indicate: None,
            html_tag: html_tag.map(str::to_owned),
            text_align: None,
            extra: IndexMap::new(),
        }
    }

    #[test]
    fn keeps_allowlisted_html_tags() {
        let styles: StyleMap = [
            ("heading".to_owned(), style(Some("h2"))),
            ("verse".to_owned(), style(Some("script"))),
            ("custom".to_owned(), style(None)),
        ]
        .into_iter()
        .collect();
        let map = tag_map_from_styles(&styles);
        assert_eq!(map.len(), 1);
        assert_eq!(map["heading"], "h2");
    }
}
