import { describe, expect, it } from "vitest";
import {
  applyImportOps,
  chatImportOps,
  createImportDraft,
  draftBlockContent,
  draftBlockPlainText,
  draftChanges,
  firstDraftBatches,
  inlineNoteRanges,
  readChatPlan,
  readerRuleOps,
  readText,
  ruleChatPlan,
  type ChatTurn,
  type ImportDraft,
} from "../src/index.js";

const TEXT = "Psalm 50\n\nLeser: Erbarme Dich meiner, o Gott.\n\nPriester: Friede allen.\n\nHerr, erbarme Dich (dreimal). Amen.";

function draft(text = TEXT, lang = "de"): ImportDraft {
  return createImportDraft({ sources: [readText(text)], variant: { lang, variant: "standard" } });
}

function apply(d: ImportDraft, ops: Parameters<typeof applyImportOps>[1], by: "model" | "reader" = "model"): ImportDraft {
  const r = applyImportOps(d, ops, { by });
  if (!r.ok) throw new Error(r.error);
  return r.draft;
}
const plain = (d: ImportDraft, i: number) => draftBlockPlainText(d, d.blocks[i]!, "v1");

describe("Chat plan rules", () => {
  it("finds the speaker even in quotes", () => {
    expect(ruleChatPlan("Gib dem Block den Speaker „reader“", "import")).toMatchObject({ action: "setSpeaker", speaker: "reader" });
    expect(ruleChatPlan('Set the speaker "Reader"', "import")).toMatchObject({ action: "setSpeaker", speaker: "reader" });
    expect(ruleChatPlan("Dieser Vers hat den Speaker Priest", "import")).toMatchObject({ action: "setSpeaker", speaker: "priest" });
    expect(ruleChatPlan("„Priester: Friede allen“ hat den Speaker Priester", "import")).toMatchObject({ action: "setSpeaker", speaker: "priest" });
    expect(ruleChatPlan("Speaker Alle", "import")).toMatchObject({ action: "setSpeaker", speaker: "all" });
    expect(ruleChatPlan("Das spricht der Chor", "import")).toMatchObject({ action: "setSpeaker", speaker: "choir" });
  });

  it("tells inline annotations, removals and kinds apart", () => {
    expect(ruleChatPlan("„(dreimal)“ ist eine Anmerkung", "import")).toMatchObject({ action: "note", quote: "(dreimal)" });
    expect(ruleChatPlan("Entferne „Leser:“", "import")).toMatchObject({ action: "removeText", quote: "Leser" });
    expect(ruleChatPlan("Entferne den Sprecher in Abschnitt 3", "import")).toMatchObject({ action: "removeSpeaker" });
    expect(ruleChatPlan("Abschnitt 1 ist eine Überschrift", "import")).toMatchObject({ action: "setKind", kind: "heading" });
    expect(ruleChatPlan("Ersetze „Gott“ durch „Herr“", "import")).toMatchObject({ action: "editText", quote: "Gott", replacement: "Herr" });
    expect(ruleChatPlan("Was ist ein Troparion?", "import")).toMatchObject({ action: "answer" });
  });

  it("follow-ups refer to the previous answer", () => {
    const previous: ChatTurn = { instruction: "Abschnitt 2 hat den Speaker Leser", action: "setSpeaker", blocks: ["b2"], summary: "Speaker Reader" };
    expect(ruleChatPlan("Entferne das Label noch", "import", { previous })).toMatchObject({ action: "removeText", followUp: true });
    expect(ruleChatPlan("Nein, Priester.", "import", { previous })).toMatchObject({ action: "setSpeaker", speaker: "priest", followUp: true });
    expect(ruleChatPlan("Abschnitt 4 ist eine Anmerkung", "import", { previous }).followUp).toBeUndefined();
  });

  it("reads the model's plan and drops unknown values", () => {
    expect(
      readChatPlan(
        { action: "setSpeaker", sections: [2, 2, 0], kind: "none", speaker: "reader", quote: "" },
        { view: "import", kinds: ["verse"], speakers: ["reader"] },
      ),
    ).toEqual({ action: "setSpeaker", sections: [2], speaker: "reader" });
  });
});

