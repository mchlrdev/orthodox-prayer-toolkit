import { describe, expect, it } from "vitest";
import {
  applyImportOps,
  createImportDraft,
  decisionPrompts,
  decisionStep,
  draftBlockPlainText,
  draftBlockVisible,
  firstDraftBatches,
  pageBreakJoinOps,
  speakerBatch,
  importDraftToPrayer,
  readText,
  readerRuleOps,
  uncertainDecisions,
  type DecisionBatch,
  type ImportDraft,
} from "../src/index.js";
import { lineSplitOffsets } from "../src/importDecisions.js";

const TEXT = [
  "Troparion im 4. Ton: Dein Märtyrer Prokopius, Herr, hat in seinem Kampf die Krone empfangen.",
  "Dann vierzigmal: Herr, erbarme Dich!",
  "Priester: Gesegnet ist unser Gott.",
  "Ehre sei dem Vater und dem Sohne und dem Heiligen Geiste: jetzt und immerdar.",
  "Seite drucken",
].join("\n\n");

function draft(): ImportDraft {
  return createImportDraft({
    sources: [readText(TEXT, { id: "s1" })],
    variant: { lang: "de", variant: "standard", title: "Test", license: "CC0", source: "x" },
  });
}

/** Run every batch with fixed answers: `pick(batch, item index)` → option id. */
function run(start: ImportDraft, pick: (batch: DecisionBatch, i: number) => string, p = 0.9): ImportDraft {
  // The reader's fixed rules first, like the app ("Priester:" needs no model).
  const read = applyImportOps(start, readerRuleOps(start), { by: "reader" });
  if (!read.ok) throw new Error(read.error);
  let d = read.draft;
  for (const batch of firstDraftBatches(d)) {
    batch.items.forEach((item, i) => {
      const chosen = batch.options.findIndex((o) => o.id === pick(batch, i));
      const answer = batch.options.map((_, k) => (k === chosen ? p : (1 - p) / (batch.options.length - 1)));
      const step = decisionStep(d, batch, item, answer);
      if (!step) return;
      const result = applyImportOps(d, step.ops, step.origin);
      if (!result.ok) throw new Error(result.error);
      d = result.draft;
    });
  }
  return d;
}

describe("first-draft Decisions", () => {
  it("asks for every block's role and about each 'Label:' start, except known speaker labels", () => {
    const batches = firstDraftBatches(draft());
    expect(batches.map((b) => [b.kind, b.items.length])).toEqual([
      ["role", 4],
      ["prefix", 2],
    ]);
    // "Priester:" is the reader's (readerRuleOps), not the model's.
    expect(batches[1]!.items.map((i) => i.prefix!.label)).toEqual(["Troparion im 4. Ton", "Dann vierzigmal"]);
    const [prompt] = decisionPrompts(batches[0]!);
    expect(prompt!.letters).toEqual(["A", "B", "C", "D", "E"]);
    expect(prompt!.user).toContain("1. Troparion im 4. Ton");
    expect(prompt!.system).toContain("A trailing colon does not make a doxology an instruction");
  });

  it("answers become Import operations: split label, note run, speaker, exclusion", () => {
    const prefixAnswers = ["heading", "note"];
    const result = run(draft(), (batch, i) =>
      batch.kind === "role" ? (i === 3 ? "exclude" : "verse") : prefixAnswers[i]!,
    );
    const prayer = importDraftToPrayer(result);
    expect(prayer.variants[0]!.speakers).toEqual({ priest: { name: "Priester" } });
    expect(prayer.structure.map((b) => [b.kind, b.speaker ?? null, b.translations[0]])).toEqual([
      ["heading", null, { lang: "de", variant: "standard", text: "Troparion im 4. Ton" }],
      [
        "verse",
        null,
        { lang: "de", variant: "standard", lines: ["Dein Märtyrer Prokopius, Herr, hat in seinem Kampf die Krone empfangen."] },
      ],
      [
        "verse",
        null,
        {
          lang: "de",
          variant: "standard",
          lines: [[{ t: "note", v: "Dann vierzigmal:" }, { t: "text", v: " Herr, erbarme Dich!" }]],
        },
      ],
      ["verse", "priest", { lang: "de", variant: "standard", lines: ["Gesegnet ist unser Gott."] }],
      [
        "verse",
        null,
        {
          lang: "de",
          variant: "standard",
          lines: ["Ehre sei dem Vater und dem Sohne und dem Heiligen Geiste: jetzt und immerdar."],
        },
      ],
    ]);
  });

  it("an unknown speaker label gets a follow-up question", () => {
    const d = createImportDraft({
      sources: [readText("Kanonarch: Lasset uns singen.\n\nPriester: Amen.", { id: "s1" })],
      variant: { lang: "de", variant: "standard" },
    });
    const prefix = firstDraftBatches(d).find((b) => b.kind === "prefix")!;
    expect(decisionStep(d, prefix, prefix.items[0]!, [0, 0, 1, 0])).toBeNull();
    const follow = speakerBatch(prefix, prefix.items)!;
    expect(follow.items.map((i) => i.prefix!.label)).toEqual(["Kanonarch"]);
    const other = follow.options.findIndex((o) => o.id === "other");
    const step = decisionStep(d, follow, follow.items[0]!, follow.options.map((_, k) => (k === other ? 1 : 0)));
    expect(step?.ops).toContainEqual({ op: "setSpeaker", block: "b1", speaker: "kanonarch" });
  });

  it("records confidence; low ones are uncertain", () => {
    const result = run(draft(), (batch) => (batch.kind === "role" ? "annotation" : "text"), 0.55);
    const b1 = result.blocks[0]!;
    expect(b1.origin.kind).toEqual({ by: "model", confidence: 0.55 });
    expect(uncertainDecisions(b1)).toEqual([{ what: "kind", confidence: 0.55 }]);
  });

  it("the user's own decisions win over the model's", () => {
    const d = draft();
    const [role] = firstDraftBatches(d);
    const edited = applyImportOps(d, [{ op: "setKind", target: { block: "b1" }, kind: "heading" }]);
    if (!edited.ok) throw new Error(edited.error);
    const step = decisionStep(edited.draft, role!, role!.items[0]!, [0, 0, 0, 1, 0]);
    expect(step).toBeNull();
  });

  it("pairs by order are checked; a 'different' answer unpairs", () => {
    let d = draft();
    const added = applyImportOps(d, [
      { op: "addVariant", variant: { lang: "cu", variant: "standard" } },
      { op: "addSource", source: readText("Тропарь\n\nГосподи помилуй", { id: "s2" }), variant: "v2" },
      { op: "pairByOrder", variant: "v2" },
    ]);
    if (!added.ok) throw new Error(added.error);
    d = added.draft;
    const pair = firstDraftBatches(d).find((b) => b.kind === "pair")!;
    expect(pair.items.map((i) => i.block)).toEqual(["b1", "b2"]);
    const step = decisionStep(d, pair, pair.items[1]!, [0.2, 0.8]);
    expect(step?.ops).toEqual([{ op: "unpairVariant", block: "b2", variant: "v2" }]);
    expect(decisionStep(d, pair, pair.items[0]!, [0.9, 0.1])).toBeNull();
  });
});

