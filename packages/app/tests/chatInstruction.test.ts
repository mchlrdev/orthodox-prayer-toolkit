import { describe, expect, it } from "vitest";
import { draftBlockContent, draftBlockPlainText, type ChatTurn, type Prayer } from "@orthodox-prayer-toolkit/core";
import { callTool, type ToolHost } from "../src/agentTools/toolDirectory";
import { runInstruction, type ChatContext } from "../src/builtInModel/chatInstruction";
import { standInRuntime } from "../src/builtInModel/standInModel";
import { memoryHost } from "./fixtures/memoryToolHost";

const TEXT = "Troparion der Auferstehung\n\nPriester: Christus ist erstanden von den Toten.\n\nDreimal\n\nQuelle: orthodoxe-gebete.de";

/** The chat's host: import changes come from the model. */
function modelHost(host: ToolHost): ToolHost {
  return { ...host, applyImportOps: (ops) => host.applyImportOps(ops, { by: "model" }) };
}

async function importing() {
  const mem = memoryHost();
  const started = await callTool(mem.host, "import.start", { text: TEXT, lang: "de", variant: "standard" });
  if (!started.ok) throw new Error(started.error);
  return mem;
}

function run(host: ToolHost, instruction: string, context: Partial<ChatContext> = {}, history: ChatTurn[] = []) {
  return runInstruction({
    instruction,
    history,
    context: { view: "import", blocks: [], ...context },
    runtime: standInRuntime(undefined, () => "Ein Troparion ist ein kurzer Hymnus."),
    host: modelHost(host),
    signal: new AbortController().signal,
  });
}

