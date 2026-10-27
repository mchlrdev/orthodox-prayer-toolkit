import { useCallback, useMemo, useRef, useState } from "react";
import {
  applyImportOps,
  createImportDraft,
  importDraftToPrayer,
  readText,
  type ImportDraft,
  type ImportOp,
  type Prayer,
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
import {
  commitOps,
  joinOps,
  moveOps,
  splitOps,
  draftVariantKey,
} from "./editorOps";

export type StartImportInput = {
  text: string;
  /** Where the text comes from (Variant `source`, e.g. a site name). */
  origin: string;
  variant: ActiveVariant;
};

type ImportState = {
  draft: ImportDraft;
  history: DraftHistory<ImportDraft>;
};

export type ImportDraftSession = {
  draft: ImportDraft | null;
  /** The Prayer the draft stands for (what the preview edits). */
  prayer: Prayer | null;
  canUndo: boolean;
  canRedo: boolean;
  start: (input: StartImportInput) => void;
  discard: () => void;
  /** Apply Import operations as one undo step; false when one is refused. */
  apply: (ops: ImportOp[], options?: { coalesceKey?: string }) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  /** Editor actions in the preview, as Import operations. */
  edits: EditorEdits;
};

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

  const step = useCallback(
    (fn: typeof stepBack<ImportDraft>): boolean => {
      const cur = stateRef.current;
      if (!cur) return false;
      const moved = fn(cur.history, cur.draft);
      if (!moved) return false;
      commit({ draft: moved.prayer, history: moved.history });
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
    };
  }, [apply]);

  const start = useCallback(
    ({ text, origin, variant }: StartImportInput) => {
      const draft = createImportDraft({
        sources: [readText(text)],
        variant: { ...variant, source: origin.trim() },
      });
      commit({ draft, history: emptyHistory<ImportDraft>() });
    },
    [commit],
  );

  const prayer = useMemo(
    () => (state ? importDraftToPrayer(state.draft) : null),
    [state],
  );

  return {
    draft: state?.draft ?? null,
    prayer,
    canUndo: (state?.history.past.length ?? 0) > 0,
    canRedo: (state?.history.future.length ?? 0) > 0,
    start,
    discard: useCallback(() => commit(null), [commit]),
    apply,
    undo: useCallback(() => step(stepBack), [step]),
    redo: useCallback(() => step(stepForward), [step]),
    edits,
  };
}
