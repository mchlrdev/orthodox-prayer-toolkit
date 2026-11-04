import { restoreSelectionOffsets } from "./inlineDom";

export type EditorClipboardAction = "cut" | "copy" | "paste";

function insertAtSelection(editor: HTMLElement, text: string): void {
  const inserted = document.execCommand("insertText", false, text);
  if (inserted) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  editor.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
  );
}

/**
 * Cut / copy / paste against a contenteditable cell.
 *
 * The context menu steals focus, so callers pass the selection from right-click
 * time and we restore it before talking to the clipboard. `fallbackPaste` is
 * Electron `webContents.paste()` when `navigator.clipboard.readText` is blocked.
 */
export async function runEditorClipboardAction(
  action: EditorClipboardAction,
  editor: HTMLElement,
  offsets: { start: number; end: number },
  fallbackPaste?: () => Promise<void>,
): Promise<void> {
  if (!editor.isConnected) return;
  restoreSelectionOffsets(editor, offsets.start, offsets.end);

  if (action === "copy" || action === "cut") {
    const text = window.getSelection()?.toString() ?? "";
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        restoreSelectionOffsets(editor, offsets.start, offsets.end);
        document.execCommand("copy");
      }
    }
    if (action === "cut" && text) {
      restoreSelectionOffsets(editor, offsets.start, offsets.end);
      document.execCommand("delete");
    }
    return;
  }

  let text: string | null = null;
  try {
    text = navigator.clipboard
      ? await navigator.clipboard.readText()
      : null;
  } catch {
    restoreSelectionOffsets(editor, offsets.start, offsets.end);
    if (fallbackPaste) await fallbackPaste();
    return;
  }
  if (text === null) {
    restoreSelectionOffsets(editor, offsets.start, offsets.end);
    if (fallbackPaste) await fallbackPaste();
    return;
  }
  restoreSelectionOffsets(editor, offsets.start, offsets.end);
  if (text) insertAtSelection(editor, text);
}
