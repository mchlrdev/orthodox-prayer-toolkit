import { useCallback, useMemo, useRef, useState, type Ref } from "react";
import { ActionIcon, Button, Tooltip } from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCheck,
  IconCircleOff,
} from "@tabler/icons-react";
import {
  draftBlockGroup,
  draftBlockVisible,
  locateValidationErrors,
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
import { shortcutLabel } from "../appCommands";
import { importContentErrors } from "../importDraft/contentErrors";
import {
  groupLetters,
  segmentIndex,
  sourceParts,
  type SegmentInfo,
} from "../importDraft/sourceView";
import { variantKey, type ActiveVariant } from "../variant";

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

type Props = {
  draft: ImportDraft;
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
};

export function ImportWorkspace({
  draft,
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
}: Props) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const variant = draft.variants[0]!;
  const col: ActiveVariant = { lang: variant.lang, variant: variant.variant };
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

  const leadCell = (blockId: string) => {
    const block = byId.get(blockId);
    if (!block) return null;
    const parts = sourceParts(block, segments);
    if (parts.length === 0) {
      return <div className="import-source-row" data-typed="true" />;
    }
    const peer =
      activeGroup !== undefined &&
      blockId !== activeBlockId &&
      draftBlockGroup(draft, block) === activeGroup;
    return parts.map((part, i) => {
      const letter = part.group ? letters.get(part.group) : undefined;
      return (
        <button
          type="button"
          key={`${part.n}-${i}`}
          className="import-source-row"
          data-group-peer={peer ? "true" : undefined}
          title={letter ? `Style group ${letter}` : undefined}
          onClick={() => selectBlock(blockId)}
        >
          <span className="import-source-n">{part.n}</span>
          <span className="import-source-group">
            {letter ? <span className="import-source-badge">{letter}</span> : null}
          </span>
          <span className="import-source-text" {...lookAttrs(part.look, bodySize)}>
            {part.text}
          </span>
        </button>
      );
    });
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
        <div key={block.id} className="import-excluded-row">
          <div className="inline-lead">
            {parts.map((part, i) => (
              <div key={`${part.n}-${i}`} className="import-source-row" data-excluded="true">
                <span className="import-source-n">{part.n}</span>
                <span className="import-source-group" />
                <span className="import-source-text" {...lookAttrs(part.look, bodySize)}>
                  {part.text}
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
          </div>
        </div>
      );
    });
  };

  const visibleCount = prayer.structure.length;
  const id = draft.meta.id;

  return (
    <div className="workspace import-workspace">
      <div className="workspace-header">
        <div className="workspace-header-top">
          <div className="import-title-row">
            <h1 className="workspace-title">{variant.title || "Untitled"}</h1>
            <span className="import-subtitle">
              Import draft · {source?.name ?? "Source"} · {segmentCount}{" "}
              {segmentCount === 1 ? "segment" : "segments"}
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
            {groupCount > 0 ? (
              <span>
                · {groupCount} style {groupCount === 1 ? "group" : "groups"}
              </span>
            ) : null}
          </div>
          <div className="import-column-label">
            <span className="import-caps">Preview</span>
            <span className="import-variant-chip">
              <span className="split-chip-lang">{col.lang}</span>
              <span className="split-chip-sep">/</span>
              <span className="split-chip-variant">{col.variant}</span>
            </span>
          </div>
        </div>
      </div>

      <div
        className="workspace-body"
        ref={(el) => assignRef(scrollRootRef, el)}
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
        <div className="workspace-body-inner import-body">
          <InlineEditor
            ref={setEditorRef}
            prayer={prayer}
            visibleVariants={visibleVariants}
            styles={styles}
            styleEditing={styleEditing}
            issues={issues}
            edits={edits}
            leadCell={leadCell}
            rowsAfter={rowsAfter}
            onChange={() => {}}
            onRenameKind={() => {}}
            onDeleteKind={() => {}}
            onSetKindSpeaker={() => {}}
          />
        </div>
      </div>

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
