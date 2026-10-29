import { describe, expect, it } from "vitest";
import {
  applyImportOps,
  createImportDraft,
  readText,
  type ImportDraft,
  type ImportOp,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import {
  callTool,
  describeTools,
  handleAgentRequest,
  type ToolHost,
} from "../src/agentTools/toolDirectory";
import { prayerFileText } from "../src/session/persistPrayer";
import { runFirstDraft } from "../src/builtInModel/firstDraft";
import { standInRuntime } from "../src/builtInModel/standInModel";

const EXISTING: Prayer = {
  id: "ostergebete",
  type: "prayer",
  variants: [{ lang: "de", variant: "standard", title: "Ostergebete", license: "CC0", source: "Test" }],
  structure: [
    { id: "b1", kind: "verse", translations: [{ lang: "de", variant: "standard", lines: ["Christus ist erstanden!"] }] },
  ],
};

/** The session an Agent talks to: an in-memory Library plus the open Import draft. */
function memoryHost(options: { confirm?: boolean } = {}) {
  const files: Record<string, string> = { "ostergebete.json": prayerFileText(EXISTING) };
  let draft: ImportDraft | null = null;
  const steps: ImportDraft[] = [];
  const asked: string[] = [];
  const host: ToolHost = {
    appVersion: "0.3.8",
    library: () => ({
      entries: Object.entries(files).map(([path, text]) => {
        const p = JSON.parse(text) as Prayer;
        return { id: p.id, title: p.variants[0]!.title, path, valid: true, kinds: ["verse"] };
      }),
      variants: [{ lang: "de", variant: "standard" }],
    }),
    readPrayer: async (id) => {
      const text = files[`${id}.json`];
      return text ? (JSON.parse(text) as Prayer) : null;
    },
    readSource: async (input, id) => ({ source: readText(input.text ?? "", { id }), originHint: null }),
    importDraft: () => draft,
    startImport: ({ source, origin, variant }) => {
      draft = createImportDraft({ sources: [source], variant: { ...variant, source: origin } });
    },
    applyImportOps: (ops: ImportOp[]) => {
      const result = applyImportOps(draft!, ops, { by: "agent" });
      if (!result.ok) return false;
      steps.push(draft!);
      draft = result.draft;
      return true;
    },
    confirm: async ({ title }) => {
      asked.push(title);
      return options.confirm ?? true;
    },
    createPrayer: async (prayer) => {
      const path = `${prayer.id}.json`;
      if (path in files) return false;
      files[path] = prayerFileText(prayer);
      return true;
    },
    closeImport: () => {
      draft = null;
    },
    runFirstDraft: () =>
      runFirstDraft({
        draft: draft!,
        runtime: standInRuntime(),
        current: () => draft,
        apply: (step) => {
          const result = applyImportOps(draft!, step.ops, step.origin);
          if (result.ok) draft = result.draft;
        },
        signal: new AbortController().signal,
      }),
  };
  return { host, files, steps, asked, draft: () => draft };
}

async function call(host: ToolHost, name: string, args: unknown = {}) {
  const answer = await callTool(host, name, args);
  if (!answer.ok) throw new Error(answer.error);
  return answer.result as Record<string, unknown>;
}

const TEXT = "Troparion im 5. Ton\n\nChristus ist erstanden von den Toten,\nhat zertreten im Tode den Tod.\n\nDreimal.";

describe("Tool directory", () => {
  it("describes every tool with purpose, parameters and example", () => {
    const { tools } = describeTools("0.3.8");
    expect(tools.map((t) => t.name)).toEqual([
      "library.list",
      "prayer.read",
      "prayer.validate",
      "import.start",
      "import.read",
      "import.apply",
      "import.addLanguage",
      "import.firstDraft",
      "import.save",
    ]);
    for (const tool of tools) {
      expect(tool.purpose.length).toBeGreaterThan(20);
      expect(tool.params.type).toBe("object");
      expect(tool.example).toBeTypeOf("object");
    }
  });

  it("an agent imports a text, sorts it and saves it: the expected prayer file", async () => {
    const { host, files, steps, asked } = memoryHost();
    const started = await call(host, "import.start", {
      text: TEXT,
      origin: "orthodoxe-gebete.de",
      lang: "de",
      variant: "standard",
    });
    expect((started.blocks as unknown[]).length).toBe(3);

    await call(host, "import.apply", {
      ops: [
        { op: "setKind", target: { block: "b1" }, kind: "heading" },
        { op: "setKind", target: { block: "b3" }, kind: "annotation" },
      ],
    });
    const read = await call(host, "import.read");
    expect((read.blocks as Array<{ kind: string; origin: string }>).map((b) => [b.kind, b.origin])).toEqual([
      ["heading", "agent"],
      ["verse", "reader"],
      ["annotation", "agent"],
    ]);

    const saved = await call(host, "import.save", {
      meta: { id: "ostertroparion", type: "troparion", tone: 5 },
      variants: { v1: { title: "Ostertroparion", license: "CC0" } },
    });
    expect(saved).toEqual({ saved: "ostertroparion.json" });
    expect(asked).toEqual(["Save to library?"]);
    expect(JSON.parse(files["ostertroparion.json"]!)).toEqual({
      id: "ostertroparion",
      type: "troparion",
      tone: 5,
      variants: [
        { lang: "de", variant: "standard", title: "Ostertroparion", license: "CC0", source: "orthodoxe-gebete.de" },
      ],
      structure: [
        { id: "b1", kind: "heading", translations: [{ lang: "de", variant: "standard", text: "Troparion im 5. Ton" }] },
        {
          id: "b2",
          kind: "verse",
          translations: [
            {
              lang: "de",
              variant: "standard",
              lines: ["Christus ist erstanden von den Toten,", "hat zertreten im Tode den Tod."],
            },
          ],
        },
        { id: "b3", kind: "annotation", translations: [{ lang: "de", variant: "standard", text: "Dreimal." }] },
      ],
    });
    // One undo step per call that changed the draft (apply, then the save metadata).
    expect(steps).toHaveLength(2);
  });

  it("the Built-in model's first draft (stand-in) becomes the expected prayer", async () => {
    const { host, files } = memoryHost();
    await call(host, "import.start", {
      text: "Troparion im 4. Ton: Dein Märtyrer, Herr, hat die Krone empfangen.\n\nPriester: Gesegnet ist unser Gott.\n\nDreimal.\n\nSeite drucken",
      lang: "de",
      variant: "standard",
      origin: "x",
    });
    const view = await call(host, "import.firstDraft");
    expect((view.blocks as Array<{ origin: string; confidence?: number }>)[0]).toMatchObject({
      origin: "model",
      confidence: 0.8,
    });
    await call(host, "import.save", {
      meta: { id: "prokopios", type: "troparion" },
      variants: { v1: { title: "Prokopios", license: "CC0" } },
    });
    const saved = JSON.parse(files["prokopios.json"]!) as Prayer;
    expect(saved.variants[0]!.speakers).toEqual({ priest: { name: "Priester" } });
    expect(saved.structure.map((b) => [b.kind, b.speaker ?? null, b.translations[0]!.text ?? b.translations[0]!.lines])).toEqual([
      ["heading", null, "Troparion im 4. Ton"],
      ["verse", null, ["Dein Märtyrer, Herr, hat die Krone empfangen."]],
      ["verse", "priest", ["Gesegnet ist unser Gott."]],
      ["annotation", null, "Dreimal."],
    ]);
  });

  it("saving waits for the user: declined → nothing written", async () => {
    const { host, files } = memoryHost({ confirm: false });
    await call(host, "import.start", { text: TEXT, lang: "de", variant: "standard", origin: "x" });
    const answer = await callTool(host, "import.save", {
      meta: { id: "ostertroparion", type: "troparion" },
      variants: { v1: { title: "Ostertroparion", license: "CC0" } },
    });
    expect(answer).toEqual({ ok: false, error: "The user declined saving" });
    expect(Object.keys(files)).toEqual(["ostergebete.json"]);
  });

  it("never overwrites: an id the Library has is refused before asking", async () => {
    const { host, asked } = memoryHost();
    await call(host, "import.start", { text: TEXT, lang: "de", variant: "standard", origin: "x" });
    const answer = await callTool(host, "import.save", {
      meta: { id: "ostergebete", type: "prayer" },
      variants: { v1: { title: "Ostergebete", license: "CC0" } },
    });
    expect(answer.ok).toBe(false);
    expect(asked).toEqual([]);
  });

  it("adds a second language and pairs it by order", async () => {
    const { host } = memoryHost();
    await call(host, "import.start", { text: "Christus ist erstanden!\n\nAmen.", lang: "de", variant: "standard" });
    const view = await call(host, "import.addLanguage", {
      text: "Христос воскресе!\n\nАминь.",
      lang: "cu",
      variant: "standard",
    });
    expect((view.blocks as Array<{ text: Record<string, string> }>).map((b) => b.text)).toEqual([
      { v1: "Christus ist erstanden!", v2: "Христос воскресе!" },
      { v1: "Amen.", v2: "Аминь." },
    ]);
  });

  it("explains refused calls", async () => {
    const { host, draft } = memoryHost();
    expect(await callTool(host, "import.read", {})).toEqual({
      ok: false,
      error: "No Import draft is open. Start one with import.start.",
    });
    expect((await callTool(host, "import.start", { lang: "de" })).ok).toBe(false);
    expect(await callTool(host, "import.start", { text: 5, lang: "de", variant: "x" })).toEqual({
      ok: false,
      error: "arguments.text must be a string",
    });
    await call(host, "import.start", { text: TEXT, lang: "de", variant: "standard" });
    const before = draft();
    const bad = await callTool(host, "import.apply", {
      ops: [
        { op: "setKind", target: { block: "b1" }, kind: "heading" },
        { op: "merge", block: "b99" },
      ],
    });
    expect(bad).toEqual({ ok: false, error: 'No block "b99"' });
    expect(draft()).toBe(before);
    expect((await callTool(host, "nope", {})).ok).toBe(false);
  });

  it("asks before replacing an open draft", async () => {
    const { host, asked } = memoryHost({ confirm: false });
    await call(host, "import.start", { text: TEXT, lang: "de", variant: "standard" });
    const answer = await callTool(host, "import.start", { text: "Amen.", lang: "de", variant: "standard" });
    expect(answer).toEqual({ ok: false, error: "The user kept the open Import draft" });
    expect(asked).toEqual(["Replace the import draft?"]);
  });

  it("reads the Library and validates prayers", async () => {
    const { host } = memoryHost();
    const list = await call(host, "library.list");
    expect(list.prayers).toEqual([
      { id: "ostergebete", title: "Ostergebete", path: "ostergebete.json", valid: true, kinds: ["verse"] },
    ]);
    expect(await call(host, "prayer.read", { id: "ostergebete" })).toMatchObject({ id: "ostergebete" });
    const checked = await call(host, "prayer.validate", { prayer: { id: "x" } });
    expect(checked.valid).toBe(false);
  });
});

describe("Agent HTTP routes", () => {
  it("GET / lists the tools; POST /tools/{name} calls one", async () => {
    const { host } = memoryHost();
    const index = await handleAgentRequest(host, { method: "GET", path: "/", body: "" });
    expect(index.status).toBe(200);
    expect((index.body as { tools: unknown[] }).tools).toHaveLength(9);
    const list = await handleAgentRequest(host, { method: "POST", path: "/tools/library.list", body: "{}" });
    expect(list.status).toBe(200);
    expect(await handleAgentRequest(host, { method: "POST", path: "/tools/library.list", body: "{" })).toMatchObject({
      status: 400,
    });
    expect((await handleAgentRequest(host, { method: "GET", path: "/x", body: "" })).status).toBe(404);
  });
});
