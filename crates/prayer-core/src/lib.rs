//! Rust port of `@orthodox-prayer-toolkit/core`.
//!
//! The JSON Schema stays the single source of truth and is shared with the
//! TypeScript core, so both validate against the same file.

/// `packages/core/schema/prayer.schema.json`, embedded at compile time.
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
