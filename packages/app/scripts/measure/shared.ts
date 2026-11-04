import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { JSDOM } from "jsdom";
import {
  draftBlockContent,
  draftBlockVisible,
  readText,
  type ImportDraft,
  type Source,
} from "@orthodox-prayer-toolkit/core";
import { createDecider, type Decider } from "../../electron/modelRuntime.ts";
export type { Decider };
import type { DecisionRuntime } from "../../src/builtInModel/decisionRuntime";
import { readHtmlDocument, staticElementInfo, pageInfo, sanitizeHtml } from "../../src/importDraft/readHtml";
import { segmentIndex } from "../../src/importDraft/sourceView";
import { pdfPageText } from "../../src/importDraft/pdfText";
import { segmentPdfPages } from "../../src/importDraft/pdfLayout";
import { standInRuntime } from "../../src/builtInModel/standInModel";

/** The test set: sources/, expected/, chat/, reports/ (gitignored scratch). */
export const TESTSET = resolve(
  process.env.TESTSET ?? join(import.meta.dirname, "../../../../.scratch/ai-import/testset"),
);
export const MODEL =
  process.env.MODEL ??
  join(homedir(), "Library/Application Support/Orthodox Prayer Toolkit/models/qwen3.5-4b/1/Qwen3.5-4B-Q4_K_M.gguf");

const LOCK = join(tmpdir(), "opt-built-in-model.lock");

/**
 * One model on this computer at a time (8 GB): waits for the lock, and
 * refuses to start when the system has too little memory to spare.
 */
export async function withModel<T>(run: (runtime: DecisionRuntime) => Promise<T>): Promise<T> {
  // STANDIN=1: fixed rules instead of the model, to check files without memory use.
  if (process.env.STANDIN) return run(standInRuntime());
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, "pid"), String(process.pid));
      break;
    } catch {
      // A lock left by a dead process is taken over.
      const pid = Number(readFileSync(join(LOCK, "pid"), "utf8").trim() || 0);
      let alive = false;
      try {
        if (pid) process.kill(pid, 0);
        alive = pid > 0;
      } catch {
        alive = false;
      }
      if (!alive && Date.now() - statSync(LOCK).mtimeMs > 5000) rmSync(LOCK, { recursive: true, force: true });
      else await new Promise((r) => setTimeout(r, 3000));
    }
  }
  try {
    // Wait up to 15 minutes for 2.6 GB (the model and its context); never start below.
    const need = Number(process.env.NEED_GB ?? 2.6);
    let spare = spareMemoryGb();
    for (let i = 0; spare < need && i < 90; i++) {
      if (i % 6 === 0) console.log(`Waiting for memory: ${spare.toFixed(1)} of ${need} GB free …`);
      await new Promise((r) => setTimeout(r, 10000));
      spare = spareMemoryGb();
    }
    if (spare < need) {
      throw new Error(`Only ${spare.toFixed(1)} GB of memory to spare; the model needs about ${need} GB. Close other apps (also the Toolkit app) and try again.`);
    }
    const decider = await createDecider(MODEL, Number(process.env.CONTEXT ?? 6144));
    try {
      return await run(runtimeOf(decider));
    } finally {
      await decider.dispose();
    }
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

/** Memory macOS counts as available (memory_pressure's free percentage of RAM), in GB. */
export function spareMemoryGb(): number {
  try {
    const out = execSync("memory_pressure", { encoding: "utf8" });
    const pct = Number(/free percentage:\s*(\d+)%/.exec(out)?.[1] ?? 100);
    const total = Number(execSync("sysctl -n hw.memsize", { encoding: "utf8" }).trim());
    return (pct / 100) * (total / 1e9);
  } catch {
    return 99;
  }
}

export function runtimeOf(decider: Decider): DecisionRuntime {
  return {
    decide: (_batch, prompt, onItem, signal) => decider.decide(prompt, onItem, signal),
    generate: (request, onText, signal) => decider.generate(request, onText, signal),
  };
}

/**
 * A source as the app gets it. SOURCE=raw (default): the downloaded page
 * through the HTML reader (title from <title>), a PDF through pdf.js like
 * the app (first PDF_PAGES pages, default 12); SOURCE=txt: the copied text,
 * like pasting.
 */
export async function readSourceFile(id: string): Promise<Source | null> {
  const txt = join(TESTSET, "sources", `${id}.txt`);
  const html = join(TESTSET, "sources", `${id}.html`);
  const pdf = join(TESTSET, "sources", `${id}.pdf`);
  const mode = process.env.SOURCE ?? "raw";
  if (mode === "raw" && existsSync(html)) {
    // Decode like a browser: the page's own charset (windows-1251, ISO-8859-1 …), else UTF-8.
    const bytes = readFileSync(html);
    const head = bytes.subarray(0, 4096).toString("latin1");
    const charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
    let raw: string;
    try {
      raw = new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      raw = bytes.toString("utf8");
    }
    const doc = new JSDOM(raw).window.document;
    const page = pageInfo(doc);
    sanitizeHtml(doc);
    return readHtmlDocument(doc, staticElementInfo, { id: "s1", name: id, page });
  }
  if (mode === "raw" && existsSync(pdf)) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await getDocument({ data: new Uint8Array(readFileSync(pdf)), enableXfa: false }).promise;
    try {
      const pages = [];
      for (let n = 1; n <= Math.min(doc.numPages, Number(process.env.PDF_PAGES ?? 12)); n++) {
        const p = await doc.getPage(n);
        pages.push(await pdfPageText(p));
        p.cleanup();
      }
      return segmentPdfPages(pages, { id: "s1", name: id });
    } finally {
      await doc.destroy();
    }
  }
  if (existsSync(txt)) return readText(readFileSync(txt, "utf8"), { id: "s1", name: id });
  return null;
}

/** The draft as the user sees it: number, kind, speaker, text with ⟦inline annotations⟧. */
export function dumpDraft(draft: ImportDraft): string {
  const key = draft.variants[0]!.key;
  const segs = segmentIndex(draft);
  const lines: string[] = [];
  for (const b of draft.blocks) {
    const first = Object.values(b.content).flat().find((s) => "seg" in s);
    const n = first && "seg" in first ? segs.get(first.seg)?.n : undefined;
    if (!draftBlockVisible(draft, b)) {
      lines.push(`  ${String(n ?? "-").padStart(3)} (left out)`);
      continue;
    }
    const content = draftBlockContent(draft, b, key);
    const piece = (c: unknown): string =>
      typeof c === "string" ? c : Array.isArray(c) ? c.map((r) => (r.t === "note" ? `⟦${r.v}⟧` : r.v)).join("") : "";
    const text = !content ? "" : "lines" in content ? content.lines.map(piece).join(" / ") : piece(content.text);
    const speaker = b.speaker ? ` @${b.speaker}` : "";
    lines.push(`  ${String(n ?? "-").padStart(3)} [${b.kind}${speaker}] ${text.replace(/\s+/g, " ").slice(0, 140)}`);
  }
  const names = draft.variants.map((v) => `${v.lang}: ${JSON.stringify(v.speakers ?? {})}`).join("; ");
  return `  title: ${draft.variants[0]!.title || "(none)"}\n  speakers: ${names}\n${lines.join("\n")}`;
}

export function writeReport(name: string, text: string): string {
  const dir = join(TESTSET, "reports");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

export const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
