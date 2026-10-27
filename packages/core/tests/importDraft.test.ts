import { describe, expect, it } from "vitest";
import {
  applyImportOps,
  assignStyleGroups,
  createImportDraft,
  draftBlockHasTypedText,
  draftBlockPlainText,
  importDraftToPrayer,
  readText,
  validateImportDraft,
  type ImportDraft,
  type ImportOp,
  type Source,
} from "../src/index.js";

const PASTED = `Troparion im 4. Ton

Christus ist auferstanden von den Toten,
hat den Tod durch den Tod zertreten
und denen in den Gräbern das Leben geschenkt.

Priester: Ehre sei dem Vater und dem Sohne
und dem Heiligen Geiste.
`;

function draft(text = PASTED): ImportDraft {
  return createImportDraft({
    sources: [readText(text)],
    variant: { lang: "de", variant: "standard", title: "Ostertroparion", license: "CC0", source: "Test" },
    meta: { id: "ostertroparion" },
  });
}

function run(d: ImportDraft, ...ops: ImportOp[]): ImportDraft {
  const result = applyImportOps(d, ops);
  if (!result.ok) throw new Error(result.error);
  return result.draft;
}

function texts(d: ImportDraft): unknown[] {
  return importDraftToPrayer(d).structure.map((b) => {
    const tr = b.translations[0]!;
    return tr.lines ?? tr.text;
  });
}

describe("readText", () => {
  it("splits paragraphs at blank lines without losing text", () => {
    const text = "  Erste Zeile  \r\nzweite\r\n\r\n\n  Dritte\t\n   ";
    const source = readText(text);
    expect(source.segments.map((s) => s.text)).toEqual([
      "Erste Zeile  \r\nzweite",
      "Dritte",
    ]);
    let rest = text;
    for (const seg of source.segments) {
      expect(text.slice(seg.start, seg.end)).toBe(seg.text);
      rest = rest.replace(seg.text, "");
    }
    expect(rest.trim()).toBe("");
    expect(source.segments.map((s) => s.id)).toEqual(["s1-1", "s1-2"]);
  });

  it("forms style groups only from segments with a look", () => {
    const source: Source = assignStyleGroups({
      id: "h",
      format: "html",
      name: "x.html",
      segments: [
        { id: "a", text: "A", look: { size: 20, weight: 700 } },
        { id: "b", text: "B", look: {} },
        { id: "c", text: "C", look: { weight: 700, size: 20 } },
        { id: "d", text: "D", look: { size: 12 } },
      ],
    });
    expect(source.segments.map((s) => s.group)).toEqual(["h-g1", undefined, "h-g1", "h-g2"]);
  });
});

