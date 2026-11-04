/**
 * Conversations with the Assistant on the real Built-in model:
 *
 *   pnpm --filter @orthodox-prayer-toolkit/app measure:chat      (ONLY=name1,name2)
 *
 * Each chat/<name>.json is
 *   { "source": "<id in sources/>" | null, "text"?: "…pasted text…", "lang": "de",
 *     "firstDraft": true,
 *     "messages": [ { "text": "Abschnitt 3 ist der Leser", "chips"?: [3], "expect"?: "what should happen" } ] }
 * The import runs like in the app (first draft optional), then every message
 * goes to the Assistant with the conversation so far. Writes
 * reports/chat-<name>-<time>.md: each message, the answer, what changed,
 * and the draft after it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { applyImportOps, groupSkips, readText, suggestTitle, type ChatTurn } from "@orthodox-prayer-toolkit/core";
import { callTool } from "../../src/agentTools/toolDirectory";
import { changeLines } from "../../src/builtInModel/changeLines";
import { runInstruction } from "../../src/builtInModel/chatInstruction";
import { runFirstDraft } from "../../src/builtInModel/firstDraft";
import { segmentIndex } from "../../src/importDraft/sourceView";
import { memoryHost } from "../../tests/fixtures/memoryToolHost";
import { dumpDraft, readSourceFile, stamp, TESTSET, withModel, writeReport } from "./shared";

type Scenario = {
  source?: string | null;
  text?: string;
  lang?: string;
  firstDraft?: boolean;
  messages: Array<{ text: string; chips?: number[]; expect?: string }>;
};

it("chat scenarios", async () => {
  const only = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  const dir = join(TESTSET, process.env.CHATDIR ?? "chat");
  const names = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).filter((n) => !only || only.includes(n)).sort();
  await withModel(async (runtime) => {
    for (const name of names) {
      const sc = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as Scenario;
      const mem = memoryHost();
      const source = sc.source ? await readSourceFile(sc.source) : readText(sc.text ?? "", { id: "s1", name: "Pasted text" });
      if (!source) {
        console.log(`${name}: source not found`);
        continue;
      }
      mem.host.startImport({ source, origin: sc.source ?? "Pasted text", variant: { lang: sc.lang ?? "de", variant: "standard", title: suggestTitle(source) ?? "" } });
      const out: string[] = [`# Chat ${name} ${stamp()}\n`];
      if (sc.firstDraft !== false) {
        const t = Date.now();
        await runFirstDraft({
          draft: mem.draft()!,
          runtime,
          current: () => mem.draft(),
          apply: (step) => mem.host.applyImportOps(step.ops, step.origin),
          signal: new AbortController().signal,
        });
        out.push(`First draft (${((Date.now() - t) / 1000).toFixed(0)}s):\n\n\`\`\`\n${dumpDraft(mem.draft()!)}\n\`\`\`\n`);
      }
      const history: ChatTurn[] = [];
      let lastChange: unknown = null;
      for (const message of sc.messages) {
        const draft = mem.draft()!;
        const segs = segmentIndex(draft);
        const numberOf = (block: string) => {
          const b = draft.blocks.find((x) => x.id === block);
          const first = b && Object.values(b.content).flat().find((s) => "seg" in s);
          return first && "seg" in first ? segs.get(first.seg)?.n : undefined;
        };
        const chips = (message.chips ?? []).flatMap((n) => draft.blocks.filter((b) => numberOf(b.id) === n).map((b) => b.id));
        const t = Date.now();
        let reply: string;
        try {
          const outcome = await runInstruction({
            instruction: message.text,
            context: { view: "import", blocks: chips },
            runtime,
            host: { ...mem.host, applyImportOps: (ops) => mem.host.applyImportOps(ops, { by: "model" }) },
            signal: new AbortController().signal,
            history,
            undoLast: () => {
              // The last answer that changed the draft, if it is still the latest step.
              if (!lastChange || mem.draft() !== lastChange) return false;
              lastChange = null;
              return mem.undo();
            },
          });
          if (outcome.kind === "import" && outcome.changes.length > 0) lastChange = outcome.after;
          if (outcome.turn) history.push(outcome.turn);
          if (outcome.kind === "import") {
            const lines = changeLines(outcome.changes).map((l) => `    #${numberOf(l.block) ?? "?"} ${l.text}`);
            const skipped = outcome.skipped?.length ? `\n    Unchanged: ${groupSkips(outcome.skipped)}` : "";
            reply = `${outcome.understood ?? "Done"}.\n${lines.join("\n")}${skipped}`;
          } else if (outcome.kind === "prayers") reply = outcome.summary;
          else reply = outcome.text;
        } catch (error) {
          reply = `ERROR ${error instanceof Error ? error.message : String(error)}`;
        }
        out.push(
          `**User**${message.chips?.length ? ` (selected #${message.chips.join(", #")})` : ""}: ${message.text}\n\n` +
            `**Assistant** (${((Date.now() - t) / 1000).toFixed(0)}s): ${reply}\n\n` +
            (message.expect ? `_Expected:_ ${message.expect}\n\n` : "") +
            `\`\`\`\n${dumpDraft(mem.draft()!)}\n\`\`\`\n`,
        );
        console.log(`${name} › ${message.text}\n  → ${reply.split("\n").join("\n    ")}`);
      }
      console.log(writeReport(`chat-${name}-${stamp()}.md`, out.join("\n")));
      void callTool;
      void applyImportOps;
    }
  });
});
