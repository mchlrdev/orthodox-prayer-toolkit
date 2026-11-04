import { describe, expect, it } from "vitest";
import {
  actionBatch,
  applyImportOps,
  createImportDraft,
  draftChanges,
  quotedText,
  plainScope,
  plainAction,
  readText,
  sectionNumbers,
  speakerNamedIn,
} from "../src/index.js";

describe("Chat pane Decisions", () => {
  it("offers only the actions that fit the view", () => {
    expect(actionBatch("prayer", "x").options.map((o) => o.id)).toEqual(["setKind", "setSpeaker", "removeSpeaker", "answer"]);
    expect(actionBatch("import", "x").options.map((o) => o.id)).toContain("exclude");
    expect(actionBatch("prayer", "x").examples!.every(([, a]) => a !== "exclude")).toBe(true);
  });

  it("finds quoted passages and section numbers", () => {
    expect(quotedText("Gib in allen Gebeten „Ehre sei dem Vater …“ den Speaker Priester.")).toBe("Ehre sei dem Vater");
    expect(quotedText('Set "Amen." to people')).toBe("Amen.");
    expect(quotedText("Abschnitt 4 ist eine Anmerkung")).toBeNull();
    expect(sectionNumbers("Abschnitt 3 und 7 sind Anmerkungen")).toEqual([3, 7]);
    expect(sectionNumbers("sections 2-4, 9")).toEqual([2, 3, 4, 9]);
    expect(sectionNumbers("Was bedeutet das?")).toEqual([]);
    expect(sectionNumbers("Zeile 2 gehört nicht dazu")).toEqual([2]);
    expect(sectionNumbers("line 4 is a heading")).toEqual([4]);
    expect(sectionNumbers("#3 und #7 sind Anmerkungen")).toEqual([3, 7]);
    expect(sectionNumbers("Nr. 5 ist eine Überschrift")).toEqual([5]);
    expect(sectionNumbers("2 und 10 gehören nicht dazu")).toEqual([2, 10]);
    expect(sectionNumbers("Die letzte Zeile gehört nicht dazu", 12)).toEqual([12]);
    expect(sectionNumbers("Der erste Abschnitt ist der Titel")).toEqual([1]);
    expect(sectionNumbers("Troparion im 5. Ton ist eine Überschrift")).toEqual([]);
    expect(sectionNumbers("„Psalm 50“ ist eine Überschrift")).toEqual([]);
    expect(sectionNumbers("zum ersten Mal")).toEqual([]);
  });

  it("lists what an answer changed", () => {
    const d = createImportDraft({
      sources: [readText("Priester: Amen.\n\nDreimal.\n\nSeite drucken", { id: "s1" })],
      variant: { lang: "de", variant: "standard" },
    });
    const r = applyImportOps(d, [
      { op: "removeText", block: "b1", variant: "v1", start: 0, end: 10 },
      { op: "setSpeaker", block: "b1", speaker: "priest" },
      { op: "setKind", target: { block: "b2" }, kind: "annotation" },
      { op: "setExcluded", segments: ["s1-3"], excluded: true },
    ]);
    if (!r.ok) throw new Error(r.error);
    expect(draftChanges(d, r.draft)).toEqual([
      { block: "b1", what: "speaker", from: null, to: "priest" },
      { block: "b1", what: "text", variant: "v1", from: "Priester: Amen.", to: "Amen." },
      { block: "b2", what: "kind", from: "verse", to: "annotation" },
      { block: "b3", what: "excluded" },
    ]);
  });

  it("finds a speaker word in an instruction", () => {
    expect(speakerNamedIn("Abschnitt 5 hat den Speaker Diakon.")).toBe("deacon");
    expect(speakerNamedIn("Gib in allen Gebeten „Amen.“ den Sprecher Volk")).toBe("people");
    expect(speakerNamedIn("Das spricht der Chor")).toBe("choir");
    expect(speakerNamedIn("in all prayers")).toBeUndefined();
  });

  it("sees plain library-wide wording", () => {
    expect(plainScope("Gib in allen Gebeten „Amen.“ den Speaker Volk")).toBe("library");
    expect(plainScope("Set the speaker in every prayer")).toBe("library");
    expect(plainScope("Abschnitt 2 ist eine Überschrift")).toBeUndefined();
  });

  it("sees a plain speaker action", () => {
    expect(plainAction("Gib in allen Gebeten „Auf die Gebete“ den Speaker Priester.")).toBe("setSpeaker");
    expect(plainAction("Entferne den Sprecher in Abschnitt 3")).toBe("removeSpeaker");
    expect(plainAction("Abschnitt 2 ist eine Überschrift")).toBeUndefined();
    expect(plainAction("Gib „Diakon:“ einen Speaker")).toBeUndefined();
  });
});
