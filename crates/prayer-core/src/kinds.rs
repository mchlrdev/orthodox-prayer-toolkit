//! Kind and Variant indexing across prayers, plus per-prayer Kind rename and
//! delete.
//!
//! Rename and delete **mutate the prayer in place** and return how many
//! Blocks changed. The TypeScript core returned new objects, but in Rust the
//! caller decides whether to clone first, and the count tells it whether
//! anything happened (useful for "is this session draft dirty").

use std::cmp::Ordering;

use indexmap::IndexSet;

use crate::model::{Prayer, VariantKey};

/// Kind that receives the Blocks of a deleted Kind unless the caller says
/// otherwise.
pub const DEFAULT_DELETE_FALLBACK: &str = "verse";

/// Used when the deleted Kind is the fallback itself.
const FALLBACK_OF_FALLBACK: &str = "annotation";

/// Union of all Kinds used by the Blocks of `prayers`, sorted.
pub fn index_kinds<'a>(prayers: impl IntoIterator<Item = &'a Prayer>) -> Vec<&'a str> {
    let kinds: IndexSet<&str> = prayers
        .into_iter()
        .flat_map(|prayer| &prayer.structure)
        .map(|block| block.kind.as_str())
        .collect();
    let mut kinds: Vec<&str> = kinds.into_iter().collect();
    kinds.sort_by(|a, b| compare_locale(a, b));
    kinds
}

/// Unique lang/variant pairs across `prayers`, sorted by lang, then variant.
pub fn index_variants<'a>(prayers: impl IntoIterator<Item = &'a Prayer>) -> Vec<VariantKey<'a>> {
    let keys: IndexSet<VariantKey<'a>> = prayers
        .into_iter()
        .flat_map(|prayer| &prayer.variants)
        .map(|variant| variant.key())
        .collect();
    let mut keys: Vec<VariantKey<'a>> = keys.into_iter().collect();
    keys.sort_by(|a, b| {
        compare_locale(a.lang, b.lang).then_with(|| compare_locale(a.variant, b.variant))
    });
    keys
}

/// Renames Kind `from` to `to` in the Blocks of this one prayer (other
/// prayers are not touched). Returns the number of Blocks changed.
pub fn rename_kind(prayer: &mut Prayer, from: &str, to: &str) -> usize {
    if from == to {
        return 0;
    }
    reassign_kind(prayer, from, to)
}

/// Deletes Kind `kind` from this prayer by moving its Blocks to `fallback`
/// (usually [`DEFAULT_DELETE_FALLBACK`]). If `kind` is the fallback itself the
/// Blocks become `annotation` instead. Returns the number of Blocks changed.
pub fn delete_kind(prayer: &mut Prayer, kind: &str, fallback: &str) -> usize {
    let target = if kind == fallback {
        FALLBACK_OF_FALLBACK
    } else {
        fallback
    };
    reassign_kind(prayer, kind, target)
}

fn reassign_kind(prayer: &mut Prayer, from: &str, to: &str) -> usize {
    let mut changed = 0;
    for block in prayer.structure.iter_mut().filter(|b| b.kind == from) {
        block.kind = to.to_owned();
        changed += 1;
    }
    changed
}

/// Approximation of `String.prototype.localeCompare` with the default (root)
/// ICU collation, which the TypeScript core used to sort Kinds, Variants and
/// ids.
///
/// Compared in two passes like ICU: first by character class and letter
/// (whitespace, then punctuation in ICU order, digits, letters ignoring case;
/// non-ASCII characters by lowercased code point), then lowercase before
/// uppercase. Accents are not treated as secondary differences, so accented
/// Latin letters sort by code point after `z`; Kind ids and language codes
/// are ASCII, so this is not a practical gap.
pub fn compare_locale(a: &str, b: &str) -> Ordering {
    let primary = a
        .chars()
        .map(primary_weight)
        .cmp(b.chars().map(primary_weight));
    primary.then_with(|| tertiary(a, b))
}

/// ASCII punctuation in ICU root collation order.
const PUNCTUATION_ORDER: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

