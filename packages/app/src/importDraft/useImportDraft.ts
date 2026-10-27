import { useCallback, useMemo, useRef, useState } from "react";
import {
  applyImportOps,
  createImportDraft,
  draftBlockGroup,
  draftBlockPlainText,
  draftBlocksInGroup,
  importDraftToPrayer,
  type ImportDraft,
  type ImportOp,
  type Prayer,
  type Source,
} from "@orthodox-prayer-toolkit/core";
import type { EditorEdits } from "../components/InlineEditor";
import { getTranslation, translationEditorContent } from "../prayerEdit";
import {
  emptyHistory,
  recordEdit,
  stepBack,
  stepForward,
  type DraftHistory,
} from "../session/history";
import { variantKey, type ActiveVariant } from "../variant";
import { groupLetters, sample, segmentIndex, sourceParts } from "./sourceView";
import {
  addColumnOps,
  addLanguageOps,
  commitOps,
  joinOps,
  moveOps,
  splitOps,
  draftVariantKey,
} from "./editorOps";

export type { AddColumnInput } from "./editorOps";
import type { AddColumnInput } from "./editorOps";

export type StartImportInput = {
  /** What a Reader made of the pasted text, file or page. */
  source: Source;
  /** The file itself when the Source view draws it (PDF pages). */
  file?: Uint8Array;
  /** Where the text comes from (Variant `source`, e.g. a site name). */
  origin: string;
  variant: ActiveVariant;
};

type ImportState = {
  draft: ImportDraft;
  history: DraftHistory<ImportDraft>;
  /** Source files by Source id; not part of the draft or its undo. */
  files: Record<string, Uint8Array>;
};

export type ImportDraftSession = {
  draft: ImportDraft | null;
  /** Source files by Source id (PDF bytes for the page view). */
  files: Record<string, Uint8Array>;
  /** The Prayer the draft stands for (what the preview edits). */
  prayer: Prayer | null;
  canUndo: boolean;
  canRedo: boolean;
  start: (input: StartImportInput) => void;
  /** Second language from another Source, paired by order (one undo step). */
  addLanguage: (input: StartImportInput) => boolean;
  /** Second language from a column of a Source in the draft, paired row by row. */
  addColumn: (input: AddColumnInput) => boolean;
  discard: () => void;
  /** Apply Import operations as one undo step; false when one is refused. */
  apply: (ops: ImportOp[], options?: { coalesceKey?: string }) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  /** Editor actions in the preview, as Import operations. */
  edits: EditorEdits;
};

const NO_FILES: Record<string, Uint8Array> = {};

