/**
 * The whole first draft on the real Built-in model, against the test set:
 *
 *   pnpm --filter @orthodox-prayer-toolkit/app measure:import      (ONLY=id1,id2 SOURCE=html)
 *
 * For each expected/<id>.json the source sources/<id>.txt (or .html with
 * SOURCE=html) is imported like in the app (reader rules, then the model's
 * Decisions) and compared block by block: text found, kind, speaker, inline
 * annotations, title, noise left in. Writes reports/import-<time>.md.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import {
  createImportDraft,
  importDraftToPrayer,
  suggestTitle,
  type ImportDraft,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import { runFirstDraft } from "../../src/builtInModel/firstDraft";
import { applyImportOps } from "@orthodox-prayer-toolkit/core";
import { dumpDraft, readSourceFile, stamp, TESTSET, withModel, writeReport } from "./shared";

type Block = Prayer["structure"][number];
type Inline = string | Array<{ t: string; v: string }>;

const norm = (s: string) => s.normalize("NFC").replace(/[\s ]+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim().toLowerCase();
const plain = (c: Inline | undefined): string => (typeof c === "string" ? c : (c ?? []).map((r) => r.v).join(""));
const notes = (c: Inline | undefined): string[] => (typeof c === "string" || !c ? [] : c.filter((r) => r.t === "note").map((r) => norm(r.v)));

function variantOf(block: Block, prayer: Prayer) {
  const v = prayer.variants[0]!;
  return block.translations.find((t) => t.lang === v.lang && t.variant === v.variant);
}
function textOf(block: Block, prayer: Prayer): string {
  const t = variantOf(block, prayer);
  if (!t) return "";
  return "lines" in t && t.lines ? (t.lines as Inline[]).map(plain).join(" ") : plain(t.text as Inline);
}
function notesOf(block: Block, prayer: Prayer): string[] {
  const t = variantOf(block, prayer);
  if (!t) return [];
  return "lines" in t && t.lines ? (t.lines as Inline[]).flatMap(notes) : notes(t.text as Inline);
}

it("first draft on the test set", async () => {
  const only = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
  const dir = join(TESTSET, "expected");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).filter((f) => !only || only.includes(f.replace(/\.json$/, ""))).sort();
  const rows: string[] = [];
  const details: string[] = [];
  /** Model kind decisions by confidence: [right, all] per 0.1 bucket (calibration for UNCERTAIN_BELOW). */
  const buckets = new Map<number, [number, number]>();
  const total = { blocks: 0, found: 0, merged: 0, level: 0, kind: 0, speakers: 0, speakerHits: 0, notes: 0, noteHits: 0, noise: 0, titles: 0, titleHits: 0, ms: 0 };

  await withModel(async (runtime) => {
    for (const file of files) {
      const id = file.replace(/\.json$/, "");
      const expected = JSON.parse(readFileSync(join(dir, file), "utf8")) as Prayer;
      const source = await readSourceFile(id);
      if (!source || !Array.isArray(expected.structure)) continue;
      const v = expected.variants[0]!;
      let draft: ImportDraft = createImportDraft({
        sources: [source],
        variant: { lang: v.lang, variant: v.variant, title: suggestTitle(source) ?? "" },
      });
      const started = Date.now();
      await runFirstDraft({
        draft,
        runtime,
        current: () => draft,
        apply: (step) => {
          const r = applyImportOps(draft, step.ops, step.origin);
          if (r.ok) draft = r.draft;
        },
        signal: new AbortController().signal,
      });
      const ms = Date.now() - started;
      const got = importDraftToPrayer(draft);
      // Who decided each block's kind, by its text.
      const originByText = new Map(
        draft.blocks.map((b) => [norm(importDraftToPrayer({ ...draft, blocks: [b] }).structure[0] ? textOf(importDraftToPrayer({ ...draft, blocks: [b] }).structure[0]!, got) : ""), b.origin.kind]),
      );
      const byText = new Map(got.structure.map((b) => [norm(textOf(b, got)), b]));
      const wanted = expected.structure.filter((b) => textOf(b, expected));
      const wantedTexts = new Set(wanted.map((b) => norm(textOf(b, expected))));
      const r = { blocks: wanted.length, found: 0, merged: 0, kind: 0, level: 0, speakers: 0, speakerHits: 0, notes: 0, noteHits: 0, noise: 0 };
      const misses: string[] = [];
      for (const block of wanted) {
        const text = textOf(block, expected);
        // Exact block, else the block that holds this text together with
        // neighbours (blocks cut differently: counted as merged).
        let match = byText.get(norm(text));
        if (!match && norm(text).length >= 12) {
          match = got.structure.find((b) => norm(textOf(b, got)).includes(norm(text)));
          if (match) r.merged += 1;
        }
        const exNotes = notesOf(block, expected);
        if (block.speaker) r.speakers += 1;
        r.notes += exNotes.length;
        if (!match) {
          misses.push(`- missing [${block.kind}${block.speaker ? ` @${block.speaker}` : ""}] ${text.slice(0, 100)}`);
          continue;
        }
        r.found += 1;
        if (match.kind === block.kind) r.kind += 1;
        const o = originByText.get(norm(textOf(match, got)));
        if (o?.by === "model" && o.confidence !== undefined) {
          const k = Math.min(9, Math.floor(o.confidence * 10));
          const cell = buckets.get(k) ?? [0, 0];
          cell[1] += 1;
          if (match.kind === block.kind) cell[0] += 1;
          buckets.set(k, cell);
        }
        // Heading vs subheading is a level choice, not a wrong role.
        const role = (k: string) => (k === "subheading" ? "heading" : k);
        if (role(match.kind) === role(block.kind)) r.level += 1;
        else misses.push(`- kind ${match.kind} ≠ ${block.kind}: ${text.slice(0, 90)}`);
        if (block.speaker) {
          if (match.speaker === block.speaker) r.speakerHits += 1;
          else misses.push(`- speaker ${match.speaker ?? "none"} ≠ ${block.speaker}: ${text.slice(0, 90)}`);
        } else if (match.speaker) misses.push(`- extra speaker ${match.speaker}: ${text.slice(0, 90)}`);
        const gotNotes = notesOf(match, got);
        for (const n of exNotes) {
          if (gotNotes.includes(n)) r.noteHits += 1;
          else misses.push(`- inline annotation not marked: “${n}” in ${text.slice(0, 70)}`);
        }
      }
      // Noise: blocks left in that the expected prayer does not have, up to
      // the last expected block found (a cut test file covers only the start).
      // Only distinctive texts set the window ("Amen." comes back everywhere).
      const lastHit = got.structure.reduce((at, b, i) => {
        const t = norm(textOf(b, got));
        return t.length > 30 && wantedTexts.has(t) ? i : at;
      }, -1);
      const noise: string[] = [];
      got.structure.forEach((b, i) => {
        const t = norm(textOf(b, got));
        const known = wantedTexts.has(t) || [...wantedTexts].some((w) => w.length >= 12 && t.includes(w));
        if (i <= lastHit && !known) noise.push(textOf(b, got));
      });
      // A cut test file covers only the start of the page: noise is not measurable there.
      const cut = existsSync(join(TESTSET, "sources", `${id}.full.txt`));
      r.noise = cut ? 0 : noise.length;
      if (!cut) for (const n of noise.slice(0, 8)) misses.push(`- noise [${"?"}] ${n.slice(0, 90)}`);
      // Same title up to case, punctuation and a footnote mark, or one holding the other.
      const sq = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\[\d+\]/g, "").replace(/[^\p{L}\d]+/gu, "");
      const a = sq(draft.variants[0]!.title), b = sq(v.title ?? "");
      const titleOk = a.length > 0 && (a === b || (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a))));
      const pct = (a: number, b: number) => (b === 0 ? "–" : `${Math.round((a / b) * 100)}%`);
      rows.push(
        `| ${id} | ${r.blocks} | ${pct(r.found, r.blocks)} | ${pct(r.merged, r.found)} | ${pct(r.kind, r.found)} | ${pct(r.speakerHits, r.speakers)} | ${pct(r.noteHits, r.notes)} | ${cut ? "–" : r.noise} | ${titleOk ? "✓" : `✗ “${draft.variants[0]!.title}”`} | ${(ms / 1000).toFixed(0)}s |`,
      );
      details.push(`### ${id}\n\nExpected title: ${v.title}\n\n${misses.slice(0, 25).join("\n") || "- all good"}\n\n<details><summary>Draft</summary>\n\n\`\`\`\n${dumpDraft(draft)}\n\`\`\`\n</details>\n`);
      for (const k of Object.keys(r) as Array<keyof typeof r>) total[k] += r[k];
      total.titles += 1;
      if (titleOk) total.titleHits += 1;
      total.ms += ms;
      console.log(rows.at(-1));
    }
  });
  const pct = (a: number, b: number) => (b === 0 ? "–" : `${Math.round((a / b) * 100)}%`);
  const summary = `Total ${total.blocks} blocks · found ${pct(total.found, total.blocks)} (merged ${pct(total.merged, total.found)}) · kind ${pct(total.kind, total.found)} (role ${pct(total.level, total.found)}) · speaker ${pct(total.speakerHits, total.speakers)} · inline annotations ${pct(total.noteHits, total.notes)} · noise ${total.noise} · title ${pct(total.titleHits, total.titles)} · ${(total.ms / 1000).toFixed(0)}s`;
  const calibration = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, [ok, n]]) => `| ${(k / 10).toFixed(1)}–${((k + 1) / 10).toFixed(1)} | ${n} | ${pct(ok, n)} |`)
    .join("\n");
  console.log(`\nCalibration (model kind decisions)\n${calibration}`);
  const report = `# First draft ${stamp()}\n\nSource mode: ${process.env.SOURCE ?? "raw"}\n\n${summary}\n\n## Calibration (model kind decisions)\n\n| confidence | decisions | right |\n|---|---|---|\n${calibration}\n\n| prayer | blocks | found | merged | kind | speaker | inline | noise | title | time |\n|---|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n\n${details.join("\n")}`;
  console.log(`\n${summary}\n${writeReport(`import-${stamp()}.md`, report)}`);
  if (existsSync(join(TESTSET, "reports"))) return;
});
