import { describe, expect, it } from "vitest";
import {
  applyImportOps,
  chatImportOps,
  createImportDraft,
  draftBlockPlainText,
  groupSkips,
  readerKindOf,
  readText,
  ruleChatPlan,
  ruleTargets,
  speakerRubricAt,
  type ChatSection,
  type ChatTurn,
  type ImportDraft,
} from "../src/index.js";

/** Sentences from the user test (real model runs, Nov 2026): what the rules must settle on their own. */
const SECTIONS: ChatSection[] = [
  { block: "b1", n: 1, text: "Skip to content", visible: false, kind: "verse" },
  { block: "b2", n: 2, text: "Troparion, 4. Ton", visible: true, kind: "heading" },
  { block: "b3", n: 3, text: "Der Chor singt dreimal:", visible: true, kind: "verse" },
  { block: "b4", n: 4, text: "Herr, erbarme Dich. (dreimal)", visible: true, kind: "verse" },
  { block: "b5", n: 5, text: "Amen.", visible: true, kind: "verse", speaker: "choir" },
  { block: "b6", n: 6, text: "Friede allen.", visible: true, kind: "verse", speaker: "priest" },
  { block: "b7", n: 7, text: "Amen.", visible: true, kind: "verse", speaker: "reader" },
  { block: "b8", n: 8, text: "Die Kommentare sind geschlossen.", visible: true, kind: "annotation" },
  { block: "b9", n: 9, text: "Impressum · Datenschutz", visible: true, kind: "heading" },
];
const prev = (action: ChatTurn["action"], blocks: string[], plan = {}): ChatTurn => ({ instruction: "…", action, blocks, summary: "…", plan: { action: action!, ...plan }, changed: true });
const targets = (text: string, previous?: ChatTurn, chips: string[] = []) => {
  const plan = ruleChatPlan(text, "import", { previous });
  return { plan, targets: ruleTargets(text, plan, SECTIONS, { previous, chips }) };
};

