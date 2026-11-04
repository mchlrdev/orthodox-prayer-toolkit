/** Form controls that should get Electron's native Cut/Copy/Paste menu. */
const TEXT_FIELDS = new Set([
  "input-email",
  "input-number",
  "input-password",
  "input-search",
  "input-telephone",
  "input-text",
  "input-url",
  "text-area",
]);

export type NativeEditContextMenu = "edit" | "copy" | null;

/**
 * Native edit menu for `<input>` / `<textarea>` only. Block cells are
 * contenteditable and already have the renderer's right-click menu.
 */
export function nativeEditContextMenu(params: {
  isEditable: boolean;
  selectionText: string;
  formControlType: string;
}): NativeEditContextMenu {
  if (TEXT_FIELDS.has(params.formControlType)) return "edit";
  if (params.isEditable) return null;
  if (params.selectionText) return "copy";
  return null;
}
