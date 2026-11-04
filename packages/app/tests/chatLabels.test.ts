import { describe, expect, it } from "vitest";
import { speakerDisplayLabel, type Prayer } from "@orthodox-prayer-toolkit/core";
import { callTool } from "../src/agentTools/toolDirectory";
import { chatBlockLabel, chatBlockNumber, chatSpeakerName } from "../src/builtInModel/chatLabels";
import { chipSummary } from "../src/components/ChatPane";
import { memoryHost } from "./fixtures/memoryToolHost";

describe("Chat pane labels", () => {
  it("names Import draft blocks by their source number", async () => {
    const mem = memoryHost();
    await callTool(mem.host, "import.start", { text: "Eins\n\nZwei\n\nDrei", lang: "de", variant: "standard" });
    const draft = mem.draft()!;
    expect(chatBlockLabel({ importDraft: draft, prayer: null }, draft.blocks[2]!.id)).toBe("#3");
    expect(chatBlockLabel({ importDraft: draft, prayer: null }, "gone")).toBeNull();
  });

  it("names prayer blocks by their text and speakers by name", () => {
    const prayer = {
      id: "p",
      structure: [
        { id: "a", kind: "verse", translations: [{ lang: "de", variant: "standard", lines: ["Amen."] }] },
        { id: "b", kind: "verse", translations: [{ lang: "de", variant: "standard", lines: ["Ehre sei dem Vater und dem Sohne"] }] },
      ],
      variants: [{ lang: "de", variant: "standard", speakers: { priest: { name: "Priester" } } }],
    } as unknown as Prayer;
    expect(chatBlockLabel({ importDraft: null, prayer }, "b")).toBe("“Ehre sei dem Vater…”");
    expect(chatBlockNumber({ importDraft: null, prayer }, "b")).toBe(2);
    expect(chatSpeakerName({ importDraft: null, prayer }, "priest")).toBe("Priester");
    expect(chatSpeakerName({ importDraft: null, prayer }, "deacon")).toBe("Diakon");
    expect(chatSpeakerName({ importDraft: null, prayer: { ...prayer, variants: [{ lang: "xx", variant: "standard" }] } }, "deacon")).toBe(speakerDisplayLabel("deacon"));
  });

  it("joins chips in one line", () => {
    expect(chipSummary([{ block: "a", label: "#3" }, { block: "b", label: "#7" }])).toBe("#3, #7");
  });
});