describe("Import draft", () => {
  it("starts as one valid Verse block per paragraph", () => {
    const d = draft();
    const result = validateImportDraft(d);
    expect(result.ok).toBe(true);
    expect(texts(d)).toEqual([
      ["Troparion im 4. Ton"],
      [
        "Christus ist auferstanden von den Toten,",
        "hat den Tod durch den Tod zertreten",
        "und denen in den Gräbern das Leben geschenkt.",
      ],
      ["Priester: Ehre sei dem Vater und dem Sohne", "und dem Heiligen Geiste."],
    ]);
  });

  it("is invalid until title and id are set", () => {
    const d = createImportDraft({
      sources: [readText("Amen.")],
      variant: { lang: "de", variant: "standard" },
    });
    expect(validateImportDraft(d).ok).toBe(false);
    const filled = run(
      d,
      { op: "setPrayerMeta", patch: { id: "amen", type: "prayer" } },
      { op: "setVariantMeta", variant: "v1", patch: { title: "Amen", license: "CC0", source: "x" } },
    );
    expect(validateImportDraft(filled).ok).toBe(true);
  });

  it("changes kind, reshaping lines into text", () => {
    const d = run(draft(), { op: "setKind", target: { block: "b2" }, kind: "annotation" });
    expect(texts(d)[1]).toBe(
      "Christus ist auferstanden von den Toten, hat den Tod durch den Tod zertreten und denen in den Gräbern das Leben geschenkt.",
    );
    // Back to verse restores the lines from the source.
    const back = run(d, { op: "setKind", target: { block: "b2" }, kind: "verse" });
    expect(texts(back)[1]).toEqual(texts(draft())[1]);
  });

  it("rejects undeclared kinds and accepts declared ones", () => {
    const d = draft();
    const bad = applyImportOps(d, [{ op: "setKind", target: { block: "b1" }, kind: "rubric" }]);
    expect(bad.ok).toBe(false);
    const good = run(
      d,
      { op: "declareKind", kind: { id: "rubric" } },
      { op: "setKind", target: { block: "b1" }, kind: "rubric" },
    );
    const prayer = importDraftToPrayer(good);
    expect(prayer.kinds).toEqual([{ id: "rubric" }]);
    expect(validateImportDraft(good).ok).toBe(true);
  });

  it("splits a block and merges it back to the same text", () => {
    const d = draft();
    const at = "Priester: Ehre sei dem Vater".length;
    const split = run(d, { op: "split", block: "b3", variant: "v1", at });
    expect(texts(split).slice(2)).toEqual([
      ["Priester: Ehre sei dem Vater"],
      ["und dem Sohne", "und dem Heiligen Geiste."],
    ]);
    expect(split.blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3", "b4"]);

    const merged = run(split, { op: "merge", block: "b3" });
    expect(texts(merged)).toEqual(texts(d));
  });

  it("split then merge round-trips at every position, in every kind", () => {
    for (const kind of ["verse", "annotation"]) {
      const d = run(draft(), { op: "setKind", target: { block: "b2" }, kind });
      const plain = draftBlockPlainText(d, d.blocks[1]!, "v1");
      for (let at = 1; at < plain.length; at++) {
        const split = applyImportOps(d, [{ op: "split", block: "b2", variant: "v1", at }]);
        if (!split.ok) continue; // only whitespace on one side
        const merged = run(split.draft, { op: "merge", block: "b2" });
        expect(texts(merged)).toEqual(texts(d));
        expect(draftBlockHasTypedText(merged.blocks[1]!, "v1")).toBe(false);
      }
    }
  });

  it("split parts point at sub-ranges of the segment", () => {
    const split = run(draft(), { op: "split", block: "b1", variant: "v1", at: 9 });
    expect(split.blocks[0]!.content.v1).toEqual([{ seg: "s1-1", start: 0, end: 9 }]);
    expect(split.blocks[1]!.content.v1).toEqual([{ seg: "s1-1", start: 9, end: 19 }]);
    expect(texts(split).slice(0, 2)).toEqual([["Troparion"], ["im 4. Ton"]]);
  });

  it("refuses to split at the edge of the text", () => {
    const result = applyImportOps(draft(), [{ op: "split", block: "b1", variant: "v1", at: 0 }]);
    expect(result).toEqual({ ok: false, error: "Split position must have text on both sides" });
  });

  it("merges two paragraphs into one verse with all lines", () => {
    const merged = run(draft(), { op: "merge", block: "b1" });
    expect(texts(merged)[0]).toEqual([
      "Troparion im 4. Ton",
      "Christus ist auferstanden von den Toten,",
      "hat den Tod durch den Tod zertreten",
      "und denen in den Gräbern das Leben geschenkt.",
    ]);
  });

  it("marks a note run inside a stanza", () => {
    const d = draft("Dann dreimal: Heiliger Gott");
    const marked = run(d, { op: "setNote", block: "b1", variant: "v1", start: 0, end: 13, note: true });
    expect(texts(marked)).toEqual([[[{ t: "note", v: "Dann dreimal:" }, { t: "text", v: " Heiliger Gott" }]]]);
    const unmarked = run(marked, { op: "setNote", block: "b1", variant: "v1", start: 0, end: 13, note: false });
    expect(texts(unmarked)).toEqual([["Dann dreimal: Heiliger Gott"]]);
  });

  it("sets a speaker and strips the prefix in one step", () => {
    const d = run(
      draft(),
      { op: "setSpeaker", block: "b3", speaker: "priest" },
      { op: "removeText", block: "b3", variant: "v1", start: 0, end: "Priester: ".length },
    );
    const block = importDraftToPrayer(d).structure[2]!;
    expect(block.speaker).toBe("priest");
    expect(block.translations[0]!.lines).toEqual([
      "Ehre sei dem Vater und dem Sohne",
      "und dem Heiligen Geiste.",
    ]);
    expect(d.blocks[2]!.origin.speaker).toEqual({ by: "human" });
  });

  it("drops the speaker when the new kind does not take one", () => {
    const d = run(
      draft(),
      { op: "setSpeaker", block: "b3", speaker: "priest" },
      { op: "setKind", target: { block: "b3" }, kind: "heading" },
    );
    expect(d.blocks[2]!.speaker).toBeUndefined();
    const bad = applyImportOps(d, [{ op: "setSpeaker", block: "b3", speaker: "priest" }]);
    expect(bad.ok).toBe(false);
  });

  it("excludes segments without losing them", () => {
    const d = run(draft(), { op: "setExcluded", segments: ["s1-1"], excluded: true });
    expect(importDraftToPrayer(d).structure.map((b) => b.id)).toEqual(["b2", "b3"]);
    const back = run(d, { op: "setExcluded", segments: ["s1-1"], excluded: false });
    expect(texts(back)).toEqual(texts(draft()));
  });

  it("keeps excluded parts of a merged block through a split", () => {
    const d = run(
      draft(),
      { op: "merge", block: "b1" },
      { op: "setExcluded", segments: ["s1-1"], excluded: true },
      { op: "split", block: "b1", variant: "v1", at: "Christus ist auferstanden von den Toten,".length },
      { op: "setExcluded", segments: ["s1-1"], excluded: false },
    );
    expect(texts(d).slice(0, 2)).toEqual([
      ["Troparion im 4. Ton", "Christus ist auferstanden von den Toten,"],
      ["hat den Tod durch den Tod zertreten", "und denen in den Gräbern das Leben geschenkt."],
    ]);
  });

  it("keeps typed text apart from source text", () => {
    const d = run(draft(), {
      op: "setText",
      block: "b1",
      variant: "v1",
      content: ["Troparion im vierten Ton"],
    });
    expect(texts(d)[0]).toEqual(["Troparion im vierten Ton"]);
    expect(draftBlockHasTypedText(d.blocks[0]!, "v1")).toBe(true);
    expect(draftBlockHasTypedText(d.blocks[1]!, "v1")).toBe(false);
    // Untouched characters still point at the segment.
    expect(d.blocks[0]!.content.v1![0]).toEqual({ seg: "s1-1", start: 0, end: 13 });
  });

  it("setText with the same text changes nothing visible", () => {
    const d = draft();
    const same = run(d, { op: "setText", block: "b2", variant: "v1", content: texts(d)[1] as string[] });
    expect(texts(same)).toEqual(texts(d));
    expect(draftBlockHasTypedText(same.blocks[1]!, "v1")).toBe(false);
  });

  it("setText can join two lines and mark a note", () => {
    const d = draft("Herr, erbarme dich.\nDreimal.");
    const joined = run(d, {
      op: "setText",
      block: "b1",
      variant: "v1",
      content: [[{ t: "text", v: "Herr, erbarme dich. " }, { t: "note", v: "Dreimal." }]],
    });
    expect(texts(joined)).toEqual([[[{ t: "text", v: "Herr, erbarme dich. " }, { t: "note", v: "Dreimal." }]]]);
    expect(draftBlockHasTypedText(joined.blocks[0]!, "v1")).toBe(true);
  });

  it("removing text across a line break joins the lines", () => {
    const d = draft("eins\nzwei");
    const plain = draftBlockPlainText(d, d.blocks[0]!, "v1");
    expect(plain).toBe("eins\nzwei");
    const joined = run(d, { op: "removeText", block: "b1", variant: "v1", start: 4, end: 5 });
    expect(texts(joined)).toEqual([["einszwei"]]);
    expect(draftBlockHasTypedText(joined.blocks[0]!, "v1")).toBe(false);
  });

  it("sets kind for a whole style group", () => {
    const source = assignStyleGroups({
      id: "h",
      format: "html",
      name: "x.html",
      segments: [
        { id: "a", text: "Heading", look: { size: 20 } },
        { id: "b", text: "Verse one", look: {} },
        { id: "c", text: "Another", look: { size: 20 } },
      ],
    });
    const d = createImportDraft({
      sources: [source],
      variant: { lang: "en", variant: "std", title: "T", license: "L", source: "S" },
      meta: { id: "t" },
    });
    const grouped = applyImportOps(
      d,
      [{ op: "setKind", target: { group: "h-g1" }, kind: "subheading" }],
      { by: "model", confidence: 0.82 },
    );
    expect(grouped.ok).toBe(true);
    if (!grouped.ok) return;
    expect(grouped.draft.blocks.map((b) => b.kind)).toEqual(["subheading", "verse", "subheading"]);
    expect(grouped.draft.blocks[0]!.origin.kind).toEqual({ by: "model", confidence: 0.82 });
    expect(grouped.draft.blocks[1]!.origin.kind).toEqual({ by: "reader" });
  });

  it("applies a batch atomically", () => {
    const d = draft();
    const result = applyImportOps(d, [
      { op: "setKind", target: { block: "b1" }, kind: "heading" },
      { op: "merge", block: "nope" },
    ]);
    expect(result).toEqual({ ok: false, error: 'No block "nope"' });
    expect(d.blocks[0]!.kind).toBe("verse");
  });

  it("moves blocks", () => {
    const d = run(draft(), { op: "moveBlock", block: "b3", to: 0 });
    expect(d.blocks.map((b) => b.id)).toEqual(["b3", "b1", "b2"]);
  });
});

describe("Import draft with two Variants", () => {
  function twoVariants(): ImportDraft {
    const de = readText("Christus ist auferstanden.\n\nAmen.", { id: "de" });
    const cu = readText("Христосъ воскресе.\n\nАминь.", { id: "cu" });
    const d = createImportDraft({
      sources: [de],
      variant: { lang: "de", variant: "standard", title: "T", license: "L", source: "S" },
      meta: { id: "pair" },
    });
    // Ticket 06 builds this from a parallel source; here we wire it by hand.
    return {
      ...d,
      sources: [de, cu],
      variants: [
        ...d.variants,
        { key: "v2", lang: "cu", variant: "standard", title: "Т", license: "L", source: "S" },
      ],
      blocks: d.blocks.map((b, i) => ({
        ...b,
        content: { ...b.content, v2: [{ seg: cu.segments[i]!.id, start: 0, end: cu.segments[i]!.text.length }] },
      })),
    };
  }

  it("omits a translation instead of writing an empty one", () => {
    const d = run(twoVariants(), { op: "unpairVariant", block: "b2", variant: "v2" });
    const prayer = importDraftToPrayer(d);
    expect(prayer.structure.map((b) => b.translations.map((t) => t.lang))).toEqual([
      ["de", "cu"],
      ["de"],
      ["cu"],
    ]);
    expect(validateImportDraft(d).ok).toBe(true);
  });

  it("pairs a lone translation back", () => {
    const d = run(
      twoVariants(),
      { op: "unpairVariant", block: "b2", variant: "v2" },
      { op: "pairVariant", block: "b2", variant: "v2", from: "b3" },
    );
    expect(importDraftToPrayer(d)).toEqual(importDraftToPrayer(twoVariants()));
  });

  it("splitting one Variant leaves the other in the upper block", () => {
    const d = run(twoVariants(), { op: "split", block: "b1", variant: "v1", at: 9 });
    const prayer = importDraftToPrayer(d);
    expect(prayer.structure[0]!.translations.map((t) => t.lines)).toEqual([
      ["Christus"],
      ["Христосъ воскресе."],
    ]);
    expect(prayer.structure[1]!.translations.map((t) => t.lang)).toEqual(["de"]);
  });

  it("refuses a duplicate Variant", () => {
    const result = applyImportOps(twoVariants(), [
      { op: "setVariantMeta", variant: "v2", patch: { lang: "de" } },
    ]);
    expect(result.ok).toBe(false);
  });
});
