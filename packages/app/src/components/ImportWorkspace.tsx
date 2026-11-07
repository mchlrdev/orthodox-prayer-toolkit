import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { ActionIcon, Button, Menu, Tooltip } from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCheck,
  IconChevronDown,
  IconCircleOff,
  IconLink,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import {
  draftBlockGroup,
  draftBlockSegments,
  draftBlockVisible,
  kindDisplayLabel,
  locateValidationErrors,
  pickerKinds,
  uncertainDecisions,
  type DraftBlock,
  type ImportDraft,
  type ImportOp,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import {
  InlineEditor,
  type BlockIssues,
  type EditorEdits,
  type InlineEditorHandle,
} from "./InlineEditor";
import { ConfirmDialog } from "./ConfirmDialog";
import { PdfSourcePane } from "./PdfSourcePane";
import { useUncertainWords } from "../importDraft/useUncertainWords";
import { shortcutLabel } from "../appCommands";
import { importContentErrors } from "../importDraft/contentErrors";
import {
  segmentIndex,
  markedPieces,
  sample,
  sourceParts,
  type SourcePart,
  type SegmentInfo,
} from "../importDraft/sourceView";
import { variantKey, type ActiveVariant } from "../variant";
import { languageName, variantName } from "../languageName";
import { modelDeviceShort } from "../builtInModel/modelStatusText";
import { useModelDevice } from "../builtInModel/useBuiltInModel";
import type { FirstDraft } from "../builtInModel/useFirstDraft";

/** Small progress ring for the model's work. */
function Spinner({ size = 12 }: { size?: number }) {
  return (
    <svg className="import-spinner" width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.6" />
      <path d="M6 1.5a4.5 4.5 0 014.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

type StyleEditing = Parameters<typeof InlineEditor>[0]["styleEditing"];

function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as { current: T }).current = value;
}

function pxSize(look: SegmentInfo["look"]): number | null {
  const n = typeof look.size === "string" ? Number.parseFloat(look.size) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Source-like emphasis for the segment text: weight, style, larger size. */
function lookAttrs(look: SegmentInfo["look"], bodySize: number | null) {
  const size = pxSize(look);
  const tag = typeof look.tag === "string" ? look.tag : "";
  return {
    "data-bold": look.weight === "bold" ? "true" : undefined,
    "data-italic": look.style === "italic" || look.style === "oblique" ? "true" : undefined,
    "data-large":
      (size !== null && bodySize !== null && size >= bodySize * 1.15) || /^h[1-3]$/.test(tag)
        ? "true"
        : undefined,
  } as const;
}

/** Segment text with its marks (inline runs that look different) drawn in. */
function MarkedText({ part }: { part: SourcePart }) {
  return markedPieces(part.text, part.marks).map((piece, i) =>
    piece.mark ? (
      <span
        key={i}
        className="import-source-mark"
        data-bold={piece.mark.look.weight === "bold" ? "true" : undefined}
        data-italic={piece.mark.look.style === "italic" ? "true" : undefined}
        data-colored={piece.mark.look.color ? "true" : undefined}
      >
        {piece.text}
      </span>
    ) : (
      piece.text
    ),
  );
}

export type ChatHighlight = {
  /** Changed block → what changed ("Speaker: Priest · Label removed"). */
  lines: ReadonlyMap<string, string>;
  /** "2 left out", "3 → Annotation". */
  summary: string;
  /** The answer changed wording, not just structure. */
  wording: boolean;
  onUndo: () => void;
};

type Props = {
  draft: ImportDraft;
  /** Source files by Source id (PDF bytes for the page view). */
  files: Record<string, Uint8Array>;
  prayer: Prayer;
  styles: StyleMap;
  styleEditing: StyleEditing;
  edits: EditorEdits;
  canUndo: boolean;
  canRedo: boolean;
  editorRef?: Ref<InlineEditorHandle>;
  scrollRootRef?: Ref<HTMLDivElement | null>;
  onApply: (ops: ImportOp[]) => boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDiscard: () => void;
  onSave: () => void;
  /** "Add language from source…": a second Variant from a column or another text. */
  onAddLanguage: () => void;
  /** The Built-in model's first draft: progress, uncertain decisions. */
  firstDraft: FirstDraft;
  /** The chat answer whose changes are marked (null = none). */
  chatHighlight?: ChatHighlight | null;
  /** The Variant key the preview shows (the chat numbers blocks by its source). */
  onShownVariantChange?: (key: string) => void;
};

export function ImportWorkspace({
  draft,
  files,
  prayer,
  styles,
  styleEditing,
  edits,
  canUndo,
  canRedo,
  editorRef,
  scrollRootRef,
  onApply,
  onUndo,
  onRedo,
  onDiscard,
  onSave,
  onAddLanguage,
  firstDraft,
  chatHighlight = null,
  onShownVariantChange,
}: Props) {
  const modelDevice = useModelDevice(firstDraft.progress !== null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** The Variant the preview shows; the others are checked through the dropdown. */
  const [shownKey, setShownKey] = useState(draft.variants[0]!.key);
  const variant = draft.variants.find((v) => v.key === shownKey) ?? draft.variants[0]!;
  const multilingual = draft.variants.length > 1;
  // A language just added is the one to check first.
  const variantCount = draft.variants.length;
  const lastKey = draft.variants[variantCount - 1]!.key;
  const seenCount = useRef(variantCount);
  useEffect(() => {
    if (variantCount > seenCount.current) setShownKey(lastKey);
    seenCount.current = variantCount;
  }, [variantCount, lastKey]);
  const col: ActiveVariant = { lang: variant.lang, variant: variant.variant };
  useEffect(() => onShownVariantChange?.(variant.key), [variant.key, onShownVariantChange]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const uncertain = useUncertainWords(bodyRef, draft, variant.key, variantKey(col));
  const visibleVariants = useMemo(
    () => [col],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [col.lang, col.variant],
  );
  const segments = useMemo(() => segmentIndex(draft), [draft.sources]);
  // Most common font size = body text; larger segments read as headings.
  const bodySize = useMemo(() => {
    const counts = new Map<number, number>();
    for (const seg of segments.values()) {
      const size = pxSize(seg.look);
      if (size !== null) counts.set(size, (counts.get(size) ?? 0) + seg.text.length);
    }
    let best: number | null = null;
    for (const [size, n] of counts) if (best === null || n > counts.get(best)!) best = size;
    return best;
  }, [segments]);

  const localEditorRef = useRef<InlineEditorHandle | null>(null);
  const setEditorRef = useCallback(
    (handle: InlineEditorHandle | null) => {
      localEditorRef.current = handle;
      assignRef(editorRef, handle);
    },
    [editorRef],
  );
  /** Block holding the caret: its row and its style group are marked. */
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const source = draft.sources[0];

  const errors = useMemo(() => importContentErrors(prayer), [prayer]);
  const issues = useMemo(() => {
    const byBlock = new Map<string, BlockIssues>();
    for (const { error, blockId, variant: v } of locateValidationErrors(prayer, errors)) {
      if (!blockId) continue;
      const entry = byBlock.get(blockId) ?? { messages: [], variantKeys: new Set<string>() };
      if (!entry.messages.includes(error.message)) entry.messages.push(error.message);
      if (v) entry.variantKeys.add(variantKey(v));
      byBlock.set(blockId, entry);
    }
    return byBlock;
  }, [prayer, errors]);

  const byId = useMemo(
    () => new Map(draft.blocks.map((b) => [b.id, b] as const)),
    [draft.blocks],
  );

  // Hidden blocks with excluded text, grouped under the visible block before them.
  const excludedAfter = useMemo(() => {
    const out = new Map<string | null, DraftBlock[]>();
    let anchor: string | null = null;
    for (const block of draft.blocks) {
      if (draftBlockVisible(draft, block)) {
        anchor = block.id;
        continue;
      }
      const own = Object.values(block.content)
        .flat()
        .some((s) => "seg" in s && draft.excluded.includes(s.seg));
      if (!own) continue;
      out.set(anchor, [...(out.get(anchor) ?? []), block]);
    }
    return out;
  }, [draft]);

  const activeBlock = activeBlockId ? byId.get(activeBlockId) : undefined;
  const activeGroup = activeBlock ? draftBlockGroup(draft, activeBlock) : undefined;

  const selectBlock = (blockId: string) => {
    localEditorRef.current?.revealBlock(blockId, {
      scroll: "nearest",
      focusCol: col,
      flash: false,
      caret: "start",
    });
  };

  const langOf = (key: string) => languageName(draft.variants.find((v) => v.key === key)?.lang ?? key);
  const firstN = (block: DraftBlock) =>
    (sourceParts(block, segments, variant.key)[0] ?? sourceParts(block, segments)[0])?.n;

  /** Nearest visible block above that can take this lone block's only Variant. */
  const pairTarget = (block: DraftBlock): DraftBlock | undefined => {
    const own = Object.keys(block.content);
    if (own.length !== 1) return undefined;
    const index = draft.blocks.indexOf(block);
    for (let i = index - 1; i >= 0; i--) {
      const b = draft.blocks[i]!;
      if (draftBlockVisible(draft, b) && !b.content[own[0]!]) return b;
    }
    return undefined;
  };

  const pairRow = (block: DraftBlock, active: boolean) => {
    if (!multilingual || !draftBlockVisible(draft, block)) return null;
    const missing = draft.variants.filter((v) => !block.content[v.key]);
    const paired = draft.variants.filter((v) => v.key !== variant.key && block.content[v.key]);
    if (missing.length === 0 && !(active && block.content[variant.key])) return null;
    const target = missing.length > 0 ? pairTarget(block) : undefined;
    const targetN = target ? firstN(target) : undefined;
    return (
      // Keep the caret in the editor: its block stays active while a pair action runs.
      <div className="import-pair-row" onMouseDown={(e) => e.preventDefault()}>
        {missing.length > 0 ? (
          <>
            <span className="import-chip" data-tone="warning">
              <span className="import-chip-dot" />
              No {missing.map((v) => languageName(v.lang)).join(", ")}
            </span>
            {target ? (
              <button
                type="button"
                className="import-chip"
                data-action="true"
                onClick={() =>
                  onApply([
                    {
                      op: "pairVariant",
                      block: target.id,
                      variant: Object.keys(block.content)[0]!,
                      from: block.id,
                    },
                  ])
                }
              >
                Pair with {targetN ?? "the block above"}
              </button>
            ) : null}
          </>
        ) : (
          paired.map((v) => {
            const part = sourceParts(block, segments, v.key)[0];
            return (
              <span key={v.key} className="import-pair-item">
                <span className="import-chip">
                  <IconLink size={11} stroke={1.6} />
                  {languageName(v.lang)}
                  {part ? ` ${part.n} · ${sample(part.text, 18)}` : ""}
                </span>
                <button
                  type="button"
                  className="import-link"
                  onClick={() => onApply([{ op: "unpairVariant", block: block.id, variant: v.key }])}
                >
                  Unpair
                </button>
              </span>
            );
          })
        )}
      </div>
    );
  };

  const kindChoices = useMemo(() => pickerKinds(prayer), [prayer]);

  /** What the model decided about a block: pending, speaker taken from a label, unsure kind. */
  const modelRow = (block: DraftBlock) => {
    const pending = firstDraft.progress?.pending === block.id;
    const uncertain = uncertainDecisions(block);
    // From a printed label in the first draft (the chat's changes carry no confidence).
    const speakerByModel =
      block.speaker !== undefined &&
      block.origin.speaker?.by === "model" &&
      block.origin.speaker.confidence !== undefined;
    const uncertainKind = uncertain.find((u) => u.what === "kind");
    const uncertainSpeaker = uncertain.find((u) => u.what === "speaker");
    if (!pending && !speakerByModel && !uncertainKind) return null;
    const speakerName = speakerByModel
      ? (variant.speakers?.[block.speaker!]?.name ??
        draft.variants.find((v) => v.speakers?.[block.speaker!])?.speakers?.[block.speaker!]?.name ??
        block.speaker)
      : null;
    return (
      <div className="import-pair-row" onMouseDown={(e) => e.preventDefault()}>
        {pending ? (
          <span className="import-chip" data-muted="true" aria-label="Checking">
            <Spinner size={10} />
          </span>
        ) : null}
        {speakerByModel ? (
          <span className="import-chip" data-tone={uncertainSpeaker ? "warning" : undefined}>
            <IconUser size={11} stroke={1.6} />
            {speakerName}
            {uncertainSpeaker ? "?" : ""}
          </span>
        ) : null}
        {uncertainKind ? (
          <Menu shadow="md" width={180} position="bottom-start" withinPortal>
            <Menu.Target>
              <button type="button" className="import-chip" data-tone="warning" data-action="true">
                <span className="import-chip-dot" />
                {kindDisplayLabel(block.kind)}?
                <IconChevronDown size={10} stroke={1.8} />
              </button>
            </Menu.Target>
            <Menu.Dropdown>
              {kindChoices.map((kind) => (
                <Menu.Item
                  key={kind}
                  rightSection={kind === block.kind ? <IconCheck size={13} stroke={2} /> : null}
                  onClick={() => onApply([{ op: "setKind", target: { block: block.id }, kind }])}
                >
                  {kindDisplayLabel(kind)}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        ) : null}
      </div>
    );
  };

  const markedBlocks = useMemo(
    () => (chatHighlight ? new Set(chatHighlight.lines.keys()) : undefined),
    [chatHighlight],
  );
  const answerLine = (blockId: string) => {
    const line = chatHighlight?.lines.get(blockId);
    return line ? <div className="import-answer-line">{line}</div> : null;
  };

  const leadCell = (blockId: string) => {
    const block = byId.get(blockId);
    if (!block) return null;
    const shown = sourceParts(block, segments, multilingual ? variant.key : undefined);
    // A block without the shown language: its other language's source, dimmed.
    const parts = shown.length > 0 ? shown : multilingual ? sourceParts(block, segments) : [];
    const other = shown.length === 0 && parts.length > 0;
    const pairs = pairRow(block, blockId === activeBlockId);
    const decided = modelRow(block);
    if (parts.length === 0) {
      return (
        <>
          <div className="import-source-row" data-typed="true" />
          {decided}
          {answerLine(blockId)}
          {pairs}
        </>
      );
    }
    const peer =
      activeGroup !== undefined &&
      blockId !== activeBlockId &&
      draftBlockGroup(draft, block) === activeGroup;
    return (
      <>
        {parts.map((part, i) => (
          <button
            type="button"
            key={`${part.n}-${i}`}
            className="import-source-row"
            data-group-peer={peer ? "true" : undefined}
            data-other={other ? "true" : undefined}
            title={other ? `Only in ${Object.keys(block.content).map(langOf).join(", ")}` : undefined}
            onClick={() => selectBlock(blockId)}
          >
            <span className="import-source-n">{part.n}</span>
            <span className="import-source-text" {...lookAttrs(part.look, bodySize)}>
              <MarkedText part={part} />
            </span>
          </button>
        ))}
        {decided}
        {answerLine(blockId)}
        {pairs}
      </>
    );
  };

  const rowsAfter = (blockId: string | null) => {
    const hidden = excludedAfter.get(blockId);
    if (!hidden) return null;
    return hidden.map((block) => {
      const parts = sourceParts(block, segments);
      const segs = Object.values(block.content)
        .flat()
        .flatMap((s) => ("seg" in s && draft.excluded.includes(s.seg) ? [s.seg] : []));
      return (
        <div
          key={block.id}
          className="import-excluded-row"
          data-marked={chatHighlight?.lines.has(block.id) ? "true" : undefined}
        >
          <div className="inline-lead">
            {parts.map((part, i) => (
              <div key={`${part.n}-${i}`} className="import-source-row" data-excluded="true">
                <span className="import-source-n">{part.n}</span>
                <span className="import-source-text" {...lookAttrs(part.look, bodySize)}>
                  <MarkedText part={part} />
                </span>
              </div>
            ))}
            <div className="import-excluded-actions">
              <span className="import-excluded-label">
                <IconCircleOff size={11} stroke={1.6} />
                Left out
              </span>
              <button
                type="button"
                className="import-link"
                onClick={() =>
                  onApply([
                    { op: "setExcluded", segments: [...new Set(segs)], excluded: false },
                  ])
                }
              >
                Restore
              </button>
            </div>
            {chatHighlight?.lines.get(block.id) === "Left out" ? null : answerLine(block.id)}
          </div>
        </div>
      );
    });
  };

  // --- PDF: the page itself is the Source column ----------------------------
  const pageFormat = source?.format === "pdf" || source?.format === "image" ? source.format : null;
  const pdfData = pageFormat ? files[source!.id] : undefined;
  const allSegments = useMemo(() => draft.sources.flatMap((s) => s.segments), [draft.sources]);
  // Text recognition (scans): how sure it was and how many words are in doubt.
  const scanSummary = useMemo(() => {
    const read = allSegments.filter((s) => s.confidence !== undefined);
    if (read.length === 0) return null;
    const chars = read.reduce((n, s) => n + s.text.length, 0);
    const sure = chars > 0 ? read.reduce((n, s) => n + s.confidence! * s.text.length, 0) / chars : 0;
    const doubtful = read.reduce((n, s) => n + (s.uncertain?.length ?? 0), 0);
    return { sure: Math.round(sure * 100), doubtful };
  }, [allSegments]);
  const excludedSet = useMemo(() => new Set(draft.excluded), [draft.excluded]);
  const [pdfPage, setPdfPage] = useState(1);
  const [range, setRange] = useState<{ anchor: string; ids: Set<string> } | null>(null);
  const activeSegs = useMemo(
    () => new Set(activeBlock ? draftBlockSegments(activeBlock) : []),
    [activeBlock],
  );

  // Follow the caret: show the page of the block being edited.
  useEffect(() => {
    if (!pdfData || !activeBlock) return;
    const first = draftBlockSegments(activeBlock)
      .map((id) => allSegments.find((s) => s.id === id))
      .find((s) => s?.area);
    if (first?.area) setPdfPage(first.area.page);
  }, [pdfData, activeBlock, allSegments]);

  const blockOfSegment = (segId: string) =>
    draft.blocks.find(
      (b) => draftBlockVisible(draft, b) && draftBlockSegments(b).includes(segId),
    );

  const onSegmentClick = (segId: string, extend: boolean) => {
    if (extend && range) {
      const a = allSegments.findIndex((s) => s.id === range.anchor);
      const b = allSegments.findIndex((s) => s.id === segId);
      const [from, to] = a <= b ? [a, b] : [b, a];
      setRange({ anchor: range.anchor, ids: new Set(allSegments.slice(from, to + 1).map((s) => s.id)) });
      return;
    }
    const block = excludedSet.has(segId) ? undefined : blockOfSegment(segId);
    if (block) {
      setRange({ anchor: segId, ids: new Set() });
      selectBlock(block.id);
    } else {
      setRange({ anchor: segId, ids: new Set([segId]) });
    }
  };

  const rangeIds = range ? [...range.ids] : [];
  const rangeHasExcluded = rangeIds.some((id) => excludedSet.has(id));
  const rangeHasIncluded = rangeIds.some((id) => !excludedSet.has(id));
  const applyRange = (ops: ImportOp[]) => {
    onApply(ops);
    setRange(null);
  };
  const importFromHere = () => {
    const first = allSegments.findIndex((s) => range?.ids.has(s.id));
    if (first <= 0) return;
    applyRange([
      { op: "setExcluded", segments: allSegments.slice(0, first).map((s) => s.id), excluded: true },
    ]);
  };

  const uncertainBlocks = draft.blocks.filter(
    (b) => draftBlockVisible(draft, b) && uncertainDecisions(b).length > 0,
  );
  const segmentNumbers = useMemo(
    () => new Map([...segments].map(([id, info]) => [id, info.n] as const)),
    [segments],
  );
  const unsureSegs = new Set(uncertainBlocks.flatMap((b) => draftBlockSegments(b)));
  /** PDF: the page is the source column, so the model's chips go under each block. */
  const pdfRowsAfter = (blockId: string | null) => {
    if (!blockId) return null;
    const block = byId.get(blockId);
    if (!block) return null;
    const decided = modelRow(block);
    const line = answerLine(blockId);
    const pairs = pairRow(block, blockId === activeBlockId);
    return decided || line || pairs ? (
      <div className="import-pdf-after">
        {decided}
        {line}
        {pairs}
      </div>
    ) : null;
  };
  const nextUncertain = () => jumpToNext(uncertainBlocks.map((b) => b.id));
  const nextUncertainRef = useRef(nextUncertain);
  nextUncertainRef.current = nextUncertain;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "j" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        nextUncertainRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Go to the next of these blocks after the one being edited (wraps). */
  const jumpToNext = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const order = draft.blocks.map((b) => b.id);
    const at = activeBlockId ? order.indexOf(activeBlockId) : -1;
    const next = ids.find((id) => order.indexOf(id) > at) ?? ids[0]!;
    localEditorRef.current?.revealBlock(next, {
      scroll: "smooth-center",
      focusCol: col,
      flash: true,
      caret: "start",
    });
  };

  const visibleCount = prayer.structure.length;
  const problemBlocks = [...issues.keys()];
  /** Blocks without the shown language's counterpart (multilingual drafts). */
  const unpaired = multilingual
    ? prayer.structure.filter((b) => b.translations.length < draft.variants.length).map((b) => b.id)
    : [];

  return (
    <div className="workspace import-workspace" data-pdf={pdfData ? "true" : undefined}>
      <div className="workspace-header">
        <div className="workspace-header-top">
          <div className="import-title-row">
            <h1 className="workspace-title" title={draft.variants[0]!.title || undefined}>
              {draft.variants[0]!.title || "Untitled"}
            </h1>
            {source?.name ? (
              <span className="import-subtitle" title={source.name}>
                {source.name}
              </span>
            ) : null}
          </div>
          <div className="import-actions">
            <Tooltip label={`Undo (${shortcutLabel("Mod+Z")})`} withArrow openDelay={300}>
              <ActionIcon
                size="md"
                variant="subtle"
                color="gray"
                aria-label="Undo"
                disabled={!canUndo}
                onClick={onUndo}
              >
                <IconArrowBackUp size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={`Redo (${shortcutLabel("Mod+Shift+Z")})`} withArrow openDelay={300}>
              <ActionIcon
                size="md"
                variant="subtle"
                color="gray"
                aria-label="Redo"
                disabled={!canRedo}
                onClick={onRedo}
              >
                <IconArrowForwardUp size={15} />
              </ActionIcon>
            </Tooltip>
            <span className="import-actions-rule" aria-hidden="true" />
            <Button size="xs" variant="subtle" color="gray" onClick={() => setConfirmDiscard(true)}>
              Discard
            </Button>
            <Button
              size="xs"
              color="dark"
              disabled={visibleCount === 0}
              onClick={() => (problemBlocks.length > 0 ? jumpToNext(problemBlocks) : onSave())}
            >
              Save to library
            </Button>
          </div>
        </div>
        <div className="import-columns">
          <div className="import-column-label">
            <span className="import-caps">Original</span>
            {scanSummary && scanSummary.doubtful > 0 ? (
              <span>
                · {scanSummary.doubtful} unclear {scanSummary.doubtful === 1 ? "word" : "words"}
              </span>
            ) : null}
          </div>
          <div className="import-column-label">
            <Menu shadow="md" width={220} position="bottom-start" withinPortal>
              <Menu.Target>
                <button type="button" className="import-variant-chip" aria-label="Shown language">
                  <span className="import-variant-name">{variantName(col)}</span>
                  <IconChevronDown size={11} stroke={1.8} className="import-variant-caret" />
                </button>
              </Menu.Target>
              <Menu.Dropdown>
                {draft.variants.map((v) => (
                  <Menu.Item
                    key={v.key}
                    onClick={() => setShownKey(v.key)}
                    rightSection={v.key === variant.key ? <IconCheck size={13} stroke={2} /> : null}
                  >
                    {variantName(v)}
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item onClick={onAddLanguage}>Add translation…</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </div>
        {firstDraft.progress ? (
          <div className="import-model-banner" role="status">
            <Spinner />
            <span>
              Sorting
              {firstDraft.progress.total > 0
                ? ` · ${firstDraft.progress.done} of ${firstDraft.progress.total}`
                : " …"}
            </span>
            {modelDevice ? <span className="import-model-banner-hint">{modelDeviceShort(modelDevice)}</span> : null}
            <button type="button" className="import-model-banner-action" onClick={firstDraft.stop}>
              Stop
            </button>
          </div>
        ) : chatHighlight ? (
          <div className="import-model-banner" data-tone="answer" role="status">
            <span className="import-answer-mark" />
            <span>{chatHighlight.summary}</span>
            <span className="import-model-banner-hint">
              {chatHighlight.wording ? "Text changed" : "Text unchanged"}
            </span>
            <button type="button" className="import-model-banner-action" onClick={chatHighlight.onUndo}>
              <IconArrowBackUp size={12} stroke={1.8} />
              Undo
            </button>
          </div>
        ) : firstDraft.error ? (
          <div className="import-model-banner" role="alert">
            <IconAlertTriangle size={12} stroke={2} className="import-bad" />
            <span className="import-model-banner-hint">Sorting stopped: {firstDraft.error}</span>
            <button type="button" className="import-model-banner-action" onClick={firstDraft.dismissError}>
              <IconX size={12} stroke={1.8} aria-label="Dismiss" />
            </button>
          </div>
        ) : null}
      </div>

      <div
        className="workspace-body"
        ref={(el) => {
          bodyRef.current = el;
          assignRef(scrollRootRef, el);
        }}
        onFocusCapture={(e) => {
          const row = (e.target as HTMLElement).closest<HTMLElement>("[data-block-id]");
          if (row?.dataset.blockId && (e.target as HTMLElement).isContentEditable) {
            setActiveBlockId(row.dataset.blockId);
          }
        }}
        onBlurCapture={(e) => {
          const next = e.relatedTarget as HTMLElement | null;
          // The block's own toolbar and its popovers (kind menu) keep it active,
          // so the rows that look the same stay lit while choosing.
          if (next && !bodyRef.current?.contains(next)) return;
          const row = next?.closest<HTMLElement>("[data-block-id]");
          setActiveBlockId(row?.dataset.blockId ?? null);
        }}
      >
        <div
          className="workspace-body-inner import-body"
          data-pdf={pdfData ? "true" : undefined}
        >
          {pdfData ? (
            <div className="import-pdf-side">
              <PdfSourcePane
                data={pdfData}
                format={pageFormat ?? "pdf"}
                segments={allSegments}
                page={pdfPage}
                onPageChange={(p) => {
                  setPdfPage(p);
                  setRange(null);
                }}
                excluded={excludedSet}
                numbers={segmentNumbers}
                unsure={unsureSegs}
                active={activeSegs}
                selected={range?.ids ?? new Set()}
                onSegmentClick={onSegmentClick}
              />
              {rangeIds.length > 0 ? (
                <div className="pdf-range-actions" role="toolbar" aria-label="Selection">
                  {rangeHasIncluded ? (
                    <button
                      type="button"
                      onClick={() =>
                        applyRange([{ op: "setExcluded", segments: rangeIds, excluded: true }])
                      }
                    >
                      Leave out
                    </button>
                  ) : null}
                  {rangeHasExcluded ? (
                    <button
                      type="button"
                      onClick={() =>
                        applyRange([{ op: "setExcluded", segments: rangeIds, excluded: false }])
                      }
                    >
                      Restore
                    </button>
                  ) : null}
                  <button type="button" onClick={importFromHere}>
                    Start here
                  </button>
                  <button
                    type="button"
                    className="pdf-range-clear"
                    aria-label="Clear selection"
                    onClick={() => setRange(null)}
                  >
                    <IconX size={12} stroke={1.8} />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <InlineEditor
            ref={setEditorRef}
            prayer={prayer}
            visibleVariants={visibleVariants}
            styles={styles}
            styleEditing={styleEditing}
            issues={issues}
            edits={edits}
            leadCell={pdfData ? undefined : leadCell}
            markedBlocks={markedBlocks}
            rowsAfter={pdfData ? pdfRowsAfter : rowsAfter}
            onChange={() => {}}
            onRenameKind={() => {}}
            onDeleteKind={() => {}}
            onSetKindSpeaker={() => {}}
          />
        </div>
      </div>

      {uncertain.hover ? (
        <div
          className="ocr-uncertain-tip"
          role="tooltip"
          style={{ left: uncertain.hover.left, top: uncertain.hover.top - 30 }}
        >
          <span>Unclear in the scan</span>
        </div>
      ) : null}

      {problemBlocks.length > 0 || uncertainBlocks.length > 0 || unpaired.length > 0 ? (
        <div className="import-status">
          {problemBlocks.length > 0 ? (
            <button
              type="button"
              className="import-status-item import-status-open"
              data-tone="bad"
              onClick={() => jumpToNext(problemBlocks)}
            >
              <IconAlertTriangle size={12} stroke={2} className="import-bad" />
              {problemBlocks.length} {problemBlocks.length === 1 ? "problem" : "problems"}
            </button>
          ) : null}
          {uncertainBlocks.length > 0 ? (
            <Tooltip label={shortcutLabel("Mod+J")} withArrow openDelay={500}>
              <button type="button" className="import-status-item import-status-open" onClick={nextUncertain}>
                <span className="import-chip-dot" />
                {uncertainBlocks.length} to check →
              </button>
            </Tooltip>
          ) : null}
          {unpaired.length > 0 ? (
            <button
              type="button"
              className="import-status-item import-status-open"
              onClick={() => jumpToNext(unpaired)}
            >
              <IconLink size={12} stroke={1.6} />
              {unpaired.length} unpaired →
            </button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        opened={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          onDiscard();
        }}
        title="Discard this import?"
        message="The text and your changes to it are dropped."
        confirmLabel="Discard"
      />
    </div>
  );
}