describe("chat rules from the user test", () => {
  it.each([
    ["lass den Kram am Ende weg", "exclude", ["b8", "b9"]],
    ["die kommentare zeile weg", "exclude", ["b8"]],
    ["Troparion, 4.Ton ist überschrift", "setKind", ["b2"]],
    ["und 15 auch weg", "exclude", []],
    ["abschnitt 4 und 5 gehören nicht dazu", "exclude", ["b4", "b5"]],
    ["Abschnitt 5 und 6 gehören zusammen", "merge", ["b5", "b6"]],
    ["amen sagt alle", "setSpeaker", ["b5", "b7"]],
    ["nein der letzte amen ist das volk", "setSpeaker", ["b7"]],
    ["Der Chor singt dreimal: das ist eine Anweisung", "setKind", ["b3"]],
    ["die Zeile mit dreimal ist eine Anweisung", "setKind", ["b3", "b4"]],
  ])("%s → %s", (text, action, blocks) => {
    const r = targets(text);
    expect(r.plan.action).toBe(action);
    if (blocks.length) expect(r.targets).toEqual(blocks);
  });

  it("titles, undo, again, why", () => {
    expect(ruleChatPlan("und der titel ist Das Vaterunser", "import")).toMatchObject({ action: "setTitle", title: "Das Vaterunser" });
    expect(ruleChatPlan("das oben ist der Titel, also Das Vaterunser nicht die Gemeinde", "import")).toMatchObject({ action: "setTitle", title: "Das Vaterunser" });
    expect(ruleChatPlan("das oben ist der Titel", "import")).toMatchObject({ action: "setTitle" });
    expect(ruleChatPlan("das oben ist der Titel", "import").title).toBeUndefined();
    expect(ruleChatPlan("rückgängig", "import").action).toBe("undo");
    expect(ruleChatPlan("oops nimm den titel wieder", "import").action).toBe("undo");
    expect(ruleChatPlan("this page has a lot of wiki junk", "import").action).not.toBe("undo");
    const p = prev("setSpeaker", ["b5"], { speaker: "reader" });
    expect(ruleChatPlan("nochmal", "import", { previous: p })).toMatchObject({ action: "setSpeaker", speaker: "reader", again: true });
    expect(ruleChatPlan("warum hast du das gemacht?", "import", { previous: p })).toMatchObject({ explain: true });
    expect(ruleChatPlan("warum ist oben so viel weggelassen?", "import", { previous: p }).explain).toBeUndefined();
  });

  it("follow-ups and corrections", () => {
    const heading = prev("setKind", ["b2"], { kind: "heading" });
    expect(targets("Kondakion auch", heading).plan).toMatchObject({ action: "setKind", kind: "heading", subject: "Kondakion" });
    expect(targets("und abschnitt 4 auch", heading)).toMatchObject({ plan: { action: "setKind" }, targets: ["b4"] });
    expect(targets("und das hier auch", heading, ["b6"]).targets).toEqual(["b6"]);
    expect(targets("und das hier auch", heading).targets).toEqual([]);
    const speaker = prev("setSpeaker", ["b6"], { speaker: "deacon" });
    expect(targets("nein falsch, das sagt der Priester", speaker)).toMatchObject({ plan: { action: "setSpeaker", speaker: "priest", correct: true }, targets: ["b6"] });
    expect(ruleChatPlan("nein ich meinte nur den priester sprecher weg, leser soll bleiben", "import")).toMatchObject({ action: "removeSpeaker", onlySpeaker: "priest" });
  });

  it("self-corrections, negations and typos", () => {
    expect(ruleChatPlan("make Lord have mercy a heading? wait no its a verse", "import")).toMatchObject({ action: "setKind", kind: "verse" });
    expect(ruleChatPlan("Ehre dem Vater ist ein vers, kein titel", "import")).toMatchObject({ action: "setKind", kind: "verse" });
    expect(ruleChatPlan("Lord have mercy (Thrice) is not a heading, its spoken", "import").kind ?? "verse").toBe("verse");
    expect(ruleChatPlan("the (3x) bit is an instruction not the prayer itself", "import")).toMatchObject({ action: "note", quote: "(3x)" });
    expect(ruleChatPlan("Theotokion auch überschrift aber kleine", "import")).toMatchObject({ kind: "subheading" });
    expect(ruleChatPlan("Himel ist falsch, mus Himml sein... also Himmel", "import")).toMatchObject({ action: "editText", quote: "Himel", replacement: "Himmel" });
  });

  it("groups reasons", () => {
    expect(groupSkips([3, 4, 5, 9].map((n) => ({ n, reason: "is already left out" })))).toBe("sections 3–5, 9 are already left out");
  });

  it("from the holdout conversations", () => {
    expect(ruleChatPlan("2 und 3 gehören zusammen, ne doch nicht lass se getrennt", "import")).toMatchObject({ cancel: true });
    expect(ruleChatPlan("nein das sagt nicht der priester, das sagen wir", "import")).toMatchObject({ action: "setSpeaker", speaker: "people" });
    expect(ruleChatPlan("this is said by everyone", "import")).toMatchObject({ action: "setSpeaker", speaker: "all" });
    expect(ruleChatPlan("in abschnitt 23 steht Muttter, soll Mutter heißen", "import")).toMatchObject({ action: "editText", quote: "Muttter", replacement: "Mutter" });
    expect(ruleChatPlan("typo in the christmas one: 0 Christ should be O Christ", "import")).toMatchObject({ quote: "0 Christ", replacement: "O Christ" });
    expect(ruleChatPlan("gottesgebärin is falsch, gottesgebärerin", "import")).toMatchObject({ quote: "gottesgebärin", replacement: "gottesgebärerin" });
    expect(ruleChatPlan("8. september hochfest is auch überschrift, steht komisch als vers", "import")).toMatchObject({ kind: "heading" });
    expect(ruleChatPlan("εις το απόδειπνον is kleinere überschrift", "import")).toMatchObject({ kind: "subheading" });
    expect(ruleChatPlan("„(dreimal)“ is ne anweisung im vers, nicht extra abschnitt", "import")).toMatchObject({ action: "note" });
    const many: ChatSection[] = Array.from({ length: 6 }, (_, i) => ({ block: `b${i + 1}`, n: i + 1, text: ["Montag", "Troparion", "Dienstag", "Troparion", "Samstag", "Troparion"][i]!, visible: true, kind: "verse" }));
    const plan = ruleChatPlan("samstag und alles danach weglassen", "import");
    expect(ruleTargets("samstag und alles danach weglassen", plan, many)).toEqual(["b5", "b6"]);
    const four = ruleChatPlan("2 3 4 gehören zusammen", "import");
    expect(ruleTargets("2 3 4 gehören zusammen", four, many)).toEqual(["b2", "b3", "b4"]);
  });

  it("reader kinds and rubric speakers", () => {
    for (const h of ["2. Kondakion", "Ikos 3", "Troparion, 4. Ton", "Psalm 50", "Тропарь, глас 4", "ᾨδὴ α´", "Ἀπολυτίκιον. Ἦχος πλ. δ´"]) expect(readerKindOf(h)).toBe("heading");
    for (const a of ["Der Priester betet leise das Gebet zur 1. Antiphon:", "Während der Chor die 1. Antiphon singt, steht der Diakon vor der Christusikone.", "Frage: Genügt es, zu Hause zu beten?"]) expect(readerKindOf(a)).toBe("annotation");
    for (const v of ["Der Herr ist mein Hirte, mir wird nichts mangeln.", "Nach Deinem großen Erbarmen tilge meine Missetat.", "Herr, erbarme Dich.", "Ehre sei dem Vater:"]) expect(readerKindOf(v)).toBeUndefined();
    expect(speakerRubricAt("Der Priester tritt vor den Thron: Gesegnet, der da kommt")).toMatchObject({ speaker: "priest" });
    expect(speakerRubricAt("Alle Engel und Erzengel: lobet den Herrn")).toBeNull();
  });
});