export function useImportDraft(): ImportDraftSession {
  const [state, setState] = useState<ImportState | null>(null);
  // Edits in one turn (flush, then structural edit) must see each other.
  const stateRef = useRef<ImportState | null>(null);

  const commit = useCallback((next: ImportState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const apply = useCallback(
    (ops: ImportOp[], options: { coalesceKey?: string } = {}): boolean => {
      const cur = stateRef.current;
      if (!cur || ops.length === 0) return false;
      const result = applyImportOps(cur.draft, ops);
      if (!result.ok) return false;
      if (JSON.stringify(result.draft) === JSON.stringify(cur.draft)) return true;
      commit({
        ...cur,
        draft: result.draft,
        history: recordEdit(cur.history, cur.draft, {
          coalesceKey: options.coalesceKey ?? null,
          now: Date.now(),
        }),
      });
      return true;
    },
    [commit],
  );

  const addLanguage = useCallback(
    ({ source, file, origin, variant }: StartImportInput): boolean => {
      const cur = stateRef.current;
      if (!cur) return false;
      const ok = apply(addLanguageOps(cur.draft, source, { ...variant, origin }));
      if (ok && file) {
        const next = stateRef.current!;
        commit({ ...next, files: { ...next.files, [source.id]: file } });
      }
      return ok;
    },
    [apply, commit],
  );

  const addColumn = useCallback(
    (input: AddColumnInput): boolean => {
      const cur = stateRef.current;
      return cur ? apply(addColumnOps(cur.draft, input)) : false;
    },
    [apply],
  );

  const step = useCallback(
    (fn: typeof stepBack<ImportDraft>): boolean => {
      const cur = stateRef.current;
      if (!cur) return false;
      const moved = fn(cur.history, cur.draft);
      if (!moved) return false;
      commit({ ...cur, draft: moved.prayer, history: moved.history });
      return true;
    },
    [commit],
  );

  const edits = useMemo<EditorEdits>(() => {
    const draft = () => stateRef.current!.draft;
    return {
      commit: (blockId, col, content) => {
        apply(commitOps(draft(), blockId, col, content), {
          coalesceKey: `${blockId}\0${variantKey(col)}`,
        });
      },
      split: (blockId, col, at) => {
        const plan = splitOps(draft(), blockId, col, at);
        if (!plan || !apply(plan.ops)) return null;
        return plan.newBlockId;
      },
      join: (blockId, col, direction, current) => {
        const plan = joinOps(draft(), blockId, col, direction, current);
        if (!plan || !apply(plan.ops)) return null;
        if (plan.kind === "removed") return { kind: "removed" };
        const prayer = importDraftToPrayer(draft());
        const block = prayer.structure.find((b) => b.id === plan.survivorId);
        if (!block || !draftVariantKey(draft(), col)) return null;
        return {
          kind: "merged",
          content: translationEditorContent(
            block.kind,
            getTranslation(prayer, block.id, col),
          ),
          caret: plan.caret,
        };
      },
      setKind: (blockId, kind) => {
        apply([{ op: "setKind", target: { block: blockId }, kind }]);
      },
      setSpeaker: (blockId, speaker) => {
        apply([{ op: "setSpeaker", block: blockId, speaker }]);
      },
      remove: (blockId) => {
        apply([{ op: "deleteBlock", block: blockId }]);
      },
      move: (blockId, dir) => {
        apply(moveOps(draft(), blockId, dir));
      },
      kindGroup: (blockId) => {
        const d = draft();
        const block = d.blocks.find((b) => b.id === blockId);
        const group = block ? draftBlockGroup(d, block) : undefined;
        if (!block || !group) return null;
        const members = draftBlocksInGroup(d, group);
        if (members.length < 2) return null;
        const key = d.variants[0]!.key;
        const n = sourceParts(block, segmentIndex(d))[0]?.n;
        return {
          blockLabel: n !== undefined ? `Segment ${n}` : "This block",
          letter: groupLetters(d).get(group) ?? "",
          count: members.length,
          samples: members
            .filter((b) => b.id !== blockId)
            .slice(0, 2)
            .map((b) => sample(draftBlockPlainText(d, b, key), 20)),
          onChangeGroup: (kind) => {
            apply([{ op: "setKind", target: { group }, kind }]);
          },
        };
      },
    };
  }, [apply]);

  const start = useCallback(
    ({ source, file, origin, variant }: StartImportInput) => {
      const draft = createImportDraft({
        sources: [source],
        variant: { ...variant, source: origin.trim() },
      });
      commit({
        draft,
        history: emptyHistory<ImportDraft>(),
        files: file ? { [source.id]: file } : {},
      });
    },
    [commit],
  );

  const prayer = useMemo(
    () => (state ? importDraftToPrayer(state.draft) : null),
    [state],
  );

  return {
    draft: state?.draft ?? null,
    files: state?.files ?? NO_FILES,
    prayer,
    canUndo: (state?.history.past.length ?? 0) > 0,
    canRedo: (state?.history.future.length ?? 0) > 0,
    start,
    addLanguage,
    addColumn,
    discard: useCallback(() => commit(null), [commit]),
    apply,
    undo: useCallback(() => step(stepBack), [step]),
    redo: useCallback(() => step(stepForward), [step]),
    edits,
  };
}
