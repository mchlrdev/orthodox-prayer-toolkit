import { describe, expect, it } from "vitest";
import {
  addMemoryHint,
  applyImportOps,
  createImportDraft,
  decisionPrompts,
  dismissMemorySuggestion,
  draftChanges,
  draftCorrections,
  emptyMemory,
  firstDraftBatches,
  hintForChanges,
  hintSuggestions,
  learnCorrections,
  lookSummary,
  memoryFileText,
  memoryRuleSteps,
  mergeCorrections,
  removeMemoryEntry,
  sanitizeMemory,
  sourceOrigin,
  withMemory,
  type ImportDraft,
  type ImportOp,
  type LibraryMemory,
  type Source,
} from "../src/index.js";

const NOW = "2026-11-02T10:00:00.000Z";

function page(name = "orthodoxe-gebete.de/ostern"): Source {
  return {
    id: "s1",
    format: "html",
    name,
    segments: [
      { id: "s1-1", text: "Troparion der Auferstehung", look: { bold: true }, group: "g1" },
      { id: "s1-2", text: "Dreimal.", look: { italic: true, color: "#888888" }, group: "g2" },
      { id: "s1-3", text: "Christus ist erstanden von den Toten.", look: {}, group: undefined },
      { id: "s1-4", text: "Quelle: orthodoxe-gebete.de · Seite drucken", look: { size: 9 }, group: "g3" },
    ],
  };
}

function draftOf(source = page()): ImportDraft {
  return createImportDraft({ sources: [source], variant: { lang: "de", variant: "standard" } });
}

function run(draft: ImportDraft, ops: ImportOp[], by: "model" | "human" | "memory" = "human"): ImportDraft {
  const result = applyImportOps(draft, ops, by === "model" ? { by, confidence: 0.6 } : { by });
  if (!result.ok) throw new Error(result.error);
  return result.draft;
}

/** The model's first draft as it went wrong: "Dreimal." a subheading, the footer kept. */
function modelDraft(source?: Source): ImportDraft {
  return run(
    draftOf(source),
    [
      { op: "setKind", target: { block: "b1" }, kind: "heading" },
      { op: "setKind", target: { block: "b2" }, kind: "subheading" },
      { op: "setKind", target: { block: "b4" }, kind: "verse" },
    ],
    "model",
  );
}

