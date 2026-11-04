import { describe, expect, it } from "vitest";
import { nativeEditContextMenu } from "../electron/nativeContextMenu";

describe("nativeEditContextMenu", () => {
  it("shows Cut/Copy/Paste for input and textarea fields", () => {
    expect(
      nativeEditContextMenu({
        isEditable: true,
        selectionText: "",
        formControlType: "input-text",
      }),
    ).toBe("edit");
    expect(
      nativeEditContextMenu({
        isEditable: true,
        selectionText: "hi",
        formControlType: "text-area",
      }),
    ).toBe("edit");
    expect(
      nativeEditContextMenu({
        isEditable: true,
        selectionText: "",
        formControlType: "input-search",
      }),
    ).toBe("edit");
  });

  it("leaves contenteditable to the renderer menu", () => {
    expect(
      nativeEditContextMenu({
        isEditable: true,
        selectionText: "Lord, have mercy",
        formControlType: "none",
      }),
    ).toBeNull();
  });

  it("offers Copy for selected non-editable text", () => {
    expect(
      nativeEditContextMenu({
        isEditable: false,
        selectionText: "preview",
        formControlType: "none",
      }),
    ).toBe("copy");
  });

  it("does nothing when there is no text field and no selection", () => {
    expect(
      nativeEditContextMenu({
        isEditable: false,
        selectionText: "",
        formControlType: "none",
      }),
    ).toBeNull();
  });
});
