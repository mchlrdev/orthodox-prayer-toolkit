/**
 * Commit/sync policy for a contenteditable Block cell on blur.
 *
 * `skipBlurCommit` is for ops that already applied the cell and are moving
 * focus (join / split / spill). Note-toolbar mousedown also arms it in case
 * the click steals focus — but preventDefault usually keeps the caret, so
 * blur never fires and a leftover skip would drop later typing/deletes.
 */

export type EditableBlurDecision =
  | "ignore-toolbar"
  | "skip-commit"
  | "keep-dom"
  | "commit";

export function editableBlurDecision(opts: {
  relatedIsNoteToolbar: boolean;
  skipBlurCommit: boolean;
  dirty: boolean;
}): EditableBlurDecision {
  if (opts.relatedIsNoteToolbar) return "ignore-toolbar";
  if (opts.skipBlurCommit) return "skip-commit";
  if (!opts.dirty) return "keep-dom";
  return "commit";
}

/**
 * Arm skip-blur-commit for a note-toolbar mousedown, then drop it after this
 * turn if blur never consumed it. Structural ops (join/split/spill) must set
 * the ref directly — their blur happens on a later task after focus moves.
 */
export function armTransientSkipBlurCommit(skipRef: {
  current: boolean;
}): void {
  skipRef.current = true;
  queueMicrotask(() => {
    skipRef.current = false;
  });
}
