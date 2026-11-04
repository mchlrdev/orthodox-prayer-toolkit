#!/usr/bin/env node
/**
 * Writes a large bilingual (de / en) Lorem-ipsum prayer for performance audits.
 *
 *   node scripts/perf-fixture.mjs [outDir] [blockCount]
 *
 * Default: 300 blocks into packages/app/tests/fixtures/perf/lorem-300.json.
 * Deterministic (seeded), so measurements stay comparable between runs.
 * See docs/performance.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? join(root, "packages/app/tests/fixtures/perf"));
const count = Number(process.argv[3] ?? 300);

const WORDS =
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(
    " ",
  );

let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function words(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(WORDS[Math.floor(rand() * WORDS.length)]);
  const s = out.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function sentence(min, max) {
  return `${words(min + Math.floor(rand() * (max - min)))}.`;
}

const variants = [
  {
    lang: "de",
    variant: "standard",
    title: "Lorem-Gebet (300 Blöcke)",
    license: "unknown",
    source: "draft",
    speakers: {
      priest: { name: "Priester", short: "P" },
      people: { name: "Volk", short: "V" },
    },
  },
  {
    lang: "en",
    variant: "standard",
    title: "Lorem prayer (300 blocks)",
    license: "unknown",
    source: "draft",
    speakers: {
      priest: { name: "Priest", short: "P" },
      people: { name: "People", short: "R" },
    },
  },
];

function lines(n) {
  return Array.from({ length: n }, () => sentence(5, 12));
}

/** Some lines carry an inline note, like rubrics inside verses. */
function withNote(line) {
  const cut = line.indexOf(" ", Math.floor(line.length / 2));
  if (cut < 0) return line;
  return [
    { t: "text", v: line.slice(0, cut + 1) },
    { t: "note", v: "(dreimal)" },
    { t: "text", v: line.slice(cut) },
  ];
}

const structure = [];
for (let i = 0; i < count; i++) {
  const id = `b${i + 1}`;
  let kind;
  if (i % 40 === 0) kind = "heading";
  else if (i % 10 === 0) kind = "subheading";
  else if (i % 7 === 0) kind = "annotation";
  else if (i % 9 === 0) kind = "refrain";
  else kind = "verse";

  const block = { id, kind };
  if (kind === "verse" && i % 3 === 0) block.speaker = i % 2 ? "priest" : "people";
  if (kind === "refrain") block.speaker = "people";

  block.translations = variants
    .filter((v, vi) => !(vi === 1 && i % 23 === 5)) // a few untranslated cells
    .map((v) => {
      const base = { lang: v.lang, variant: v.variant };
      if (kind === "verse") {
        const ls = lines(2 + Math.floor(rand() * 4));
        if (i % 11 === 0) ls[0] = withNote(ls[0]);
        return { ...base, lines: ls };
      }
      if (kind === "heading" || kind === "subheading") return { ...base, text: words(3 + Math.floor(rand() * 4)) };
      return { ...base, text: sentence(8, 20) };
    });
  structure.push(block);
}

const prayer = {
  formatVersion: 3,
  id: `lorem-${count}`,
  type: "prayer",
  kinds: [{ id: "refrain", speaker: true }],
  variants,
  structure,
};

mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${prayer.id}.json`);
writeFileSync(file, `${JSON.stringify(prayer, null, 2)}\n`);
console.log(`wrote ${file} (${structure.length} blocks)`);
