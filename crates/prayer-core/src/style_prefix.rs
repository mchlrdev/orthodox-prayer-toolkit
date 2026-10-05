//! Style-name prefix for Layout export (`opt_Heading` etc.).

/// Used when the Library sets no stem.
pub const DEFAULT_STYLE_PREFIX_STEM: &str = "opt";

/// Empty, or a letter followed by letters and digits.
pub fn is_valid_style_prefix_stem(stem: &str) -> bool {
    let mut chars = stem.chars();
    match chars.next() {
        None => true,
        Some(first) => first.is_ascii_alphabetic() && chars.all(|c| c.is_ascii_alphanumeric()),
    }
}

/// Library stem, or `opt` when it is absent or empty.
pub fn resolve_library_style_prefix_stem(library_stem: Option<&str>) -> &str {
    library_stem
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_STYLE_PREFIX_STEM)
}

/// `{stem}_{name}`, or the bare name when the stem is empty.
pub fn style_name_with_prefix(stem: &str, name: &str) -> String {
    if stem.is_empty() {
        name.to_owned()
    } else {
        format!("{stem}_{name}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stems() {
        assert!(is_valid_style_prefix_stem(""));
        assert!(is_valid_style_prefix_stem("opt2"));
        assert!(!is_valid_style_prefix_stem("2opt"));
        assert!(!is_valid_style_prefix_stem("op_t"));
        assert_eq!(resolve_library_style_prefix_stem(Some("")), "opt");
        assert_eq!(resolve_library_style_prefix_stem(None), "opt");
        assert_eq!(resolve_library_style_prefix_stem(Some("lib")), "lib");
        assert_eq!(style_name_with_prefix("", "Verse"), "Verse");
        assert_eq!(style_name_with_prefix("opt", "Verse"), "opt_Verse");
    }
}
