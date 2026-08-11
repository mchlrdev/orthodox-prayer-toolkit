import { describe, expect, it } from "vitest";
import { resolveExportPrefixStem } from "../src/session/layoutPrefix";

describe("resolveExportPrefixStem", () => {
  it("uses prefs stem when present, including empty for bare names", () => {
    expect(
      resolveExportPrefixStem({
        prefsStem: "lit",
        hasPrefsStem: true,
        libraryManifest: { stylePrefixStem: "lib" },
      }),
    ).toBe("lit");
    expect(
      resolveExportPrefixStem({
        prefsStem: "",
        hasPrefsStem: true,
        libraryManifest: { stylePrefixStem: "lib" },
      }),
    ).toBe("");
  });

  it("falls through library → opt when no prefs stem", () => {
    expect(
      resolveExportPrefixStem({
        prefsStem: undefined,
        hasPrefsStem: false,
        libraryManifest: { stylePrefixStem: "lib" },
      }),
    ).toBe("lib");
    expect(
      resolveExportPrefixStem({
        prefsStem: undefined,
        hasPrefsStem: false,
        libraryManifest: {},
      }),
    ).toBe("opt");
    expect(
      resolveExportPrefixStem({
        prefsStem: undefined,
        hasPrefsStem: false,
        libraryManifest: { stylePrefixStem: "" },
      }),
    ).toBe("opt");
  });
});