fn primary_weight(c: char) -> (u8, u32) {
    if c.is_whitespace() {
        (0, c as u32)
    } else if let Some(index) = PUNCTUATION_ORDER.find(c) {
        (1, index as u32)
    } else if c.is_ascii_digit() {
        (2, c as u32)
    } else {
        let lower = c.to_lowercase().next().unwrap_or(c);
        (3, lower as u32)
    }
}

/// First case difference decides; lowercase sorts before uppercase.
fn tertiary(a: &str, b: &str) -> Ordering {
    a.chars()
        .zip(b.chars())
        .find(|(x, y)| x != y)
        .map_or(Ordering::Equal, |(x, _)| {
            if x.is_lowercase() {
                Ordering::Less
            } else {
                Ordering::Greater
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Block, VariantMeta};

    fn variant(lang: &str, variant: &str) -> VariantMeta {
        VariantMeta {
            lang: lang.into(),
            variant: variant.into(),
            title: "T".into(),
            license: "unknown".into(),
            source: "draft".into(),
        }
    }

    fn prayer(kinds: &[&str], variants: Vec<VariantMeta>) -> Prayer {
        Prayer {
            id: "p".into(),
            prayer_type: "prayer".into(),
            book: None,
            occasion: None,
            tone: None,
            description: None,
            variants,
            structure: kinds
                .iter()
                .enumerate()
                .map(|(i, kind)| Block {
                    id: format!("b{i}"),
                    kind: (*kind).into(),
                    translations: Vec::new(),
                })
                .collect(),
            meta: None,
        }
    }

    #[test]
    fn unions_kinds_across_prayers() {
        let a = prayer(&["annotation", "verse", "verse"], vec![]);
        let b = prayer(&["epistle-intro", "annotation"], vec![]);
        assert_eq!(
            index_kinds([&a, &b]),
            ["annotation", "epistle-intro", "verse"]
        );
    }

    #[test]
    fn kinds_sort_like_locale_compare() {
        let p = prayer(&["b", "B", "a", "A", "a-b", "ab", "a_b", "a1"], vec![]);
        assert_eq!(
            index_kinds([&p]),
            ["a", "A", "a_b", "a-b", "a1", "ab", "b", "B"]
        );
    }

    #[test]
    fn unions_variants_across_prayers() {
        let a = prayer(
            &[],
            vec![variant("de", "standard"), variant("en", "standard")],
        );
        let b = prayer(
            &[],
            vec![variant("de", "standard"), variant("cu", "synodal-cyrl")],
        );
        let keys = index_variants([&a, &b]);
        let pairs: Vec<_> = keys.iter().map(|k| (k.lang, k.variant)).collect();
        assert_eq!(
            pairs,
            [
                ("cu", "synodal-cyrl"),
                ("de", "standard"),
                ("en", "standard")
            ]
        );
    }

    #[test]
    fn rename_changes_only_matching_blocks() {
        let mut p = prayer(&["annotation", "verse", "annotation"], vec![]);
        assert_eq!(rename_kind(&mut p, "annotation", "instruction"), 2);
        let kinds: Vec<_> = p.structure.iter().map(|b| b.kind.as_str()).collect();
        assert_eq!(kinds, ["instruction", "verse", "instruction"]);
        assert_eq!(rename_kind(&mut p, "verse", "verse"), 0);
    }

    #[test]
    fn delete_reassigns_to_fallback() {
        let mut p = prayer(&["annotation", "verse"], vec![]);
        assert_eq!(
            delete_kind(&mut p, "annotation", DEFAULT_DELETE_FALLBACK),
            1
        );
        assert!(p.structure.iter().all(|b| b.kind == "verse"));
    }

    #[test]
    fn deleting_the_fallback_kind_uses_annotation() {
        let mut p = prayer(&["verse", "heading"], vec![]);
        assert_eq!(delete_kind(&mut p, "verse", "verse"), 1);
        assert_eq!(p.structure[0].kind, "annotation");
        assert_eq!(p.structure[1].kind, "heading");
    }
}
