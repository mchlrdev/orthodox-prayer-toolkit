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
} from "@tabler/icons-react";
import {
  draftBlockGroup,
  draftBlockSegments,
  draftBlockVisible,
  kindDisplayLabel,
  locateValidationErrors,
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
  groupLetters,
  segmentIndex,
  markedPieces,
  sample,
  sourceParts,
  type SourcePart,
  type SegmentInfo,
} from "../importDraft/sourceView";
import { variantKey, type ActiveVariant } from "../variant";
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
        title="Formatted differently in the source: maybe a note"
      >
        {piece.text}
      </span>
    ) : (
      piece.text
    ),
  );
}

export type ChatHighlight = {
  answer: number;
  /** Changed block → what changed ("Speaker Priest · label removed"). */
  lines: ReadonlyMap<string, string>;
  /** The answer changed wording, not just structure. */
  wording: boolean;
  canUndo: boolean;
  onUndo: () => void;
  onHide: () => void;
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
  /** Prayer ids already in the library (for the id status). */
  takenIds: ReadonlySet<string>;
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
  takenIds,
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
}: Props) {
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
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const uncertain = useUncertainWords(bodyRef, draft, variant.key, variantKey(col));
  const visibleVariants = useMemo(
    () => [col],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [col.lang, col.variant],
  );
  const segments = useMemo(() => segmentIndex(draft), [draft.sources]);
  const letters = useMemo(() => groupLetters(draft), [draft.sources]);
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
  const segmentCount = segments.size;
  const groupCount = new Set(
    [...segments.values()].map((s) => s.group).filter(Boolean),
  ).size;
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

  const langOf = (key: string) => draft.variants.find((v) => v.key === key)?.lang ?? key;
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
              No counterpart in {missing.map((v) => v.lang).join(", ")}
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
                  Paired with {v.lang}
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

  /** What the model decided about a block: pending, speaker taken from a label, uncertain. */
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
      ? (draft.variants.find((v) => v.speakers?.[block.speaker!])?.speakers?.[block.speaker!]?.name ?? block.speaker)
      : null;
    return (
      <div className="import-pair-row" onMouseDown={(e) => e.preventDefault()}>
        {pending ? (
          <span className="import-chip" data-muted="true">
            <Spinner size={10} />
            Model checking …
          </span>
        ) : null}
        {speakerByModel ? (
          <span className="import-chip" data-tone={uncertainSpeaker ? "warning" : undefined}>
            <IconUser size={11} stroke={1.6} />
            „{speakerName}:“ → Speaker
            {uncertainSpeaker ? ` · ${Math.round(uncertainSpeaker.confidence * 100)} %` : ""}
          </span>
        ) : null}
        {uncertainKind ? (
          <button
            type="button"
            className="import-chip"
            data-tone="warning"
            data-action="true"
            title={`Keep ${kindDisplayLabel(block.kind)}`}
            onClick={() => onApply([{ op: "setKind", target: { block: block.id }, kind: block.kind }])}
          >
            <span className="import-chip-dot" />
            Kind uncertain · {Math.round(uncertainKind.confidence * 100)} %
          </button>
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
    return line ? (
      <div className="import-answer-line">
        Answer {chatHighlight!.answer} · {line}
      </div>
    ) : null;
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
        {parts.map((part, i) => {
          const letter = part.group ? letters.get(part.group) : undefined;
          return (
            <button
              type="button"
              key={`${part.n}-${i}`}
              className="import-source-row"
              data-group-peer={peer ? "true" : undefined}
              data-other={other ? "true" : undefined}
              title={
                other
                  ? `Only in ${Object.keys(block.content).map(langOf).join(", ")}`
                  : letter
                    ? `Style group ${letter}`
                    : undefined
              }
              onClick={() => selectBlock(blockId)}
            >
              <span className="import-source-n">{part.n}</span>
              <span className="import-source-group">
                {letter ? <span className="import-source-badge">{letter}</span> : null}
              </span>
              <span className="import-source-text" {...lookAttrs(part.look, bodySize)}>
                <MarkedText part={part} />
              </span>
            </button>
          );
        })}
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
                <span className="import-source-group" />
                <span className="import-source-text" {...lookAttrs(part.look, bodySize)}>
                  <MarkedText part={part} />
                </span>
              </div>
            ))}
            <div className="import-excluded-actions">
              <span className="import-excluded-label">
                <IconCircleOff size={11} stroke={1.6} />
                Excluded
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
                Include
              </button>
            </div>
            {answerLine(block.id)}
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
  const pageCount = Math.max(1, ...allSegments.map((s) => s.area?.page ?? 1));

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
  /** "Uncertain first": the next uncertain block after the one being edited. */
  const nextUncertain = () => {
    if (uncertainBlocks.length === 0) return;
    const order = draft.blocks.map((b) => b.id);
    const at = activeBlockId ? order.indexOf(activeBlockId) : -1;
    const next =
      uncertainBlocks.find((b) => order.indexOf(b.id) > at) ?? uncertainBlocks[0]!;
    localEditorRef.current?.revealBlock(next.id, {
      scroll: "smooth-center",
      focusCol: col,
      flash: true,
      caret: "start",
    });
  };

  const visibleCount = prayer.structure.length;
  const variantCounts = new Map(
    draft.variants.map((v) => [
      v.key,
      prayer.structure.filter((b) =>
        b.translations.some((t) => t.lang === v.lang && t.variant === v.variant),
      ).length,
    ]),
  );
  const pairedCount = prayer.structure.filter(
    (b) => b.translations.length === draft.variants.length,
  ).length;
  const id = draft.meta.id;

  return (
    <div className="workspace import-workspace" data-pdf={pdfData ? "true" : undefined}>
      <div className="workspace-header">
        <div className="workspace-header-top">
          <div className="import-title-row">
            <h1 className="workspace-title">{draft.variants[0]!.title || "Untitled"}</h1>
            <span className="import-subtitle">
              Import draft · {source?.name ?? "Source"} ·{" "}
              {pageFormat === "image"
                ? "Text recognised"
                : pdfData
                ? `Page ${pdfPage} of ${pageCount}`
                : `${segmentCount} ${segmentCount === 1 ? "segment" : "segments"}`}
            </span>
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
              disabled={visibleCount === 0 || errors.length > 0}
              onClick={onSave}
            >
              Save to library
            </Button>
          </div>
        </div>
        <div className="import-columns">
          <div className="import-column-label">
            <span className="import-caps">Source</span>
            {pdfData && pageFormat !== "image" ? <span>· Page {pdfPage}</span> : null}
            {scanSummary ? (
              <span>
                · {scanSummary.sure} % sure
                {scanSummary.doubtful > 0 ? ` · ${scanSummary.doubtful} uncertain` : ""}
              </span>
            ) : groupCount > 0 ? (
              <span>
                · {groupCount} style {groupCount === 1 ? "group" : "groups"}
              </span>
            ) : null}
          </div>
          <div className="import-column-label">
            <span className="import-caps">Preview</span>
            <Menu shadow="md" width={240} position="bottom-end" withinPortal>
              <Menu.Target>
                <button type="button" className="import-variant-chip" aria-label="Shown language">
                  <span className="split-chip-lang">{col.lang}</span>
                  <span className="split-chip-sep">/</span>
                  <span className="split-chip-variant">{col.variant}</span>
                  <IconChevronDown size={11} stroke={1.8} className="import-variant-caret" />
                </button>
              </Menu.Target>
              <Menu.Dropdown>
                {draft.variants.map((v) => (
                  <Menu.Item
                    key={v.key}
                    onClick={() => setShownKey(v.key)}
                    rightSection={
                      <span className="import-variant-count">
                        {variantCounts.get(v.key) ?? 0} of {visibleCount}
                        {v.key === variant.key ? <IconCheck size={13} stroke={2} /> : null}
                      </span>
                    }
                  >
                    <span className="split-chip-lang">{v.lang}</span>{" "}
                    <span className="split-chip-sep">/</span>{" "}
                    <span className="split-chip-variant">{v.variant}</span>
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item onClick={onAddLanguage}>Add language from source…</Menu.Item>
              </Menu.Dropdown>
            </Menu>
            {multilingual ? (
              <span className="import-pair-status">
                <IconLink size={12} stroke={1.6} />
                {pairedCount} paired · {visibleCount - pairedCount} open
              </span>
            ) : null}
          </div>
        </div>
        {firstDraft.progress ? (
          <div className="import-model-banner" role="status">
            <Spinner />
            <span>
              Model is sorting
              {firstDraft.progress.total > 0
                ? ` · ${firstDraft.progress.done} of ${firstDraft.progress.total}`
                : " …"}
            </span>
            <span className="import-model-banner-hint">You can already edit; your changes win.</span>
            <button type="button" className="import-model-banner-action" onClick={firstDraft.stop}>
              Stop
            </button>
          </div>
        ) : chatHighlight ? (
          <div className="import-model-banner" data-tone="answer" role="status">
            <span className="import-answer-mark" />
            <span>
              Answer {chatHighlight.answer} changed {chatHighlight.lines.size}{" "}
              {chatHighlight.lines.size === 1 ? "section" : "sections"}
            </span>
            <span className="import-model-banner-hint">
              {chatHighlight.wording ? "Wording changed" : "Text unchanged"}
            </span>
            {chatHighlight.canUndo ? (
              <button type="button" className="import-model-banner-action" onClick={chatHighlight.onUndo}>
                <IconArrowBackUp size={12} stroke={1.8} />
                Undo
              </button>
            ) : null}
            <button
              type="button"
              className="import-model-banner-action"
              data-muted="true"
              onClick={chatHighlight.onHide}
            >
              Hide
            </button>
          </div>
        ) : firstDraft.error ? (
          <div className="import-model-banner" role="alert">
            <IconAlertTriangle size={12} stroke={2} className="import-bad" />
            <span className="import-model-banner-hint">The model stopped: {firstDraft.error}</span>
            <button type="button" className="import-model-banner-action" onClick={firstDraft.dismissError}>
              Dismiss
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
          if (!next?.isContentEditable) setActiveBlockId(null);
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
                letters={letters}
                excluded={excludedSet}
                active={activeSegs}
                selected={range?.ids ?? new Set()}
                onSegmentClick={onSegmentClick}
              />
              {rangeIds.length > 0 ? (
                <div className="pdf-range-actions" role="toolbar" aria-label="Selected segments">
                  {rangeHasIncluded ? (
                    <button
                      type="button"
                      onClick={() =>
                        applyRange([{ op: "setExcluded", segments: rangeIds, excluded: true }])
                      }
                    >
                      Exclude
                    </button>
                  ) : null}
                  {rangeHasExcluded ? (
                    <button
                      type="button"
                      onClick={() =>
                        applyRange([{ op: "setExcluded", segments: rangeIds, excluded: false }])
                      }
                    >
                      Include
                    </button>
                  ) : null}
                  <button type="button" onClick={importFromHere}>
                    Import from here
                  </button>
                  <button type="button" className="pdf-range-clear" onClick={() => setRange(null)}>
                    Clear
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
            rowsAfter={pdfData ? undefined : rowsAfter}
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
          <span>
            Read with low confidence
            {uncertain.hover.confidence !== undefined ? ` (${Math.round(uncertain.hover.confidence * 100)} %)` : ""}
          </span>
          <span className="ocr-uncertain-tip-hint">Check it against the scan</span>
        </div>
      ) : null}

      <div className="import-status">
        <span className="import-status-item">
          {errors.length === 0 ? (
            <>
              <IconCheck size={12} stroke={2} className="import-ok" />
              {visibleCount} {visibleCount === 1 ? "block" : "blocks"} · valid prayer
            </>
          ) : (
            <>
              <IconAlertTriangle size={12} stroke={2} className="import-bad" />
              {errors.length} {errors.length === 1 ? "issue" : "issues"}
            </>
          )}
        </span>
        {uncertainBlocks.length > 0 ? (
          <button
            type="button"
            className="import-status-item import-status-open"
            title="Go to the next uncertain decision"
            onClick={nextUncertain}
          >
            <span className="import-chip-dot" />
            {uncertainBlocks.length} open {uncertainBlocks.length === 1 ? "decision" : "decisions"}
          </button>
        ) : null}
        {id ? (
          <span className="import-status-id">
            ID {id} · {takenIds.has(id) ? "taken" : "free"}
          </span>
        ) : null}
      </div>

      <ConfirmDialog
        opened={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          onDiscard();
        }}
        title="Discard import draft?"
        message="The pasted text and every change to it are dropped."
        confirmLabel="Discard"
      />
    </div>
  );
}
