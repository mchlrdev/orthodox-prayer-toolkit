//! Allowed HTML element names for Kind tags and export wrappers.

/// Elements a Kind may map to in HTML export.
pub const HTML_TAG_ALLOWLIST: [&str; 12] = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "div",
    "aside",
    "section",
    "blockquote",
    "span",
];

pub fn is_allowed_html_tag(tag: &str) -> bool {
    HTML_TAG_ALLOWLIST.contains(&tag)
}

/// The wrapper root may also be `article` (the default).
pub fn is_allowed_wrapper_tag(tag: &str) -> bool {
    tag == "article" || is_allowed_html_tag(tag)
}

/// Tag for a Kind: unknown or missing becomes `div`.
pub fn resolve_html_tag(tag: Option<&str>) -> &str {
    tag.filter(|t| is_allowed_html_tag(t)).unwrap_or("div")
}

/// Wrapper tag: unknown or missing becomes `article`.
pub fn resolve_wrapper_tag(tag: Option<&str>) -> &str {
    tag.filter(|t| is_allowed_wrapper_tag(t))
        .unwrap_or("article")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_with_fallbacks() {
        assert_eq!(resolve_html_tag(Some("h2")), "h2");
        assert_eq!(resolve_html_tag(Some("script")), "div");
        assert_eq!(resolve_html_tag(None), "div");
        assert_eq!(resolve_wrapper_tag(Some("article")), "article");
        assert_eq!(resolve_wrapper_tag(Some("section")), "section");
        assert_eq!(resolve_wrapper_tag(Some("body")), "article");
        assert!(!is_allowed_html_tag("article"));
    }
}
