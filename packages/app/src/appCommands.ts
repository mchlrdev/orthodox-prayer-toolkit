/** App-wide commands: keyboard shortcuts and (macOS) menu items share these. */
export type AppCommand =
  | "new-prayer"
  | "open-library"
  | "save"
  | "save-all"
  | "settings"
  | "undo"
  | "redo";

export const APP_COMMANDS: readonly AppCommand[] = [
  "new-prayer",
  "open-library",
  "save",
  "save-all",
  "settings",
  "undo",
  "redo",
];

export function isAppCommand(value: unknown): value is AppCommand {
  return APP_COMMANDS.includes(value as AppCommand);
}

export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

type KeyLike = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

/** Cmd on macOS, Ctrl elsewhere. Returns null for keys that are not ours. */
export function commandForKey(e: KeyLike, mac: boolean): AppCommand | null {
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey) return null;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (key) {
    case "s":
      return e.shiftKey ? "save-all" : "save";
    case "o":
      return e.shiftKey ? null : "open-library";
    case "n":
      return e.shiftKey ? null : "new-prayer";
    case ",":
      return e.shiftKey ? null : "settings";
    case "z":
      return e.shiftKey ? "redo" : "undo";
    case "y":
      return !mac && !e.shiftKey ? "redo" : null;
    default:
      return null;
  }
}

/** Shortcut label for tooltips and menus, e.g. "⌘S" or "Ctrl+S". */
export function shortcutLabel(keys: string, mac = isMacPlatform()): string {
  if (mac) {
    return keys
      .replace(/Shift\+/g, "⇧")
      .replace(/Mod\+/g, "⌘");
  }
  return keys.replace(/Mod\+/g, "Ctrl+");
}

/**
 * Undo/redo belong to the text field while it holds typing the app has not
 * taken yet (inputs always; prayer cells until they commit).
 */
export function wantsNativeUndo(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !["checkbox", "radio", "button"].includes(el.type);
  }
  const editable = el.closest<HTMLElement>("[contenteditable='true'], [contenteditable='']");
  return editable?.dataset.uncommitted === "true";
}

/** Ask focused prayer cells to commit pending typing (before save). */
export const FLUSH_EDITS_EVENT = "opt:flush-edits";

export function flushPendingEdits(): void {
  window.dispatchEvent(new Event(FLUSH_EDITS_EVENT));
}