describe("Chat plan changes", () => {
  it("a speaker removes the printed label and names the speaker in the language", () => {
    const d = draft();
    const { ops } = chatImportOps(d, { action: "setSpeaker", speaker: "reader" }, ["b2"]);
    const after = apply(d, ops);
    expect(after.blocks[1]!.speaker).toBe("reader");
    expect(plain(after, 1)).toBe("Erbarme Dich meiner, o Gott.");
    expect(after.variants[0]!.speakers).toEqual({ reader: { name: "Leser" } });
  });

  it("a speaker other than the label still removes the label", () => {
    const d = draft();
    const after = apply(d, chatImportOps(d, { action: "setSpeaker", speaker: "deacon" }, ["b3"]).ops);
    expect(after.blocks[2]!.speaker).toBe("deacon");
    expect(plain(after, 2)).toBe("Friede allen.");
    expect(after.variants[0]!.speakers).toEqual({ deacon: { name: "Diakon" } });
  });

  it("says why nothing changed", () => {
    const d = apply(draft(), chatImportOps(draft(), { action: "setSpeaker", speaker: "reader" }, ["b2"]).ops);
    expect(chatImportOps(d, { action: "setSpeaker", speaker: "reader" }, ["b2"])).toEqual({
      ops: [],
      skipped: [{ block: "b2", reason: "already has the speaker Reader" }],
    });
    expect(chatImportOps(d, { action: "note", quote: "(zweimal)" }, ["b4"]).skipped[0]!.reason).toContain("is not in this section");
  });

  it("removes a quoted label and keeps it as the speaker", () => {
    const d = draft();
    const after = apply(d, chatImportOps(d, { action: "removeText", quote: "Leser" }, ["b2"]).ops);
    expect(plain(after, 1)).toBe("Erbarme Dich meiner, o Gott.");
    expect(after.blocks[1]!.speaker).toBe("reader");
  });

  it("marks quoted words inside a verse as an inline annotation", () => {
    const d = draft();
    const after = apply(d, chatImportOps(d, { action: "note", quote: "(dreimal)" }, ["b4"]).ops);
    const content = draftBlockContent(after, after.blocks[3]!, "v1")!;
    expect(JSON.stringify(content)).toContain('{"t":"note","v":"(dreimal)"}');
    expect(draftChanges(d, after)).toEqual([{ block: "b4", what: "note", variant: "v1" }]);
  });

  it("a quote that is the whole section makes it an annotation block", () => {
    const d = draft("Stehend:\n\nAmen.");
    const after = apply(d, chatImportOps(d, { action: "note", quote: "Stehend:" }, ["b1"]).ops);
    expect(after.blocks[0]!.kind).toBe("annotation");
  });
});

describe("Reader rules before the first draft", () => {
  it("known labels become speakers, bracketed instructions inline annotations", () => {
    const d = draft();
    const after = apply(d, readerRuleOps(d), "reader");
    expect(after.blocks.map((b) => b.speaker)).toEqual([undefined, "reader", "priest", undefined]);
    expect(plain(after, 1)).toBe("Erbarme Dich meiner, o Gott.");
    expect(after.variants[0]!.speakers).toEqual({ reader: { name: "Leser" }, priest: { name: "Priester" } });
    expect(JSON.stringify(draftBlockContent(after, after.blocks[3]!, "v1"))).toContain('"t":"note"');
    // The model is not asked about blocks the reader settled.
    const role = firstDraftBatches(after).find((b) => b.kind === "role")!;
    // "Psalm 50" is a genre heading the reader settles too.
    expect(role.items.map((i) => i.block)).toEqual(["b4"]);
  });

  it("only brackets with an instruction, never the whole text", () => {
    expect(inlineNoteRanges("Herr, erbarme Dich (dreimal).")).toEqual([{ start: 19, end: 28 }]);
    expect(inlineNoteRanges("Christus (der Herr) ist erstanden.")).toEqual([]);
    expect(inlineNoteRanges("(dreimal)")).toEqual([]);
  });
});
