/**
 * Idle-debounce policy for committing a contenteditable Block cell into the
 * Session draft. Typing stays in the DOM until idle, flush, or blur.
 *
 * One model for every Kind: headings are not live-committed per keystroke.
 * Outline labels catch up after idle instead of every key, so undo stays
 * native during a burst and session undo after the draft updates.
 *
 * Idle commit must not arm skip-blur-commit. That flag is only for ops that
 * already applied the cell (join / split / spill) or a note-toolbar click.
 */

export const IDLE_COMMIT_DELAY_MS = 400;

export type IdleCommitTrigger =
  | { type: "input"; isComposing: boolean }
  | { type: "paste" }
  | { type: "compositionend" }
  | { type: "blur" }
  | { type: "flush" }
  /** Note toggle, join, split, or spill — those paths already commit/paint. */
  | { type: "structural" };

export type IdleCommitAction = "arm" | "cancel" | "noop";

export type IdleCommitTimer = { id: ReturnType<typeof setTimeout> | null };

export function idleCommitDecision(
  trigger: IdleCommitTrigger,
): IdleCommitAction {
  switch (trigger.type) {
    case "input":
      return trigger.isComposing ? "noop" : "arm";
    case "paste":
    case "compositionend":
      return "arm";
    case "blur":
    case "flush":
    case "structural":
      return "cancel";
  }
}

export function nativeEventIsComposing(nativeEvent: Event): boolean {
  return (
    "isComposing" in nativeEvent &&
    (nativeEvent as { isComposing: boolean }).isComposing === true
  );
}

export function cancelIdleCommitTimer(timer: IdleCommitTimer): void {
  if (timer.id === null) return;
  clearTimeout(timer.id);
  timer.id = null;
}

export function armIdleCommitTimer(
  timer: IdleCommitTimer,
  onIdle: () => void,
): void {
  cancelIdleCommitTimer(timer);
  timer.id = setTimeout(() => {
    timer.id = null;
    onIdle();
  }, IDLE_COMMIT_DELAY_MS);
}

export function applyIdleCommitTrigger(
  timer: IdleCommitTimer,
  trigger: IdleCommitTrigger,
  onIdle: () => void,
): IdleCommitAction {
  const action = idleCommitDecision(trigger);
  if (action === "arm") armIdleCommitTimer(timer, onIdle);
  else if (action === "cancel") cancelIdleCommitTimer(timer);
  return action;
}
