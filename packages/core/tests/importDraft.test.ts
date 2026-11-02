import { describe, expect, it } from "vitest";
import {
  applyImportOps,
  assignStyleGroups,
  createImportDraft,
  draftBlockHasTypedText,
  draftBlockPlainText,
  draftUncertainWords,
  draftBlocksInGroup,
  draftBlockVisible,
  draftBlocksInColumn,
  freePrayerId,
  freeSourceId,
  prayerIdFromTitle,
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

describe("Import draft: blocks the editor cannot see", () => {
  it("merges over a hidden block and keeps it after the merged one", () => {
    const d = run(
      draft(),
      { op: "setExcluded", segments: ["s1-2"], excluded: true },
      { op: "merge", block: "b1" },
    );
    expect(d.blocks.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(draftBlockVisible(d, d.blocks[1]!)).toBe(false);
    expect(texts(d)).toEqual([
      ["Troparion im 4. Ton", "Priester: Ehre sei dem Vater und dem Sohne", "und dem Heiligen Geiste."],
    ]);
  });

  it("deleteBlock excludes the block's own segments, restorable", () => {
    const d = run(draft(), { op: "deleteBlock", block: "b1" });
    expect(d.excluded).toEqual(["s1-1"]);
    expect(texts(d)).toHaveLength(2);
    const back = run(d, { op: "setExcluded", segments: ["s1-1"], excluded: false });
    expect(importDraftToPrayer(back)).toEqual(importDraftToPrayer(draft()));
  });

  it("deleteBlock of one split half keeps the other half", () => {
    const d = run(
      draft(),
      { op: "split", block: "b2", variant: "v1", at: 9 },
      { op: "deleteBlock", block: "b4" },
    );
    expect(d.excluded).toEqual([]);
    expect(d.blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(texts(d)[1]).toEqual(["Christus"]);
  });
});

describe("prayer ids", () => {
  it("suggests an id from a title", () => {
    expect(prayerIdFromTitle("Ostertroparion")).toBe("ostertroparion");
    expect(prayerIdFromTitle("  Großes Gebet – Ton 5! ")).toBe("grosses-gebet-ton-5");
    expect(prayerIdFromTitle("Христос воскресе")).toBe("");
  });

  it("finds a free id without touching the original", () => {
    expect(freePrayerId("a", [])).toBe("a");
    expect(freePrayerId("a", ["a", "a-2"])).toBe("a-3");
    expect(freePrayerId("psalm-50", ["psalm-50"])).toBe("psalm-50-2");
  });
});

describe("style groups in the draft", () => {
  it("lists the visible blocks of a group", () => {
    const source: Source = assignStyleGroups({
      id: "s1",
      format: "html",
      name: "page",
      segments: [
        { id: "a", text: "Titel", look: { tag: "h2" } },
        { id: "b", text: "Vers", look: { tag: "p" } },
        { id: "c", text: "Zweiter Titel", look: { tag: "h2" } },
      ],
    });
    const d = createImportDraft({ sources: [source], variant: { lang: "de", variant: "standard" } });
    expect(draftBlocksInGroup(d, "s1-g1").map((b) => b.id)).toEqual(["b1", "b3"]);
    const hidden = run(d, { op: "setExcluded", segments: ["c"], excluded: true });
    expect(draftBlocksInGroup(hidden, "s1-g1").map((b) => b.id)).toEqual(["b1"]);
  });
});

describe("Reader hints in the first draft", () => {
  const source: Source = {
    id: "p",
    format: "pdf",
    name: "buch.pdf",
    segments: [
      { id: "p-1", text: "PASCHA 12", look: {}, furniture: true },
      {
        id: "p-2",
        text: "und denen in den Grä-bern das Le-ben geschenkt.",
        look: {},
        drop: [
          { start: 20, end: 21 },
          { start: 32, end: 33 },
        ],
      },
    ],
  };
  const d = createImportDraft({ sources: [source], variant: { lang: "de", variant: "standard" } });

  it("leaves out dropped hyphens but keeps them in the source", () => {
    expect(texts(d)).toEqual([["und denen in den Gräbern das Leben geschenkt."]]);
    expect(source.segments[1]!.text).toContain("Grä-bern");
  });

  it("excludes running heads, restorable", () => {
    expect(d.excluded).toEqual(["p-1"]);
    const shown = run(d, { op: "setExcluded", segments: ["p-1"], excluded: false });
    expect(texts(shown)[0]).toEqual(["PASCHA 12"]);
  });

  it("splitting and merging across a dropped hyphen round-trips", () => {
    const split = run(d, { op: "split", block: "b2", variant: "v1", at: 22 });
    expect(texts(split)).toEqual([["und denen in den Gräbe"], ["rn das Leben geschenkt."]]);
    expect(texts(run(split, { op: "merge", block: "b2" }))).toEqual(texts(d));
  });
});

describe("words read with low confidence (scans)", () => {
  const source: Source = {
    id: "i",
    format: "image",
    name: "scan.jpg",
    segments: [
      { id: "i-1", text: "Ehre sei dem Sohne", look: {}, uncertain: [{ start: 13, end: 18, confidence: 0.41 }] },
      { id: "i-2", text: "jetzt und imrnerdar", look: {}, uncertain: [{ start: 10, end: 19 }] },
    ],
  };
  const d = createImportDraft({ sources: [source], variant: { lang: "de", variant: "standard" } });

  it("are found in the block's plain text, also after a merge", () => {
    expect(draftUncertainWords(d, d.blocks[0]!, "v1")).toEqual([
      { start: 13, end: 18, segment: "i-1", confidence: 0.41 },
    ]);
    const merged = run(d, { op: "merge", block: "b1" });
    const block = merged.blocks[0]!;
    const plain = draftBlockPlainText(merged, block, "v1");
    expect(draftUncertainWords(merged, block, "v1").map((w) => plain.slice(w.start, w.end))).toEqual([
      "Sohne",
      "imrnerdar",
    ]);
  });

  it("typed over, a word is no longer uncertain", () => {
    const fixed = run(d, { op: "setText", block: "b2", variant: "v1", content: ["jetzt und immerdar"] });
    expect(draftUncertainWords(fixed, fixed.blocks[1]!, "v1")).toEqual([]);
  });
});

describe("multilingual import", () => {
  const DE = "Christus ist auferstanden.\n\nWahrhaft auferstanden.\n\nAmen.";
  const CU = "Христосъ воскресе.\n\nВоистину воскресе.\n\nАминь.";

  it("adds a second Source in another language and pairs it by order", () => {
    const d0 = draft(DE);
    const id = freeSourceId(d0);
    expect(id).toBe("s2");
    const d = run(
      d0,
      {
        op: "addVariant",
        variant: { lang: "cu", variant: "standard", title: "Тропарь", license: "CC0", source: "Test" },
      },
      { op: "addSource", source: readText(CU, { id }), variant: "v2" },
      { op: "pairByOrder", variant: "v2" },
    );
    expect(d.variants.map((v) => [v.key, v.lang, v.title])).toEqual([
      ["v1", "de", "Ostertroparion"],
      ["v2", "cu", "Тропарь"],
    ]);
    const prayer = importDraftToPrayer(d);
    expect(prayer.structure.map((b) => b.translations.map((t) => t.lines![0]))).toEqual([
      ["Christus ist auferstanden.", "Христосъ воскресе."],
      ["Wahrhaft auferstanden.", "Воистину воскресе."],
      ["Amen.", "Аминь."],
    ]);
    expect(prayer.variants.map((v) => v.lang)).toEqual(["de", "cu"]);
    expect(validateImportDraft(d).ok).toBe(true);
  });

  it("leaves extra blocks alone and omits the missing translation", () => {
    const d = run(
      draft(DE),
      { op: "addVariant", variant: { lang: "cu", variant: "standard" } },
      { op: "addSource", source: readText("Христосъ воскресе.", { id: "s2" }), variant: "v2" },
      { op: "pairByOrder", variant: "v2" },
    );
    const prayer = importDraftToPrayer(d);
    expect(prayer.structure.map((b) => b.translations.map((t) => t.lang))).toEqual([
      ["de", "cu"],
      ["de"],
      ["de"],
    ]);
    expect(JSON.stringify(prayer)).not.toContain('"lines":[]');
  });

  it("splits a two-column Source into two Variants", () => {
    const seg = (id: string, text: string, column: number) => ({
      id,
      text,
      look: { column },
    });
    const source: Source = {
      id: "s1",
      format: "docx",
      name: "parallel.docx",
      segments: [
        seg("s1-1", "Herr, erbarme dich.", 1),
        seg("s1-2", "Господи, помилуй.", 2),
        seg("s1-3", "Gewähre, o Herr.", 1),
        seg("s1-4", "Подай, Господи.", 2),
      ],
    };
    const d0 = createImportDraft({ sources: [source], variant: { lang: "de", variant: "standard" } });
    const right = draftBlocksInColumn(d0, 1, "v1").map((b) => b.id);
    expect(right).toEqual(["b2", "b4"]);
    const d = run(
      d0,
      { op: "addVariant", variant: { lang: "ru", variant: "standard" } },
      { op: "assignVariant", blocks: right, from: "v1", to: "v2" },
      { op: "pairByOrder", variant: "v2" },
    );
    expect(importDraftToPrayer(d).structure.map((b) => b.translations.map((t) => t.lines![0]))).toEqual([
      ["Herr, erbarme dich.", "Господи, помилуй."],
      ["Gewähre, o Herr.", "Подай, Господи."],
    ]);
  });

  it("refuses a duplicate Variant, Source or segment", () => {
    const d = draft(DE);
    expect(
      applyImportOps(d, [{ op: "addVariant", variant: { lang: "de", variant: "standard" } }]).ok,
    ).toBe(false);
    expect(
      applyImportOps(d, [
        { op: "addVariant", variant: { lang: "cu", variant: "standard" } },
        { op: "addSource", source: readText(CU), variant: "v2" },
      ]).ok,
    ).toBe(false);
    expect(
      applyImportOps(d, [{ op: "assignVariant", blocks: ["b1"], from: "v1", to: "v9" }]).ok,
    ).toBe(false);
  });

  it("an unpaired translation can be paired with another block", () => {
    const d1 = run(
      draft(DE),
      { op: "addVariant", variant: { lang: "cu", variant: "standard" } },
      { op: "addSource", source: readText(CU, { id: "s2" }), variant: "v2" },
      { op: "pairByOrder", variant: "v2" },
      { op: "unpairVariant", block: "b3", variant: "v2" },
      { op: "unpairVariant", block: "b2", variant: "v2" },
    );
    // Each unpaired translation sits in a lone block right after its old partner.
    expect(d1.blocks.map((b) => [b.id, Object.keys(b.content)])).toEqual([
      ["b1", ["v1", "v2"]],
      ["b2", ["v1"]],
      ["b8", ["v2"]],
      ["b3", ["v1"]],
      ["b7", ["v2"]],
    ]);
    // "Воистину" belongs to "Amen" here: pair it there; "Аминь" stays alone.
    const d2 = run(d1, { op: "pairVariant", block: "b3", variant: "v2", from: "b8" });
    expect(importDraftToPrayer(d2).structure.map((b) => b.translations.map((t) => t.lines![0]))).toEqual([
      ["Christus ist auferstanden.", "Христосъ воскресе."],
      ["Wahrhaft auferstanden."],
      ["Amen.", "Воистину воскресе."],
      ["Аминь."],
    ]);
  });
});
