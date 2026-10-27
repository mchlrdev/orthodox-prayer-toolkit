import { describe, expect, it } from "vitest";
import {
  applyImportOps,
  createImportDraft,
  importDraftToPrayer,
  readText,
  type ImportDraft,
  type ImportOp,
} from "@orthodox-prayer-toolkit/core";
import {
  commitOps,
  joinOps,
  moveOps,
  splitOps,
} from "../src/importDraft/editorOps";

const DE = { lang: "de", variant: "standard" };

const TEXT = `Troparion im 4. Ton: Christus ist auferstanden

Ehre sei dem Vater

Quelle: Beispielseite`;

function draft(): ImportDraft {
  return createImportDraft({ sources: [readText(TEXT)], variant: DE });
}

function run(d: ImportDraft, ops: ImportOp[]): ImportDraft {
  const result = applyImportOps(d, ops);
  if (!result.ok) throw new Error(result.error);
  return result.draft;
}

function lines(d: ImportDraft): unknown[] {
  return importDraftToPrayer(d).structure.map((b) => b.translations[0]!.lines);
}

describe("Import preview edits → Import operations", () => {
  it("Enter splits at the caret and Backspace joins back", () => {
    const d0 = draft();
    const content = ["Troparion im 4. Ton: Christus ist auferstanden"];
    const split = splitOps(d0, "b1", DE, { content, start: 20, end: 20 });
    expect(split).not.toBeNull();
    const d1 = run(d0, split!.ops);
    expect(lines(d1).slice(0, 2)).toEqual([
      ["Troparion im 4. Ton:"],
      ["Christus ist auferstanden"],
    ]);

    const join = joinOps(d1, split!.newBlockId, DE, "backward", ["Christus ist auferstanden"]);
    expect(join?.kind).toBe("merged");
    const d2 = run(d1, join!.ops);
    // Like the editor, Backspace keeps the lower block (its id and kind).
    expect(lines(d2)).toEqual(lines(d0));
    expect(d2.blocks[0]!.id).toBe(split!.newBlockId);
    if (join?.kind === "merged") expect(join.caret).toBe(21);
  });

  it("Enter with a selection drops the selected text", () => {
    const content = ["Troparion im 4. Ton: Christus ist auferstanden"];
    const split = splitOps(draft(), "b1", DE, { content, start: 19, end: 21 });
    expect(lines(run(draft(), split!.ops)).slice(0, 2)).toEqual([
      ["Troparion im 4. Ton"],
      ["Christus ist auferstanden"],
    ]);
  });

  it("Enter at the very end is refused (no empty block)", () => {
    const content = ["Ehre sei dem Vater"];
    expect(
      splitOps(draft(), "b2", DE, { content, start: Infinity, end: Infinity }),
    ).toBeNull();
  });

  it("joins over a block deleted from the preview", () => {
    const d1 = run(draft(), [{ op: "deleteBlock", block: "b2" }]);
    const join = joinOps(d1, "b3", DE, "backward", ["Quelle: Beispielseite"]);
    expect(lines(run(d1, join!.ops))).toEqual([
      ["Troparion im 4. Ton: Christus ist auferstanden", "Quelle: Beispielseite"],
    ]);
  });

  it("emptying a cell removes the block", () => {
    const join = joinOps(draft(), "b2", DE, "backward", []);
    expect(join?.kind).toBe("removed");
    expect(lines(run(draft(), join!.ops))).toHaveLength(2);
  });

  it("typing keeps untouched characters tied to the source", () => {
    const d = run(draft(), commitOps(draft(), "b2", DE, ["Ehre sei dem Vater!"]));
    const spans = d.blocks[1]!.content.v1!;
    expect(spans[0]).toMatchObject({ seg: "s1-2", start: 0, end: 18 });
    expect(spans[1]).toMatchObject({ text: "!" });
  });

  it("moves among visible blocks only", () => {
    const d1 = run(draft(), [{ op: "deleteBlock", block: "b2" }]);
    const d2 = run(d1, moveOps(d1, "b3", -1));
    expect(lines(d2)[0]).toEqual(["Quelle: Beispielseite"]);
    expect(moveOps(d2, "b3", -1)).toEqual([]);
  });
});
