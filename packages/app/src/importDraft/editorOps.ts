import {
  applyImportOps,
  draftBlocksInColumn,
  freeVariantKey,
  type Source,
  draftBlockPlainText,
  draftBlockVisible,
  type ImportDraft,
  type ImportOp,
  type InlineContent,
} from "@orthodox-prayer-toolkit/core";
import type { ActiveVariant } from "../variant";

/**
 * Editor actions on the Import draft preview → Import operations. The
 * preview is the normal InlineEditor; its offsets are the draft's plain-text
 * offsets (verse lines joined by "\n", text kinds by " ").
 */

type Content = InlineContent | InlineContent[] | null;

export function draftVariantKey(
  draft: ImportDraft,
  col: ActiveVariant,
): string | null {
  return (
    draft.variants.find((v) => v.lang === col.lang && v.variant === col.variant)
      ?.key ?? null
  );
}

function block(draft: ImportDraft, id: string) {
  return draft.blocks.find((b) => b.id === id);
}

/** Typing in a cell: set the block's text (notes from the content runs). */
export function commitOps(
  draft: ImportDraft,
  blockId: string,
  col: ActiveVariant,
  content: Content,
): ImportOp[] {
  const variant = draftVariantKey(draft, col);
  if (!variant || !block(draft, blockId)) return [];
  return [{ op: "setText", block: blockId, variant, content: content ?? "" }];
}

/**
 * Enter at `start`–`end` of the cell content: commit the cell, drop the
 * selection, split. Null when there would be no text on one side.
 */
export function splitOps(
  draft: ImportDraft,
  blockId: string,
  col: ActiveVariant,
  at: { content: Content; start: number; end: number },
): { ops: ImportOp[]; newBlockId: string } | null {
  const variant = draftVariantKey(draft, col);
  if (!variant || !block(draft, blockId)?.content[variant]) return null;
  const ops = commitOps(draft, blockId, col, at.content);
  const committed = applyImportOps(draft, ops);
  if (!committed.ok) return null;
  const length = draftBlockPlainText(
    committed.draft,
    block(committed.draft, blockId)!,
    variant,
  ).length;
  const start = Math.min(at.start, length);
  const end = Math.min(at.end, length);
  if (end > start) ops.push({ op: "removeText", block: blockId, variant, start, end });
  ops.push({ op: "split", block: blockId, variant, at: start });
  const result = applyImportOps(draft, ops);
  if (!result.ok) return null;
  return { ops, newBlockId: `b${draft.nextBlock}` };
}

function visibleNeighbour(
  draft: ImportDraft,
  index: number,
  dir: -1 | 1,
): number {
  for (let i = index + dir; i >= 0 && i < draft.blocks.length; i += dir) {
    if (draftBlockVisible(draft, draft.blocks[i]!)) return i;
  }
  return -1;
}

export type JoinPlan =
  | { kind: "removed"; ops: ImportOp[] }
  | {
      kind: "merged";
      ops: ImportOp[];
      survivorId: string;
      /** Caret in the survivor's plain text after the merge. */
      caret: number;
    };

/**
 * Backspace at a cell's start / Delete at its end. A block left without
 * text goes away; otherwise it merges with the neighbouring visible block.
 */
export function joinOps(
  draft: ImportDraft,
  blockId: string,
  col: ActiveVariant,
  direction: "backward" | "forward",
  current: Content,
): JoinPlan | null {
  const variant = draftVariantKey(draft, col);
  const index = draft.blocks.findIndex((b) => b.id === blockId);
  if (!variant || index < 0) return null;
  const commit = commitOps(draft, blockId, col, current);
  const committed = applyImportOps(draft, commit);
  if (!committed.ok) return null;
  const after = committed.draft;
  const self = block(after, blockId);
  if (!self || !draftBlockVisible(after, self)) {
    return { kind: "removed", ops: commit };
  }

  const backward = direction === "backward";
  const other = visibleNeighbour(after, after.blocks.indexOf(self), backward ? -1 : 1);
  if (other < 0) return null;
  const upper = backward ? after.blocks[other]! : self;
  const lower = backward ? self : after.blocks[other]!;
  const ops: ImportOp[] = [
    ...commit,
    { op: "merge", block: upper.id, keep: backward ? "lower" : "upper" },
  ];
  const merged = applyImportOps(draft, ops);
  if (!merged.ok) return null;
  const survivorId = backward ? lower.id : upper.id;
  const survivor = block(merged.draft, survivorId)!;
  const full = draftBlockPlainText(merged.draft, survivor, variant).length;
  const upperLen = draftBlockPlainText(after, upper, variant).length;
  const lowerLen = draftBlockPlainText(after, lower, variant).length;
  return {
    kind: "merged",
    ops,
    survivorId,
    caret: backward ? full - lowerLen : upperLen,
  };
}

/** Move one step among the blocks the editor shows. */
export function moveOps(
  draft: ImportDraft,
  blockId: string,
  dir: -1 | 1,
): ImportOp[] {
  const index = draft.blocks.findIndex((b) => b.id === blockId);
  if (index < 0) return [];
  const to = visibleNeighbour(draft, index, dir);
  if (to < 0) return [];
  return [{ op: "moveBlock", block: blockId, to }];
}

export type AddColumnInput = {
  /** 0-based text column (`segmentColumn`). */
  column: number;
  origin: string;
  variant: ActiveVariant;
};

/** Second language from another Source: new Variant, its blocks, paired by order. */
export function addLanguageOps(
  draft: ImportDraft,
  source: Source,
  { origin, ...variant }: ActiveVariant & { origin: string },
): ImportOp[] {
  const key = freeVariantKey(draft);
  return [
    { op: "addVariant", variant: { ...variant, source: origin.trim() } },
    { op: "addSource", source, variant: key },
    { op: "pairByOrder", variant: key },
  ];
}

/**
 * Second language from a column of the draft's Source: the column's blocks
 * move to a new Variant and pair row by row with the first column's blocks.
 * Blocks outside both columns (a heading across the page) stay as they are.
 */
export function addColumnOps(draft: ImportDraft, { column, origin, variant }: AddColumnInput): ImportOp[] {
  const from = draft.variants[0]!.key;
  const key = freeVariantKey(draft);
  const first = draftBlocksInColumn(draft, 0, from);
  const moved = draftBlocksInColumn(draft, column, from);
  return [
    { op: "addVariant", variant: { ...variant, source: origin.trim() } },
    { op: "assignVariant", blocks: moved.map((b) => b.id), from, to: key },
    ...moved.slice(0, first.length).map(
      (b, i): ImportOp => ({ op: "pairVariant", block: first[i]!.id, variant: key, from: b.id }),
    ),
  ];
}
