import { describe, expect, it } from "vitest";
import { kindFontSizeToEditor } from "../src/kindFontSize";

describe("kindFontSizeToEditor", () => {
  it("turns stored rem sizes into em so they follow the editor base", () => {
    expect(kindFontSizeToEditor("1rem")).toBe("1em");
    expect(kindFontSizeToEditor("0.875rem")).toBe("0.875em");
    expect(kindFontSizeToEditor("1.125rem")).toBe("1.125em");
    expect(kindFontSizeToEditor(" 1.35rem ")).toBe("1.35em");
  });

  it("leaves non-rem sizes unchanged", () => {
    expect(kindFontSizeToEditor("18px")).toBe("18px");
    expect(kindFontSizeToEditor("1.2em")).toBe("1.2em");
  });
});
