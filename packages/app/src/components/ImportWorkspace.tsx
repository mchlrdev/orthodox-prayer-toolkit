import { useMemo, useState, type Ref } from "react";
import { ActionIcon, Button, Tooltip } from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCheck,
  IconCircleOff,
} from "@tabler/icons-react";
import {
  draftBlockVisible,
  locateValidationErrors,
  type DraftBlock,
  type DraftSpan,
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
import { variantKey, type ActiveVariant } from "../variant";

type StyleEditing = Parameters<typeof InlineEditor>[0]["styleEditing"];

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

function segmentIndex(draft: ImportDraft): Map<string, { n: number; text: string; group?: string }> {
  const out = new Map<string, { n: number; text: string; group?: string }>();
  let n = 0;
  for (const source of draft.sources) {
    for (const seg of source.segments) {
      n += 1;
      out.set(seg.id, { n, text: seg.text, group: seg.group });
    }
  }
  return out;
}

function groupLetter(draft: ImportDraft, group: string | undefined): string | null {
  if (!group) return null;
  const groups: string[] = [];
  for (const source of draft.sources) {
    for (const seg of source.segments) {
      if (seg.group && !groups.includes(seg.group)) groups.push(seg.group);
    }
  }
  const i = groups.indexOf(group);
  return i < 0 ? null : String.fromCharCode(65 + (i % 26));
}

type SourcePart = { n: number; text: string; group?: string };

/** The Source text a block points at, per segment (first Variant with text). */
function sourceParts(
  block: DraftBlock,
  segments: ReturnType<typeof segmentIndex>,
): SourcePart[] {
  const spans: DraftSpan[] =
    Object.values(block.content).find((s) => s.some((x) => "seg" in x)) ?? [];
  // One part per run of spans into the same segment: its text from the first
  // span's start to the last span's end, as the Source has it.
  const runs: Array<{ seg: string; start: number; end: number }> = [];
  for (const span of spans) {
    if (!("seg" in span)) continue;
    const last = runs[runs.length - 1];
    if (last && last.seg === span.seg && span.start >= last.end) last.end = span.end;
    else runs.push({ seg: span.seg, start: span.start, end: span.end });
  }
  return runs.flatMap((run) => {
    const seg = segments.get(run.seg);
    if (!seg) return [];
    const text = seg.text.slice(run.start, run.end).trim();
    return [{ n: seg.n, text, group: seg.group }];
  });
}

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

  const leadCell = (blockId: string) => {
    const block = byId.get(blockId);
    if (!block) return null;
    const parts = sourceParts(block, segments);
    if (parts.length === 0) {
      return <div className="import-source-row" data-typed="true" />;
    }
    return parts.map((part, i) => {
      const letter = groupLetter(draft, part.group);
      return (
        <div key={`${part.n}-${i}`} className="import-source-row">
          <span className="import-source-n">{part.n}</span>
          <span className="import-source-group">
            {letter ? <span className="import-source-badge">{letter}</span> : null}
          </span>
          <span className="import-source-text">{part.text}</span>
        </div>
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
                <span className="import-source-text">{part.text}</span>
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
        ref={(el) => {
          if (!scrollRootRef) return;
          if (typeof scrollRootRef === "function") scrollRootRef(el);
          else scrollRootRef.current = el;
        }}
      >
        <div className="workspace-body-inner import-body">
          <InlineEditor
            ref={editorRef}
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