describe("Library memory", () => {
  it("says what stands out in a look", () => {
    expect(lookSummary({ tag: "p", weight: "normal", style: "italic", size: "16px", color: "rgb(136, 136, 136)", align: "start" })).toBe("grey, italic");
    expect(lookSummary({ tag: "h2", weight: "bold", color: "#8B2942" })).toBe("red, bold, heading 2");
    expect(lookSummary({ size: 8, color: "#000000" })).toBe("small");
  });

  it("names where a Source comes from", () => {
    expect(sourceOrigin({ name: "www.orthodoxe-gebete.de/ostern" })).toBe("orthodoxe-gebete.de");
    expect(sourceOrigin({ name: "Gebetbuch.pdf" })).toBe("Gebetbuch.pdf");
    expect(sourceOrigin({ name: "Pasted text" }, "orthodoxe-gebete.de")).toBe("orthodoxe-gebete.de");
    expect(sourceOrigin({ name: "Pasted text" }, "Test")).toBe("");
  });

  it("sees the user's corrections of model decisions, not of the Reader's", () => {
    const before = modelDraft();
    const after = run(before, [
      { op: "setKind", target: { block: "b2" }, kind: "annotation" },
      { op: "setExcluded", segments: ["s1-4"], excluded: true },
      { op: "setKind", target: { block: "b3" }, kind: "heading" }, // Reader's verse: no correction
    ]);
    expect(draftCorrections(before, after)).toEqual([
      {
        block: "b2",
        text: "Dreimal.",
        look: { italic: true, color: "#888888" },
        origin: "orthodoxe-gebete.de",
        wrong: "subheading",
        right: "annotation",
      },
      expect.objectContaining({ block: "b4", wrong: "verse", right: "exclude" }),
    ]);
  });

  it("including what the model left out is a correction", () => {
    const before = run(draftOf(), [{ op: "setExcluded", segments: ["s1-3"], excluded: true }], "model");
    expect(before.excludedBy).toEqual({ "s1-3": "model" });
    const after = run(before, [{ op: "setExcluded", segments: ["s1-3"], excluded: false }]);
    expect(after.excludedBy).toBeUndefined();
    expect(draftCorrections(before, after)).toEqual([
      expect.objectContaining({ block: "b3", wrong: "exclude", right: "verse" }),
    ]);
  });

  it("keeps the model's first answer and drops corrections undone before saving", () => {
    const a = { block: "b2", text: "Dreimal.", look: {}, origin: "x.de", wrong: "subheading", right: "verse" };
    const merged = mergeCorrections([a], [{ ...a, wrong: "verse", right: "annotation" }]);
    expect(merged).toEqual([{ ...a, right: "annotation" }]);
    expect(mergeCorrections(merged, [{ ...a, wrong: "annotation", right: "subheading" }])).toEqual([]);

    const draft = modelDraft();
    const corrected = run(draft, [{ op: "setKind", target: { block: "b2" }, kind: "annotation" }]);
    const pending = draftCorrections(draft, corrected);
    // Undo before saving: the correction no longer holds.
    expect(learnCorrections(emptyMemory(), draft, pending, NOW).examples).toEqual([]);
  });

  it("a correction becomes a fixed rule for the next import of the same site", () => {
    const first = modelDraft();
    const corrected = run(first, [
      { op: "setKind", target: { block: "b2" }, kind: "annotation" },
      { op: "setExcluded", segments: ["s1-4"], excluded: true },
    ]);
    const memory = learnCorrections(emptyMemory(), corrected, draftCorrections(first, corrected), NOW);
    expect(memory.examples.map((e) => [e.id, e.text, e.right])).toEqual([
      ["e1", "Dreimal.", "annotation"],
      ["e2", "Quelle: orthodoxe-gebete.de · Seite drucken", "exclude"],
    ]);

    const again = draftOf(page("orthodoxe-gebete.de/weihnachten"));
    const steps = memoryRuleSteps(again, memory);
    expect(steps.map((s) => [s.block, s.ops])).toEqual([
      ["b2", [{ op: "setKind", target: { block: "b2" }, kind: "annotation" }]],
      ["b4", [{ op: "setExcluded", segments: ["s1-4"], excluded: true }]],
    ]);
    const applied = steps.reduce((d, s) => run(d, s.ops, "memory"), again);
    expect(applied.blocks[1]).toMatchObject({ kind: "annotation", origin: { kind: { by: "memory" } } });
    expect(applied.excludedBy).toEqual({ "s1-4": "memory" });

    // Another site with the same look: no fixed rule.
    expect(memoryRuleSteps(draftOf(page("other-site.org/x")), memory)).toEqual([]);
    // The user's own decision stays.
    const mine = run(again, [{ op: "setKind", target: { block: "b2" }, kind: "verse" }]);
    expect(memoryRuleSteps(mine, memory).map((s) => s.block)).toEqual(["b4"]);
  });

  it("a newer correction with the same origin and look replaces the older one", () => {
    let memory = emptyMemory();
    for (const kind of ["annotation", "verse"]) {
      const first = modelDraft();
      const corrected = run(first, [{ op: "setKind", target: { block: "b2" }, kind }]);
      memory = learnCorrections(memory, corrected, draftCorrections(first, corrected), NOW);
    }
    expect(memory.examples.map((e) => [e.id, e.right])).toEqual([["e2", "verse"]]);
  });

  it("adds hints and similar examples to the Decisions", () => {
    let memory: LibraryMemory = addMemoryHint(emptyMemory(), { text: "Doxologien immer als Verse.", from: "user" }, NOW);
    const first = modelDraft();
    const corrected = run(first, [{ op: "setKind", target: { block: "b2" }, kind: "annotation" }]);
    memory = learnCorrections(memory, corrected, draftCorrections(first, corrected), NOW);

    const role = firstDraftBatches(draftOf())[0]!;
    const batch = withMemory(role, memory, "orthodoxe-gebete.de");
    expect(batch.examples!.at(-1)).toEqual(["(italic, color #888888) Dreimal.", "annotation"]);
    const prompt = decisionPrompts(batch)[0]!;
    expect(prompt.system).toContain("- Doxologien immer als Verse.");
    expect(prompt.user).toContain("(italic, color #888888) Dreimal. = C");
    expect(withMemory(role, emptyMemory(), "")).toBe(role);
  });

  it("suggests a hint after repeated corrections; dismissed or accepted it stays away", () => {
    let memory = emptyMemory();
    for (const [i, text] of ["Dreimal.", "Zwölfmal.", "Stehend."].entries()) {
      const source = page(`site${i}.de/x`);
      source.segments[1] = { ...source.segments[1]!, text };
      const first = modelDraft(source);
      const corrected = run(first, [{ op: "setKind", target: { block: "b2" }, kind: "annotation" }]);
      memory = learnCorrections(memory, corrected, draftCorrections(first, corrected), NOW);
      if (i === 1) expect(hintSuggestions(memory)).toEqual([]);
    }
    const [suggestion] = hintSuggestions(memory);
    expect(suggestion).toEqual({
      key: "role:subheading>annotation",
      text: "Lines like ‘Stehend.’ and ‘Zwölfmal.’ are Annotation, not Subheading.",
      count: 3,
    });
    expect(hintSuggestions(dismissMemorySuggestion(memory, suggestion!.key))).toEqual([]);
    const accepted = addMemoryHint(memory, { text: suggestion!.text, from: "suggestion", key: suggestion!.key }, NOW);
    expect(hintSuggestions(accepted)).toEqual([]);
    expect(accepted.hints[0]).toMatchObject({ id: "h1", from: "suggestion" });
    expect(removeMemoryEntry(accepted, "h1").hints).toEqual([]);
  });

  it("suggests a hint from a Chat pane answer", () => {
    const draft = createImportDraft({
      sources: [{ id: "s1", format: "text", name: "Pasted text", segments: [
        { id: "s1-1", text: "Priester: Gesegnet ist unser Gott.", look: {} },
      ] }],
      variant: { lang: "de", variant: "standard" },
    });
    const after = run(draft, [
      { op: "removeText", block: "b1", variant: "v1", start: 0, end: 10 },
      { op: "setSpeaker", block: "b1", speaker: "priest" },
    ], "model");
    expect(hintForChanges(draft, draftChanges(draft, after))).toEqual({
      key: "chat:prefix:priest",
      text: "A prefix like ‘Priester:’ names the speaker (Priest).",
      count: 1,
    });
  });

  it("reads the file without destroying it on errors", () => {
    let memory = addMemoryHint(emptyMemory(), { text: "Doxologien immer als Verse.", from: "user" }, NOW);
    const first = modelDraft();
    const corrected = run(first, [{ op: "setKind", target: { block: "b2" }, kind: "annotation" }]);
    memory = learnCorrections(memory, corrected, draftCorrections(first, corrected), NOW);
    const text = memoryFileText(memory);
    expect(sanitizeMemory(JSON.parse(text))).toEqual({ memory, errors: [] });

    const broken = JSON.parse(text);
    broken.examples.push({ id: "e9", text: "x" });
    const read = sanitizeMemory(broken);
    expect(read.memory.examples).toHaveLength(1);
    expect(read.errors).toEqual([{ path: "/examples/1", message: "invalid example" }]);

    expect(sanitizeMemory({ formatVersion: 2, hints: [] }).errors[0]!.message).toMatch(/newer app/);
    expect(sanitizeMemory([]).errors).toHaveLength(1);
  });
});
