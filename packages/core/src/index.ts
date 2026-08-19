export type {
  Block,
  FlatBlock,
  FlatPrayer,
  IdCollision,
  InlineContent,
  KindPreset,
  KindStyle,
  LibraryManifest,
  Prayer,
  StyleMap,
  TextRun,
  Translation,
  ValidationError,
  ValidationResult,
  VariantMeta,
} from "./types.js";

export {
  KIND_PRESETS,
  KIND_PRESET_LABELS,
  isKindPreset,
  kindDisplayLabel,
} from "./types.js";

export {
  isInlineContent,
  isRunArray,
  markRangeAsNote,
  normalizeRuns,
  packInline,
  plainText,
  toRuns,
  toggleNoteRange,
  unmarkNoteAt,
  unmarkRange,
} from "./textRuns.js";

export { validate } from "./validate.js";
export { sanitizeStyles, validateStyles, isValidKindId, sanitizeKindIdInput } from "./validateStyles.js";
export type { StyleValidationResult } from "./validateStyles.js";
export { KIND_ID_PATTERN, KIND_ID_MAX_LENGTH } from "./validateStyles.js";

export { resolveDisplayTitle } from "./displayTitle.js";
export type { PreferredVariant } from "./displayTitle.js";

export { exportVariant } from "./exportVariant.js";
export type { ExportVariantOptions } from "./exportVariant.js";

export { exportHtml } from "./exportHtml.js";
export type { ExportHtmlOptions } from "./exportHtml.js";

export { exportLayoutRtf } from "./exportLayoutRtf.js";
export { exportLayoutDocx } from "./exportLayoutDocx.js";
export type { ExportLayoutOptions } from "./layoutModel.js";
export { buildLayoutStory } from "./layoutModel.js";
export type { LayoutParagraph, LayoutRun, LayoutStory } from "./layoutModel.js";

export {
  HTML_TAG_ALLOWLIST,
  HTML_WRAPPER_TAG_ALLOWLIST,
  isAllowedHtmlTag,
  isAllowedWrapperTag,
  resolveHtmlTag,
  resolveWrapperTag,
} from "./htmlTags.js";
export type { HtmlTag, HtmlWrapperTag } from "./htmlTags.js";

export { parseHtmlAttributes } from "./parseHtmlAttributes.js";
export type { ParseHtmlAttributesResult } from "./parseHtmlAttributes.js";

export { tagMapFromStyles } from "./tagMapFromStyles.js";

export { deleteKind, indexKinds, indexVariants, renameKind } from "./indexKinds.js";
export type { IndexedVariant } from "./indexKinds.js";

export {
  DEFAULT_KIND_STYLES,
  FALLBACK_KIND_STYLE,
  resolveStyles,
} from "./resolveStyles.js";
export type { ResolveStylesOptions } from "./resolveStyles.js";

export {
  isStyleColorToken,
  LEGACY_ACCENT_HEX,
  normalizeStyleColor,
} from "./styleColor.js";
export type { StyleColorToken } from "./styleColor.js";

export {
  filenameMatchesId,
  findIdCollisions,
  isLibraryManifest,
  isPrayerFilename,
  normalizeLibraryManifest,
  prayerFilename,
} from "./library.js";

export {
  DEFAULT_STYLE_PREFIX_STEM,
  isValidStylePrefixStem,
  resolveLibraryStylePrefixStem,
  styleNameWithPrefix,
} from "./stylePrefix.js";