describe("Chat pane instructions (stand-in model)", () => {
  it("“Abschnitt 4 gehört nicht dazu” excludes that section, one undo step", async () => {
    const mem = await importing();
    const outcome = await run(mem.host, "Abschnitt 4 gehört nicht dazu.");
    expect(outcome).toMatchObject({ kind: "import", changes: [{ block: "b4", what: "excluded" }] });
    expect(mem.steps).toHaveLength(1);
    expect(mem.draft()!.excluded).toEqual(["s1-4"]);
  });

  it("“„Priester:“ ist der Sprecher” sets the speaker and removes the label", async () => {
    const mem = await importing();
    const outcome = await run(mem.host, "„Priester:“ ist der Sprecher.");
    expect(outcome.kind).toBe("import");
    const b2 = mem.draft()!.blocks[1]!;
    expect(b2.speaker).toBe("priest");
    expect(b2.origin.speaker).toEqual({ by: "model" });
    expect(mem.draft()!.variants[0]!.speakers).toEqual({ priest: { name: "Priester" } });
    expect(outcome.kind === "import" && outcome.changes.map((c) => c.what)).toEqual(["speaker", "text"]);
  });

  it("selected blocks are the target: “Das ist eine Anmerkung”", async () => {
    const mem = await importing();
    await run(mem.host, "Das ist eine Anmerkung.", { blocks: ["b3"] });
    expect(mem.draft()!.blocks.map((b) => b.kind)).toEqual(["verse", "verse", "annotation", "verse"]);
  });

  it("numbers in the instruction win over the selected block", async () => {
    const mem = await importing();
    await run(mem.host, "Zeile 4 gehört nicht dazu", { blocks: ["b2"] });
    expect(mem.draft()!.excluded).toEqual(["s1-4"]);
  });

  it("“2 und 4 …” and “die letzte Zeile” name blocks without a word", async () => {
    const mem = await importing();
    await run(mem.host, "Die letzte Zeile gehört nicht dazu");
    expect(mem.draft()!.excluded).toEqual(["s1-4"]);
  });

  it("questions get a text answer and change nothing", async () => {
    const mem = await importing();
    const outcome = await run(mem.host, "Was ist ein Troparion?");
    expect(outcome).toMatchObject({ kind: "answer", text: "Ein Troparion ist ein kurzer Hymnus." });
    expect(mem.steps).toHaveLength(0);
  });

  it("a library-wide change asks first and lists the prayers", async () => {
    const prayer = (id: string, lines: string[]): Prayer => ({
      id,
      type: "prayer",
      variants: [{ lang: "de", variant: "standard", title: id, license: "CC0", source: "x" }],
      structure: lines.map((l, i) => ({ id: `b${i + 1}`, kind: "verse", translations: [{ lang: "de", variant: "standard", lines: [l] }] })),
    });
    const mem = memoryHost({
      selected: "abendgebet",
      prayers: [
        prayer("abendgebet", ["Ehre sei dem Vater und dem Sohne.", "Amen."]),
        prayer("morgengebet", ["Herr, erbarme Dich!", "Ehre sei dem Vater und dem Sohne.", "Ehre sei dem Vater …"]),
      ],
    });
    const outcome = await runInstruction({
      instruction: "Gib in allen Gebeten „Ehre sei dem Vater …“ den Speaker Priester.",
      context: { view: "prayer", blocks: [] },
      runtime: standInRuntime(),
      host: mem.host,
      signal: new AbortController().signal,
    });
    expect(outcome).toMatchObject({ kind: "prayers", prayers: 2, blocks: 3, summary: "Done: Speaker Priest for 3 blocks in 2 prayers. Unsaved until you save; Undo in the editor reverts it." });
    expect(mem.confirms[0]).toMatchObject({
      title: "Change 3 blocks in 2 prayers?",
      items: [
        { label: "abendgebet", count: 1 },
        { label: "morgengebet", count: 2 },
      ],
    });
    expect(mem.unsaved.morgengebet!.structure.map((b) => b.speaker ?? null)).toEqual([null, "priest", "priest"]);
  });

  it("declining the confirmation changes nothing", async () => {
    const mem = memoryHost({ confirm: false });
    const outcome = await runInstruction({
      instruction: "Gib „Christus ist erstanden“ den Speaker Chor.",
      context: { view: "library", blocks: [] },
      runtime: standInRuntime(),
      host: mem.host,
      signal: new AbortController().signal,
    });
    expect(outcome).toMatchObject({ kind: "none", text: "Cancelled. Nothing changed." });
    expect(mem.unsaved).toEqual({});
  });

  describe("the conversation from the bug report", () => {
    const TEXT2 = "Psalm 50\n\nLeser: Erbarme Dich meiner, o Gott.\n\nPriester: Friede allen.\n\nHerr, erbarme Dich (dreimal). Amen.";
    async function report() {
      const mem = memoryHost();
      const started = await callTool(mem.host, "import.start", { text: TEXT2, lang: "de", variant: "standard" });
      if (!started.ok) throw new Error(started.error);
      return mem;
    }
    const text = (mem: Awaited<ReturnType<typeof report>>, i: number) =>
      draftBlockPlainText(mem.draft()!, mem.draft()!.blocks[i]!, "v1");

    it("„reader“ in quotes is a speaker, not an annotation; the label goes", async () => {
      const mem = await report();
      const outcome = await run(mem.host, "Gib dem Block den Speaker „reader“", { blocks: ["b2"] });
      expect(outcome).toMatchObject({ kind: "import", understood: "Speaker Leser in section 2" });
      expect(mem.draft()!.blocks[1]).toMatchObject({ kind: "verse", speaker: "reader" });
      expect(text(mem, 1)).toBe("Erbarme Dich meiner, o Gott.");
    });

    it("“Speaker Priest” on a „Priester:“ verse sets priest; again says why nothing changed", async () => {
      const mem = await report();
      await run(mem.host, "Dieser Vers hat den Speaker Priest", { blocks: ["b3"] });
      expect(mem.draft()!.blocks[2]!.speaker).toBe("priest");
      expect(text(mem, 2)).toBe("Friede allen.");
      const again = await run(mem.host, "Dieser Vers hat den Speaker Priest", { blocks: ["b3"] });
      expect(again).toMatchObject({ kind: "none", text: "Speaker Priester in section 3. Nothing changed: section 3 already has the speaker Priester." });
    });

    it("a follow-up keeps the context of the previous answer", async () => {
      const mem = await report();
      const first = await run(mem.host, "Abschnitt 2 hat den Speaker Diakon");
      expect(mem.draft()!.blocks[1]!.speaker).toBe("deacon");
      const second = await run(mem.host, "Nein, Leser.", {}, [first.turn!]);
      expect(second.kind).toBe("import");
      expect(mem.draft()!.blocks[1]!.speaker).toBe("reader");
    });

    it("marks words inside a verse as an inline annotation", async () => {
      const mem = await report();
      const outcome = await run(mem.host, "„(dreimal)“ ist eine Anmerkung");
      expect(outcome).toMatchObject({ kind: "import", changes: [{ block: "b4", what: "note" }] });
      expect(JSON.stringify(draftBlockContent(mem.draft()!, mem.draft()!.blocks[3]!, "v1"))).toContain('{"t":"note","v":"(dreimal)"}');
    });
  });
});
