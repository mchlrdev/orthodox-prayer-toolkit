//! Human-facing prayer titles for lists and headers.

use crate::model::{VariantKey, VariantMeta};

/// Title to show for a prayer.
///
/// Prefers the `preferred` Variant (e.g. the Library default or the active
/// column) when it exists and has a title; otherwise the first Variant's
/// title. Falls back to `id` when there is no usable title at all.
pub fn resolve_display_title<'a>(
    id: &'a str,
    variants: &'a [VariantMeta],
    preferred: Option<VariantKey<'_>>,
) -> &'a str {
    let preferred_title = preferred
        .and_then(|key| variants.iter().find(|v| v.key() == key))
        .map(|v| v.title.as_str())
        .filter(|title| !title.is_empty());
    let first_title = variants
        .first()
        .map(|v| v.title.as_str())
        .filter(|title| !title.is_empty());
    preferred_title.or(first_title).unwrap_or(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn variant(lang: &str, variant: &str, title: &str) -> VariantMeta {
        VariantMeta {
            lang: lang.into(),
            variant: variant.into(),
            title: title.into(),
            license: "unknown".into(),
            source: "draft".into(),
        }
    }

    fn variants() -> Vec<VariantMeta> {
        vec![
            variant("de", "standard", "Tropar des Großmärtyrers Prokopios"),
            variant("cu", "synodal-cyrl", "Тропарь великомученику Прокопию"),
        ]
    }

    fn key<'a>(lang: &'a str, variant: &'a str) -> Option<VariantKey<'a>> {
        Some(VariantKey { lang, variant })
    }

    #[test]
    fn uses_first_variant_without_preference() {
        let v = variants();
        assert_eq!(
            resolve_display_title("x", &v, None),
            "Tropar des Großmärtyrers Prokopios"
        );
    }

    #[test]
    fn prefers_matching_variant() {
        let v = variants();
        assert_eq!(
            resolve_display_title("x", &v, key("cu", "synodal-cyrl")),
            "Тропарь великомученику Прокопию"
        );
    }

    #[test]
    fn falls_back_to_first_variant_when_preferred_is_missing() {
        let v = variants();
        assert_eq!(
            resolve_display_title("x", &v, key("en", "standard")),
            "Tropar des Großmärtyrers Prokopios"
        );
    }

    #[test]
    fn falls_back_to_id_without_titles() {
        assert_eq!(resolve_display_title("orphan", &[], None), "orphan");
        let v = vec![variant("de", "standard", "")];
        assert_eq!(resolve_display_title("orphan", &v, None), "orphan");
    }
}
