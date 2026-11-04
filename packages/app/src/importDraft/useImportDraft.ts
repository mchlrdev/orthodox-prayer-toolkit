import { useCallback, useMemo, useRef, useState } from "react";
import {
  applyImportOps,
  createImportDraft,
  draftBlockGroup,
  draftCorrections,
  mergeCorrections,
  draftBlockPlainText,
  draftBlocksInGroup,
  importDraftToPrayer,
  createImportPrayerBuilder,
  suggestTitle,
  pairedLabelOps,
  type ImportDraft,
  type ImportOp,
  type ImportOrigin,
  type MemoryCorrection,
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
import { groupLetters, sample } from "./sourceView";
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
  /**
   * The user's corrections of model decisions so far (Library memory learns
   * those that still hold when the draft is saved).
   */
  corrections: MemoryCorrection[];
};

export type ImportDraftSession = {
  draft: ImportDraft | null;
  /** Changes whenever a draft starts or is discarded (chat and marks belong to one draft). */
  session: number;
  /** The draft right now, including changes made earlier in this turn. */
  currentDraft: () => ImportDraft | null;
  /** The user's corrections of model decisions in this draft so far. */
  corrections: () => MemoryCorrection[];
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
  apply: (
    ops: ImportOp[],
    options?: { coalesceKey?: string; origin?: ImportOrigin; coalesceAlways?: boolean },
  ) => boolean;
  undo: () => boolean;
  redo: () => boolean;
  /** Editor actions in the preview, as Import operations. */
  edits: EditorEdits;
};

const NO_FILES: Record<string, Uint8Array> = {};

/** A new language's ops, plus cutting its speaker labels where the block has that speaker. */
function withPairedLabels(draft: ImportDraft, ops: ImportOp[]): ImportOp[] {
  const result = applyImportOps(draft, ops);
  if (!result.ok) return ops;
  const added = result.draft.variants[result.draft.variants.length - 1]!.key;
  return [...ops, ...pairedLabelOps(result.draft, added)];
}

export function useImportDraft(): ImportDraftSession {
  const [state, setState] = useState<ImportState | null>(null);
  const [session, setSession] = useState(0);
  // Edits in one turn (flush, then structural edit) must see each other.
  const stateRef = useRef<ImportState | null>(null);

  const commit = useCallback((next: ImportState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const apply = useCallback(
    (
      ops: ImportOp[],
      options: {
        coalesceKey?: string;
        origin?: ImportOrigin;
        /** Join every step with the same coalesceKey, however long apart (a model run). */
        coalesceAlways?: boolean;
      } = {},
    ): boolean => {
      const cur = stateRef.current;
      if (!cur || ops.length === 0) return false;
      const result = applyImportOps(cur.draft, ops, options.origin);
      if (!result.ok) return false;
      if (JSON.stringify(result.draft) === JSON.stringify(cur.draft)) return true;
      const byUser = (options.origin?.by ?? "human") === "human";
      commit({
        ...cur,
        draft: result.draft,
        corrections: byUser
          ? mergeCorrections(cur.corrections, draftCorrections(cur.draft, result.draft))
          : cur.corrections,
        history: recordEdit(cur.history, cur.draft, {
          coalesceKey: options.coalesceKey ?? null,
          now: Date.now(),
          maxGap: options.coalesceAlways ? Number.POSITIVE_INFINITY : undefined,
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
      const ok = apply(withPairedLabels(cur.draft, addLanguageOps(cur.draft, source, { ...variant, origin })));
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
      return cur ? apply(withPairedLabels(cur.draft, addColumnOps(cur.draft, input))) : false;
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
        return {
          blockLabel: "Only this",
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
        variant: { ...variant, source: origin.trim(), title: suggestTitle(source) ?? "" },
      });
      commit({
        draft,
        history: emptyHistory<ImportDraft>(),
        files: file ? { [source.id]: file } : {},
        corrections: [],
      });
      setSession((n) => n + 1);
    },
    [commit],
  );

  // Reuses the Block of every draft block an op left alone, so the editor
  // re-renders only the rows that changed.
  const buildPrayerRef = useRef<((draft: ImportDraft) => Prayer) | null>(null);
  buildPrayerRef.current ??= createImportPrayerBuilder();
  const prayer = useMemo(
    () => (state ? buildPrayerRef.current!(state.draft) : null),
    [state],
  );

  return {
    draft: state?.draft ?? null,
    session,
    currentDraft: useCallback(() => stateRef.current?.draft ?? null, []),
    corrections: useCallback(() => stateRef.current?.corrections ?? [], []),
    files: state?.files ?? NO_FILES,
    prayer,
    canUndo: (state?.history.past.length ?? 0) > 0,
    canRedo: (state?.history.future.length ?? 0) > 0,
    start,
    addLanguage,
    addColumn,
    discard: useCallback(() => {
      commit(null);
      setSession((n) => n + 1);
    }, [commit]),
    apply,
    undo: useCallback(() => step(stepBack), [step]),
    redo: useCallback(() => step(stepForward), [step]),
    edits,
  };
}
