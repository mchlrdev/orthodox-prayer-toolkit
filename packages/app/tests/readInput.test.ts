import { describe, expect, it } from "vitest";
import { inputUrl, readImportInput } from "../src/importDraft/readInput";

const noFetch = async () => {
  throw new Error("no fetch expected");
};

describe("Import input", () => {
  it("recognises a lone web address only", () => {
    expect(inputUrl("  https://example.org/gebet  ")?.hostname).toBe("example.org");
    expect(inputUrl("Siehe https://example.org")).toBeNull();
    expect(inputUrl("file:///etc/passwd")).toBeNull();
    expect(inputUrl("Troparion")).toBeNull();
  });

  it("reads plain text with the text Reader", async () => {
    const { source, originHint } = await readImportInput(
      { text: "Eins\n\nZwei", html: null, fileName: null },
      noFetch,
    );
    expect(source.format).toBe("text");
    expect(source.segments.map((s) => s.text)).toEqual(["Eins", "Zwei"]);
    expect(originHint).toBeNull();
  });

  it("fetches a web address and suggests its host as origin", async () => {
    const { source, originHint } = await readImportInput(
      { text: "https://example.org/gebete/oster", html: null, fileName: null },
      async (url) => ({
        url: `${url}?final`,
        contentType: "text/plain; charset=utf-8",
        text: "Christus ist erstanden\n\nWahrhaft",
      }),
    );
    expect(source.name).toBe("example.org/gebete/oster");
    expect(source.segments).toHaveLength(2);
    expect(originHint).toBe("example.org");
  });
});
