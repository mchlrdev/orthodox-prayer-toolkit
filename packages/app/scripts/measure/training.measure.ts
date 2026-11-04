/**
 * Training data for a LoRA adapter of the Built-in model, from the test set:
 *
 *   pnpm --filter @orthodox-prayer-toolkit/app export:training
 *
 * Each source is imported like in the app (reader rules first), the
 * first-draft questions are built as the model sees them, and every item is
 * labelled from the reviewed expected/<id>.json (a paragraph not in the
 * prayer = "exclude"). Writes training/train.jsonl and training/eval.jsonl
 * (every fifth source held out) in chat format: system, user, assistant
 * ("1=A\n2=D …"). No model is loaded.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import {
  applyImportOps,
  createImportDraft,
  decisionPrompts,
  firstDraftBatches,
  readerRuleOps,
  type DecisionBatch,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import { readSourceFile, TESTSET } from "./shared";

type Inline = string | Array<{ t: string; v: string }>;
const squash = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\d]+/gu, "");
const plain = (c: Inline | undefined): string => (typeof c === "string" ? c : (c ?? []).map((r) => r.v).join(""));

function expectedKinds(prayer: Prayer): Array<{ text: string; kind: string }> {
  const v = prayer.variants[0]!;
  return prayer.structure.flatMap((b) => {
    const t = b.translations.find((x) => x.lang === v.lang && x.variant === v.variant);
    if (!t) return [];
    const text = "lines" in t && t.lines ? (t.lines as Inline[]).map(plain).join(" ") : plain(t.text as Inline);
    return text ? [{ text: squash(text), kind: b.kind }] : [];
  });
}

it("export training data", async () => {
  const dir = join(TESTSET, "expected");
  const out = join(TESTSET, "training");
  mkdirSync(out, { recursive: true });
  const train: string[] = [];
  const evalSet: string[] = [];
  const counts: Record<string, number> = {};
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  files.forEach(() => undefined);
  for (const [n, file] of files.entries()) {
    const id = file.replace(/\.json$/, "");
    const prayer = JSON.parse(readFileSync(join(dir, file), "utf8")) as Prayer;
    const source = await readSourceFile(id);
    if (!source) continue;
    const v = prayer.variants[0]!;
    let draft = createImportDraft({ sources: [source], variant: { lang: v.lang, variant: v.variant } });
    const read = applyImportOps(draft, readerRuleOps(draft), { by: "reader", confidence: 1 });
    if (read.ok) draft = read.draft;
    const wanted = expectedKinds(prayer);
    const label = (text: string): string => {
      const q = squash(text.replace(/\s*‹(before|after): [^›]*›/gu, "").replace(/^\([^)]*\)\s*/, "").replace(/…$/u, ""));
      if (!q) return "exclude";
      const hit = wanted.find((w) => w.text === q) ?? wanted.find((w) => q.length >= 12 && (w.text.includes(q) || q.includes(w.text)));
      return hit ? hit.kind : "exclude";
    };
    // A cut test file covers only the start of the page: items after its last known paragraph have no label.
    const cut = existsSync(join(TESTSET, "sources", `${id}.full.txt`));
    for (const full of firstDraftBatches(draft).filter((b): b is DecisionBatch => b.kind === "role")) {
      // Only distinctive paragraphs set the end ("Amen." comes back everywhere).
      const lastKnown = full.items.reduce((at, item, i) => {
        const core = item.text.replace(/\s*‹(before|after): [^›]*›/gu, "").replace(/^\([^)]*\)\s*/, "");
        return label(item.text) !== "exclude" && squash(core).length >= 25 ? i : at;
      }, -1);
      const batch = cut ? { ...full, items: full.items.slice(0, lastKnown + 1) } : full;
      if (batch.items.length === 0) continue;
      // A page whose paragraphs mostly do not match the expected prayer (other line breaks, columns) teaches noise.
      const unknown = batch.items.filter((item) => label(item.text) === "exclude").length;
      if (cut && unknown / batch.items.length > 0.6) {
        console.log(`skipped ${id}: ${unknown}/${batch.items.length} paragraphs not in the expected prayer`);
        continue;
      }
      for (const prompt of decisionPrompts(batch, 40)) {
        const answer = batch.items
          .slice(prompt.first, prompt.first + prompt.count)
          .map((item, i) => {
            const id = label(item.text);
            const k = batch.options.findIndex((o) => o.id === id);
            counts[id] = (counts[id] ?? 0) + 1;
            return `${i + 1}=${prompt.letters[k < 0 ? batch.options.findIndex((o) => o.id === "verse") : k]}`;
          })
          .join("\n");
        const line = JSON.stringify({
          source: id,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
            { role: "assistant", content: answer },
          ],
        });
        (n % 5 === 4 ? evalSet : train).push(line);
      }
    }
  }
  writeFileSync(join(out, "train.jsonl"), `${train.join("\n")}\n`);
  writeFileSync(join(out, "eval.jsonl"), `${evalSet.join("\n")}\n`);
  writeFileSync(
    join(out, "README.md"),
    `# Training data (role question of the first draft)\n\nFrom ${files.length} reviewed prayers: ${train.length} training prompts, ${evalSet.length} held-out prompts (every fifth source).\nLabels: ${JSON.stringify(counts)}\n\nChat format (system / user / assistant "1=A …"), the exact prompts the app sends (packages/core decisionPrompts).\nFor a LoRA on Qwen3.5 4B: train on train.jsonl (loss on the assistant turn only), check on eval.jsonl, export the adapter as GGUF (llama.cpp convert_lora_to_gguf.py) and load it with node-llama-cpp (\`lora\` option of createContext).\nChat plans (Assistant) are not in here yet: they need synthetic instructions with their plans.\n`,
  );
  console.log(`train ${train.length}, eval ${evalSet.length}, labels ${JSON.stringify(counts)}`);
});
