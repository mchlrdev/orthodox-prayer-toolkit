import { describe, expect, it } from "vitest";
import {
  applyImportOps,
  createImportDraft,
  decisionPrompts,
  decisionStep,
  firstDraftBatches,
  speakerBatch,
  importDraftToPrayer,
  readText,
  uncertainDecisions,
  type DecisionBatch,
  type ImportDraft,
} from "../src/index.js";

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
  let d = start;
  for (const batch of firstDraftBatches(start)) {
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
  it("asks for every block's role and about each 'Label:' start", () => {
    const batches = firstDraftBatches(draft());
    expect(batches.map((b) => [b.kind, b.items.length])).toEqual([
      ["role", 5],
      ["prefix", 3],
    ]);
    expect(batches[1]!.items.map((i) => i.prefix!.label)).toEqual(["Troparion im 4. Ton", "Dann vierzigmal", "Priester"]);
    const [prompt] = decisionPrompts(batches[0]!);
    expect(prompt!.letters).toEqual(["A", "B", "C", "D", "E"]);
    expect(prompt!.user).toContain("1. Troparion im 4. Ton");
    expect(prompt!.system).toContain("A trailing colon does not make a doxology an instruction");
  });

  it("answers become Import operations: split label, note run, speaker, exclusion", () => {
    const prefixAnswers = ["heading", "note", "speaker"];
    const result = run(draft(), (batch, i) =>
      batch.kind === "role" ? (i === 4 ? "exclude" : "verse") : prefixAnswers[i]!,
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
