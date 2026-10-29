import { describe, expect, it } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
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

function run(host: ToolHost, instruction: string, context: Partial<ChatContext> = {}) {
  return runInstruction({
    instruction,
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

  it("questions get a text answer and change nothing", async () => {
    const mem = await importing();
    const outcome = await run(mem.host, "Was ist ein Troparion?");
    expect(outcome).toEqual({ kind: "answer", text: "Ein Troparion ist ein kurzer Hymnus." });
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
    expect(outcome).toEqual({ kind: "prayers", prayers: 2, blocks: 3, summary: "Done: Speaker Priest for 3 blocks in 2 prayers. Unsaved until you save; Undo in the editor reverts it." });
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
    expect(outcome).toEqual({ kind: "none", text: "Cancelled. Nothing changed." });
    expect(mem.unsaved).toEqual({});
  });
});
