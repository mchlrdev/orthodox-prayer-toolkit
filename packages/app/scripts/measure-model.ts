/**
 * Measurement run for the Built-in model's first draft (ticket 09):
 *
 *   pnpm --filter @orthodox-prayer-toolkit/app measure:model [library-dir] [model.gguf]
 *
 * Each prayer JSON in the folder is the expected answer. The source is
 * `<id>.txt` next to it when present (a real source), otherwise plain text
 * made from the prayer (speakers as "Name: " prefixes). The script imports
 * the source, lets the model decide, and prints hit rates per prayer:
 * blocks found with the exact text, kind and speaker of those blocks, time.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  applyImportOps,
  createImportDraft,
  decisionPrompts,
  decisionStep,
  firstDraftBatches,
  importDraftToPrayer,
  plainText,
  readText,
  speakerBatch,
  type DecisionItem,
  type ImportDraft,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import { createDecider } from "../electron/modelRuntime.ts";

const dir = resolve(process.argv[2] ?? join(import.meta.dirname, "../../../examples"));
const modelPath =
  process.argv[3] ??
  join(homedir(), "Library/Application Support/Orthodox Prayer Toolkit/models/qwen3.5-4b/1/Qwen3.5-4B-Q4_K_M.gguf");

type Block = Prayer["structure"][number];

function blockText(block: Block, prayer: Prayer): string {
  const t = block.translations.find((x) => x.lang === prayer.variants[0]!.lang && x.variant === prayer.variants[0]!.variant);
  if (!t) return "";
  return "lines" in t && t.lines ? t.lines.map((l) => plainText(l)).join("\n") : plainText(t.text ?? "");
}

function sourceOf(prayer: Prayer): string {
  const speakers = prayer.variants[0]!.speakers ?? {};
  return prayer.structure
    .map((b) => {
      const text = blockText(b, prayer);
      const name = b.speaker ? (speakers[b.speaker]?.name ?? b.speaker) : null;
      return name ? `${name}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n\n");
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const decider = await createDecider(modelPath);
const totals = { expected: 0, found: 0, kind: 0, speakers: 0, speakerHits: 0, ms: 0 };
console.log(`Model ${modelPath}\nLibrary ${dir}\n`);
console.log("prayer".padEnd(32), "blocks  found  kind   speaker  time");

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "manifest.json").sort()) {
  const expected = JSON.parse(readFileSync(join(dir, file), "utf8")) as Prayer;
  if (!Array.isArray(expected.structure)) continue;
  const txt = join(dir, file.replace(/\.json$/, ".txt"));
  const text = existsSync(txt) ? readFileSync(txt, "utf8") : sourceOf(expected);
  const v = expected.variants[0]!;
  let draft: ImportDraft = createImportDraft({
    sources: [readText(text, { id: "s1" })],
    variant: { lang: v.lang, variant: v.variant },
  });
  const started = Date.now();
  for (const batch of firstDraftBatches(draft)) {
    const speakers: DecisionItem[] = [];
    const run = async (b: typeof batch) => {
      for (const prompt of decisionPrompts(b, 40)) {
        await decider.decide(prompt, (i, p) => {
          const item = b.items[i]!;
          if (b.kind === "prefix" && b.options[p.indexOf(Math.max(...p))]!.id === "speaker") speakers.push(item);
          const step = decisionStep(draft, b, item, p);
          if (!step) return;
          const result = applyImportOps(draft, step.ops, step.origin);
          if (result.ok) draft = result.draft;
        });
      }
    };
    await run(batch);
    const follow = batch.kind === "prefix" ? speakerBatch(batch, speakers) : null;
    if (follow) await run(follow);
  }
  const ms = Date.now() - started;
  const got = importDraftToPrayer(draft);
  const byText = new Map(got.structure.map((b) => [norm(blockText(b, got)), b]));
  let found = 0, kind = 0, speakers = 0, speakerHits = 0;
  for (const block of expected.structure) {
    const match = byText.get(norm(blockText(block, expected)));
    if (block.speaker) speakers += 1;
    if (!match) continue;
    found += 1;
    if (match.kind === block.kind) kind += 1;
    if (block.speaker && match.speaker === block.speaker) speakerHits += 1;
  }
  const n = expected.structure.length;
  const pct = (a: number, b: number) => (b === 0 ? "  –  " : `${Math.round((a / b) * 100)}%`.padStart(5));
  console.log(
    (expected.id ?? file).slice(0, 31).padEnd(32),
    String(n).padStart(6),
    pct(found, n).padStart(6),
    pct(kind, found).padStart(6),
    pct(speakerHits, speakers).padStart(8),
    `${(ms / 1000).toFixed(1)}s`.padStart(6),
  );
  Object.assign(totals, {
    expected: totals.expected + n,
    found: totals.found + found,
    kind: totals.kind + kind,
    speakers: totals.speakers + speakers,
    speakerHits: totals.speakerHits + speakerHits,
    ms: totals.ms + ms,
  });
}
await decider.dispose();
const pct = (a: number, b: number) => (b === 0 ? "–" : `${Math.round((a / b) * 100)}%`);
console.log(
  `\nTotal: ${totals.expected} blocks · found ${pct(totals.found, totals.expected)} · kind ${pct(totals.kind, totals.found)} · speaker ${pct(totals.speakerHits, totals.speakers)} · ${(totals.ms / 1000).toFixed(1)}s`,
);
