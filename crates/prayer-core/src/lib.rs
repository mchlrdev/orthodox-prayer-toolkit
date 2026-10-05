//! Prayer JSON core: types, validation, text runs, Kinds and styles, Library
//! helpers and exports. Rewrite of `@orthodox-prayer-toolkit/core`: same
//! results, Rust-shaped API.
//!
//! The JSON Schema is the single source of truth, embedded from
//! `packages/core/schema` until the TypeScript core is removed.

pub mod display_title;
pub mod export_docx;
pub mod export_html;
pub mod export_rtf;
pub mod export_variant;
pub mod html_tags;
pub mod kinds;
pub mod layout;
pub mod library;
pub mod model;
pub mod parse_html_attributes;
pub mod resolve_styles;
pub mod style_color;
pub mod style_prefix;
pub mod tag_map;
pub mod text_runs;
pub mod validate;
pub mod validate_styles;

pub use model::*;

/// `prayer.schema.json`, embedded at compile time.
pub const PRAYER_SCHEMA: &str = include_str!("../../../packages/core/schema/prayer.schema.json");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_is_valid_json() {
        let schema: serde_json::Value = serde_json::from_str(PRAYER_SCHEMA).unwrap();
        assert!(schema.get("$schema").is_some());
    }
}
