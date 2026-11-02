/**
 * Measurement run for text recognition of scans (ticket 12):
 *
 *   pnpm --filter @orthodox-prayer-toolkit/app measure:ocr [scan-dir] [ocr-dir]
 *
 * Each image (`.jpg`, `.png`) in the folder has its expected text in
 * `<name>.txt` (paragraphs separated by a blank line) and may name its
 * languages in `<name>.langs` (default `deu`). Language packs come from the
 * app's data folder (downloaded there when missing). The script recognises
 * each image with Tesseract, builds segments like the app and prints the
 * character accuracy (1 − edit distance / expected length), the paragraphs
 * found, the share of uncertain words and the time. Ink colours are not
 * measured here (no canvas).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { createOcrService } from "../electron/ocrService.ts";
import { segmentOcrPages } from "../src/importDraft/ocrLayout.ts";

const dir = resolve(process.argv[2] ?? join(import.meta.dirname, "../tests/fixtures/scans"));
const ocrDir =
  process.argv[3] ?? join(homedir(), "Library/Application Support/Orthodox Prayer Toolkit/ocr");

/** Levenshtein distance over code points, two rows. */
function distance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length]!;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Width and height from a PNG or JPEG header. */
function imageSize(data: Buffer): { width: number; height: number } {
  if (data[0] === 0x89) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  let at = 2;
  while (at < data.length) {
    const marker = data[at + 1]!;
    const length = data.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { height: data.readUInt16BE(at + 5), width: data.readUInt16BE(at + 7) };
    at += 2 + length;
  }
  throw new Error("Unknown image size");
}

const service = createOcrService({ root: ocrDir, onStatus: () => undefined });
const images = readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
console.log(`Scans ${dir}\nPacks ${ocrDir}\n`);
console.log("scan".padEnd(28), "chars   accuracy  paragraphs  uncertain  time");
let totalChars = 0;
let totalErrors = 0;
for (const [i, file] of images.entries()) {
  const name = basename(file, extname(file));
  const truthPath = join(dir, `${name}.txt`);
  if (!existsSync(truthPath)) continue;
  const langsPath = join(dir, `${name}.langs`);
  const langs = (existsSync(langsPath) ? readFileSync(langsPath, "utf8").trim() : "deu").split("+");
  for (const code of langs) {
    if (!service.languages().find((l) => l.code === code && l.state === "installed")) await service.download(code);
  }
  const data = readFileSync(join(dir, file));
  const started = Date.now();
  const lines = await service.recognize(i + 1, new Uint8Array(data), langs, () => undefined);
  const ms = Date.now() - started;
  const source = segmentOcrPages([{ page: 1, ...imageSize(data), lines }], { name: file });
  const truth = readFileSync(truthPath, "utf8");
  const expected = truth.split(/\n\s*\n/).map(norm).filter(Boolean);
  const got = norm(source.segments.map((s) => s.text).join(" "));
  const errors = distance(got, norm(expected.join(" ")));
  const chars = [...norm(expected.join(" "))].length;
  const words = got.split(" ").length;
  const uncertain = source.segments.reduce((n, s) => n + (s.uncertain?.length ?? 0), 0);
  totalChars += chars;
  totalErrors += errors;
  console.log(
    name.padEnd(28),
    String(chars).padEnd(7),
    `${(100 * (1 - errors / chars)).toFixed(1)}%`.padEnd(9),
    `${source.segments.length}/${expected.length}`.padEnd(11),
    `${Math.round((100 * uncertain) / words)}%`.padEnd(10),
    `${(ms / 1000).toFixed(1)}s`,
  );
}
console.log(`\nTotal: ${totalChars} characters · accuracy ${(100 * (1 - totalErrors / Math.max(1, totalChars))).toFixed(1)}%`);
