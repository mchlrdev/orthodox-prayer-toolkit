import { describe, expect, it } from "vitest";
import { speakerDisplayLabel, type Prayer } from "@orthodox-prayer-toolkit/core";
import { callTool } from "../src/agentTools/toolDirectory";
import { chatBlockLabel, chatSpeakerName } from "../src/builtInModel/chatLabels";
import { chipSummary } from "../src/components/ChatPane";
import { memoryHost } from "./fixtures/memoryToolHost";

describe("Chat pane labels", () => {
  it("names Import draft blocks by their source section", async () => {
    const mem = memoryHost();
    await callTool(mem.host, "import.start", { text: "Eins\n\nZwei\n\nDrei", lang: "de", variant: "standard" });
    const draft = mem.draft()!;
    expect(chatBlockLabel({ importDraft: draft, prayer: null }, draft.blocks[2]!.id)).toEqual({ word: "Section", n: 3 });
    expect(chatBlockLabel({ importDraft: draft, prayer: null }, "gone")).toBeNull();
  });

  it("names prayer blocks by position and speakers by name", () => {
    const prayer = {
      id: "p",
      structure: [{ id: "a", kind: "verse" }, { id: "b", kind: "verse" }],
      variants: [{ lang: "de", variant: "standard", speakers: { priest: { name: "Priester" } } }],
    } as unknown as Prayer;
    expect(chatBlockLabel({ importDraft: null, prayer }, "b")).toEqual({ word: "Block", n: 2 });
    expect(chatSpeakerName({ importDraft: null, prayer }, "priest")).toBe("Priester");
    expect(chatSpeakerName({ importDraft: null, prayer }, "deacon")).toBe(speakerDisplayLabel("deacon"));
  });

  it("joins chips that share their word", () => {
    expect(chipSummary([{ block: "a", label: "Section 3" }, { block: "b", label: "Section 7" }])).toBe("Section 3, 7");
    expect(chipSummary([{ block: "a", label: "Section 3" }, { block: "b", label: "Block 1" }])).toBe("Section 3, Block 1");
  });
});
