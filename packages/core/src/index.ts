export type {
  Block,
  FlatBlock,
  FlatPrayer,
  IdCollision,
  InlineContent,
  KindDef,
  KindPreset,
  KindStyle,
  LibraryManifest,
  Prayer,
  SpeakerLabel,
  StyleMap,
  TextRun,
  Translation,
  ValidationError,
  ValidationResult,
  VariantMeta,
} from "./types.js";

export {
  CURRENT_FORMAT_VERSION,
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
  replaceRangeInInline,
  splitInline,
  toRuns,
  toggleNoteRange,
  unmarkNoteAt,
  unmarkRange,
} from "./textRuns.js";

export { validate } from "./validate.js";
export { locateValidationErrors } from "./locateErrors.js";
export type { ValidationErrorLocation } from "./locateErrors.js";
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
export {
  exportLayoutDocx,
  exportLayoutDocxParallel,
} from "./exportLayoutDocx.js";
export type {
  ExportLayoutOptions,
  ExportLayoutParallelOptions,
  LayoutColumnRef,
} from "./layoutModel.js";
export {
  DEFAULT_SPEAKER_EXPORT,
  DEFAULT_PARALLEL_SPEAKER_EXPORT,
} from "./speakerExport.js";
export type {
  SpeakerExportOptions,
  ParallelSpeakerExportOptions,
} from "./speakerExport.js";
export { buildLayoutStory, buildLayoutPairStory } from "./layoutModel.js";
export type {
  LayoutPairRow,
  LayoutPairStory,
  LayoutParagraph,
  LayoutRun,
  LayoutSpeaker,
  LayoutStory,
} from "./layoutModel.js";

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

export {
  discoverKinds,
  indexKinds,
  indexVariants,
  libraryKindsInUse,
  rawPrayerKinds,
  unusedStyleKeys,
} from "./indexKinds.js";
export type { IndexedVariant, LibraryKindSources } from "./indexKinds.js";

export {
  declareBlockKinds,
  declareKinds,
  deleteKind,
  dropDisallowedSpeakers,
  kindAllowsSpeaker,
  pickerKinds,
  renameKind,
  setKindSpeaker,
} from "./kinds.js";

export {
  TEMPLATE_ID_PATTERN,
  addTemplateKind,
  applyTemplate,
  isValidTemplateId,
  moveTemplateKind,
  removeTemplateKind,
  renameTemplateKind,
  sanitizeTemplates,
  setTemplateKindSpeaker,
  stampTemplate,
  templateIdFromLabel,
  validateTemplates,
} from "./templates.js";
export type {
  KindTemplate,
  KindTemplatesFile,
  TemplatesValidationResult,
} from "./templates.js";

export {
  LEGACY_KINDS_TEMPLATE_ID,
  migratePrayer,
  planLibraryMigration,
} from "./migrate.js";
export type {
  LibraryMigrationInput,
  LibraryMigrationPlan,
  MigratePrayerOptions,
  PrayerMigration,
} from "./migrate.js";

export { normalizeFormatVersion } from "./formatVersion.js";

export {
  LEGACY_STYLE_FIELDS,
  hasLegacyStyleFields,
  legacyStyleFields,
  removeStyleKey,
  renameStyleKey,
  stripLegacyStyleFields,
  stylesFileObject,
} from "./styleFile.js";
export type { StylesFileOptions } from "./styleFile.js";

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
  prayerIdFromTitle,
  freePrayerId,
} from "./library.js";

export {
  DEFAULT_STYLE_PREFIX_STEM,
  isValidStylePrefixStem,
  paragraphStyleName,
  resolveLibraryStylePrefixStem,
  styleNameWithPrefix,
} from "./stylePrefix.js";

export {
  isKindDir,
  normalizePrayerVariants,
  normalizeVariantMeta,
  resolveBlockDir,
  resolveDir,
  variantIsRtl,
} from "./resolveDir.js";
export type { KindDir, TextDir } from "./resolveDir.js";

export {
  SPEAKER_PRESETS,
  isSpeakerPreset,
  listSpeakers,
  renameSpeaker,
  indexSpeakers,
  isValidSpeakerId,
  removeSpeaker,
  resolveSpeakerLabel,
  sanitizeSpeakerIdInput,
  setBlockSpeaker,
  setSpeakerLabel,
  speakerChipLabel,
  speakerDisplayLabel,
} from "./speakers.js";
export type { SpeakerPreset, SpeakerSummary, VariantRef } from "./speakers.js";

export { assignStyleGroups, readText } from "./importSource.js";
export type {
  ReadTextOptions,
  SegmentArea,
  SegmentMark,
  UncertainRange,
  SegmentLook,
  Source,
  SourceFormat,
  SourceSegment,
} from "./importSource.js";

export {
  applyImportOp,
  applyImportOps,
  createImportDraft,
  draftBlockContent,
  draftBlockGroup,
  draftBlockHasTypedText,
  draftBlockPlainText,
  draftUncertainWords,
  type DraftUncertainWord,
  draftBlockSegments,
  draftBlocksInColumn,
  draftBlocksInGroup,
  freeSourceId,
  freeVariantKey,
  segmentColumn,
  draftBlockVisible,
  importDraftToPrayer,
  validateImportDraft,
} from "./importDraft.js";
export type {
  CreateImportDraftOptions,
  DraftBlock,
  DraftPrayerMeta,
  DraftSpan,
  DraftVariant,
  ImportActor,
  ImportDraft,
  ImportOp,
  ImportOpResult,
  ImportOrigin,
} from "./importDraft.js";
export {
  UNCERTAIN_BELOW,
  decisionItemPrefix,
  decisionPrompts,
  decisionStep,
  describeLook,
  firstDraftBatches,
  speakerBatch,
  speakerForLabel,
  speakerNamedIn,
  uncertainDecisions,
} from "./importDecisions.js";
export {
  actionBatch,
  chatActions,
  choiceBatch,
  quotedText,
  plainScope,
  plainAction,
  scopeBatch,
  sectionNumbers,
  targetBatch,
} from "./chatDecisions.js";
export type { ChatAction, ChatView } from "./chatDecisions.js";
export { draftChanges } from "./importChanges.js";
export type { DraftChange } from "./importChanges.js";
export type {
  DecisionAnswer,
  DecisionBatch,
  DecisionItem,
  DecisionKind,
  DecisionOption,
  DecisionPrompt,
  DecisionStep,
} from "./importDecisions.js";
export {
  EXCLUDE,
  MEMORY_FORMAT_VERSION,
  MEMORY_MAX_EXAMPLES,
  MEMORY_ORIGIN,
  SUGGEST_AFTER,
  addMemoryHint,
  answerLabel,
  dismissMemorySuggestion,
  draftCorrections,
  draftOrigin,
  emptyMemory,
  hintForChanges,
  hintSuggestions,
  learnCorrections,
  lookKey,
  lookSummary,
  memoryFileText,
  memoryRuleSteps,
  mergeCorrections,
  removeMemoryEntry,
  sanitizeMemory,
  sourceOrigin,
  withMemory,
} from "./libraryMemory.js";
export type {
  LibraryMemory,
  MemoryCorrection,
  MemoryExample,
  MemoryHint,
  MemoryRuleStep,
  MemorySuggestion,
} from "./libraryMemory.js";