import { createImportDraft, firstDraftBatches, readText } from "../src/index.js";

describe("role prompts", () => {
  it("use worked examples in the source's language, one line per paragraph", () => {
    const d = createImportDraft({ sources: [readText("Тропарь\n\nХристос воскресе из мертвых.\n\nСлава.")], variant: { lang: "ru", variant: "standard" } });
    const role = firstDraftBatches(d).find((b) => b.kind === "role")!;
    expect(role.examples![0]![0]).toContain("глас");
    expect(role.items.find((i) => i.text.startsWith("Христос"))!.text).toBe("Христос воскресе из мертвых.");
  });
});

describe("splitting a section from the chat", () => {
  const start = (text: string) =>
    createImportDraft({ sources: [readText(text, { id: "s" })], variant: { lang: "de", variant: "standard", title: "T" } });
  const run = (d: ImportDraft, sentence: string) => {
    const plan = ruleChatPlan(sentence, "import");
    const { ops, skipped } = chatImportOps(d, plan, ["b1"]);
    const r = applyImportOps(d, ops, { by: "model" });
    if (!r.ok) throw new Error(r.error);
    return { plan, skipped, blocks: r.draft.blocks.map((b) => [b.kind, draftBlockPlainText(r.draft, b, "v1")]) };
  };

  it("cuts before the quoted words", () => {
    const r = run(start("Troparion Dein Märtyrer, o Herr"), "teile das vor „Dein Märtyrer“");
    expect(r.plan.action).toBe("split");
    expect(r.blocks.map((b) => b[1])).toEqual(["Troparion", "Dein Märtyrer, o Herr"]);
  });

  it("cuts after them on request", () => {
    const r = run(start("Herr, erbarme Dich. Amen."), "split after „erbarme Dich.“");
    expect(r.blocks.map((b) => b[1])).toEqual(["Herr, erbarme Dich.", "Amen."]);
  });

  it("takes the first line when no words are named", () => {
    const r = run(start("Mein Gebet\nHerr, bleibe bei mir"), "teile abschnitt 1 auf");
    expect(r.blocks.map((b) => b[1])).toEqual(["Mein Gebet", "Herr, bleibe bei mir"]);
  });

  it("makes a part its own heading", () => {
    expect(run(start("Mein Gebet\nHerr, bleibe bei mir"), "die erste Zeile ist eine eigene Überschrift").blocks).toEqual([
      ["heading", "Mein Gebet"],
      ["verse", "Herr, bleibe bei mir"],
    ]);
    expect(run(start("Herr erbarme Dich Psalm 50 Amen"), "„Psalm 50“ ist eine eigene Überschrift").blocks.map((b) => b[0])).toEqual(["verse", "heading", "verse"]);
  });

  it("gives what a printed label splits off its speaker", () => {
    const d = start("Friede allen. Wir: Amen.");
    const plan = ruleChatPlan("da klebt noch Wir: Amen am priester, kannst du das trennen?", "import");
    const r = applyImportOps(d, chatImportOps(d, plan, ["b1"]).ops, { by: "model" });
    if (!r.ok) throw new Error(r.error);
    expect(r.draft.blocks.map((b) => [draftBlockPlainText(r.draft, b, "v1"), b.speaker])).toEqual([
      ["Friede allen.", undefined],
      ["Amen.", "people"],
    ]);
  });

  it("does not take the lines of a verse for two blocks", () => {
    expect(ruleChatPlan("teil den vers in einzelne zeilen auf so wie im buch", "import").cannot).toContain("Enter");
  });

  it("asks where when one line has nowhere to cut", () => {
    const r = run(start("Herr, erbarme Dich"), "teile das");
    expect(r.blocks.length).toBe(1);
    expect(r.skipped[0]!.reason).toContain("one line");
  });

  it("says how outside an import, and honours a no", () => {
    expect(ruleChatPlan("teile das", "prayer").cannot).toContain("Enter");
    expect(ruleChatPlan("lass se getrennt", "import").action).not.toBe("split");
    expect(ruleChatPlan("das nicht teilen", "import").action).toBe("answer");
    expect(ruleChatPlan("das ist nicht Teil des Gebets", "import").action).toBe("exclude");
  });
});