describe("cutting and joining paragraphs by rule", () => {
  const start = (text: string) => {
    const source = readText(text, { id: "s" });
    return createImportDraft({ sources: [source], variant: { lang: "de", variant: "standard", title: "T" } });
  };
  const texts = (d: ImportDraft) => d.blocks.filter((b) => draftBlockVisible(d, b)).map((b) => draftBlockPlainText(d, b, d.variants[0]!.key));

  it("the reader cuts a genre label off its text", () => {
    expect(lineSplitOffsets("Troparion, 4. Ton\nDein Märtyrer, o Herr")).toEqual([18]);
    expect(lineSplitOffsets("Herr, erbarme Dich\nPsalm 50\nErbarme Dich meiner")).toEqual([19, 28]);
    expect(lineSplitOffsets("Heiliger Gott\nHeiliger Starker")).toEqual([]);
    const d = start("Troparion, 4. Ton\nDein Märtyrer, o Herr");
    const read = applyImportOps(d, readerRuleOps(d), { by: "reader" });
    if (!read.ok) throw new Error(read.error);
    expect(texts(read.draft)).toEqual(["Troparion, 4. Ton", "Dein Märtyrer, o Herr"]);
    expect(read.draft.blocks[0]!.kind).toBe("heading");
  });

  describe("page breaks", () => {
    const segment = (id: string, text: string, page: number, extra: object = {}) => ({
      id,
      text,
      look: {},
      group: "g1",
      area: { page, x: 0, y: 0, width: 10, height: 10, column: 0 },
      ...extra,
    });
    const pdf = (...segments: ReturnType<typeof segment>[]) =>
      createImportDraft({
        sources: [{ id: "s", format: "pdf", segments } as never],
        variant: { lang: "de", variant: "standard", title: "T" },
      });

    it("joins a paragraph cut by a page break, chains too", () => {
      const d = pdf(segment("a", "und denen in den", 1), segment("b", "Gräbern das Leben und", 2), segment("c", "denen ein Ende.", 3), segment("d", "Amen", 3));
      expect(pageBreakJoinOps(d).length).toBe(1);
      const c = pdf(segment("a", "und denen in den", 1), segment("b", "gräbern das Leben und", 2), segment("c", "denen ein Ende.", 3));
      const ops = pageBreakJoinOps(c);
      expect(ops.length).toBe(2);
      const r = applyImportOps(c, ops, { by: "reader" });
      if (!r.ok) throw new Error(r.error);
      expect(r.draft.blocks.length).toBe(1);
    });

    it("leaves other neighbours alone", () => {
      const same = pdf(segment("a", "und denen", 1), segment("b", "das Leben", 1));
      expect(pageBreakJoinOps(same)).toEqual([]);
      const finished = pdf(segment("a", "und denen.", 1), segment("b", "das Leben", 2));
      expect(pageBreakJoinOps(finished)).toEqual([]);
      const capital = pdf(segment("a", "und denen", 1), segment("b", "Das Leben", 2));
      expect(pageBreakJoinOps(capital)).toEqual([]);
      const column = pdf(segment("a", "und denen", 1), segment("b", "das Leben", 2, { area: { page: 2, x: 0, y: 0, width: 10, height: 10, column: 1 } }));
      expect(pageBreakJoinOps(column)).toEqual([]);
      const print = pdf(segment("a", "und denen", 1), segment("b", "das Leben", 2, { group: "g2" }));
      expect(pageBreakJoinOps(print)).toEqual([]);
    });
  });
});
