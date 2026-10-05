// Golden cases for crates/prayer-core/src/text_runs.rs.
//
// One file per operation in crates/prayer-core/tests/golden/text_runs/.
// Offsets are UTF-16 code units (as the TypeScript core uses); the Rust test
// converts them to byte offsets. Every offset sits on a code point boundary.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  markRangeAsNote,
  packInline,
  plainText,
  replaceRangeInInline,
  splitInline,
  toggleNoteRange,
  unmarkNoteAt,
  unmarkRange,
} from "../../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "crates", "prayer-core", "tests", "golden", "text_runs");
mkdirSync(outDir, { recursive: true });

const T = (v) => ({ t: "text", v });
const N = (v) => ({ t: "note", v });

/** Short contents the offset grid runs over (plain strings and run lists). */
const contents = {
  "latin plain": "Amen (x) y",
  "cyrillic plain": "Господи, помилуй",
  "greek plain": "Κύριε ἐλέησον",
  "combining marks": "Го́споди",
  "greek combining": "έλε̈ησον",
  "astral": "a😀b 𝔄c",
  "whitespace edges": " a  b ",
  "note mid": [T("Dann "), N("vierzig"), T(":")],
  "note cyrillic": [T("Го́споди "), N("(трижды)"), T(" Амінь")],
  "two notes": [N("ab"), T(" c "), N("de")],
  "note start": [N("Kyrie"), T(" eleison")],
  "note with edge spaces": [T("A"), N(" (x) "), T("B")],
  "empty string": "",
  "empty runs": [],
};

/** All code point boundaries of the plain text, in UTF-16 units. */
function boundaries(content) {
  const out = [0];
  let at = 0;
  for (const ch of plainText(content)) {
    at += ch.length;
    out.push(at);
  }
  return out;
}

/** Every ordered pair plus a few reversed and out-of-range ones. */
function ranges(content) {
  const all = boundaries(content);
  // Long contents: keep the first few, the middle and the last boundaries.
  const b =
    all.length <= 8
      ? all
      : [...new Set([0, 1, 2, 3, all.length >> 1, all.length - 2, all.length - 1])].map(
          (i) => all[i],
        );
  const out = [];
  for (const s of b) for (const e of b) if (s <= e) out.push([s, e]);
  if (b.length > 2) {
    out.push([b[b.length - 1], b[1]]); // reversed
    out.push([b[1], 999]); // end past the content
    out.push([999, 1000]);
  }
  return out;
}

// Known TypeScript bug: normalizeRuns turns a whitespace-only note into text
// twice ("  " becomes four spaces), so edits that leave such a note behind
// invent whitespace. The Rust core keeps the text once. Cases where the
// TypeScript result does not have the plain text the edit implies are skipped.
// Returns true when `result`'s plain text equals `expectedPlain`.
function keepsPlain(result, expectedPlain) {
  return result !== null && plainText(result) === expectedPlain;
}

/** Like keepsPlain, for split results ({ before, after }). */
function sound(result, expectedPlain) {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const both = [result.before, result.after].map((c) => (c === null ? "" : plainText(c)));
    return both.join("") === expectedPlain;
  }
  return keepsPlain(result, expectedPlain);
}

function write(op, cases) {
  const file = join(outDir, `${op}.json`);
  writeFileSync(file, JSON.stringify(cases, null, 2) + "\n");
}

function rangeOp(op, fn, expectedPlain = (content) => plainText(content)) {
  const cases = [];
  for (const [name, content] of Object.entries(contents)) {
    for (const [start, end] of ranges(content)) {
      const expected = fn(content, start, end);
      if (!sound(expected, expectedPlain(content, start, end))) continue;
      cases.push({
        name: `${name} ${start}..${end}`,
        content,
        start_utf16: start,
        end_utf16: end,
        expected,
      });
    }
  }
  // Content that is already marked, so toggle/unmark have notes to act on.
  for (const name of ["latin plain", "cyrillic plain", "combining marks", "astral"]) {
    const content = contents[name];
    const marked = markRangeAsNote(content, 1, content.length - 1);
    for (const [start, end] of ranges(marked)) {
      const expected = fn(marked, start, end);
      if (!sound(expected, expectedPlain(marked, start, end))) continue;
      cases.push({
        name: `marked ${name} ${start}..${end}`,
        content: marked,
        start_utf16: start,
        end_utf16: end,
        expected,
      });
    }
  }
  write(op, cases);
}

rangeOp("mark_range_as_note", markRangeAsNote);
rangeOp("unmark_range", unmarkRange);
rangeOp("toggle_note_range", toggleNoteRange);
rangeOp("split_inline", (c, s, e) => splitInline(c, s, e), (c, s, e) => {
  const plain = plainText(c);
  const [from, to] = [Math.min(s, e, plain.length), Math.min(Math.max(s, e), plain.length)];
  return plain.slice(0, from) + plain.slice(to);
});

// replace: ranges x a few replacements (empty, Latin, Cyrillic, combining).
{
  const replacements = ["", "X", "Господь", "é"];
  const cases = [];
  for (const [name, content] of Object.entries(contents)) {
    for (const [start, end] of ranges(content)) {
      for (const replacement of replacements) {
        const expected = replaceRangeInInline(content, start, end, replacement);
        const plain = plainText(content);
        const from = Math.min(start, end, plain.length);
        const to = Math.min(Math.max(start, end), plain.length);
        if (!keepsPlain(expected, plain.slice(0, from) + replacement + plain.slice(to))) continue;
        cases.push({
          name: `${name} ${start}..${end} -> ${JSON.stringify(replacement)}`,
          content,
          start_utf16: start,
          end_utf16: end,
          replacement,
          expected,
        });
      }
    }
  }
  write("replace_range_in_inline", cases);
}

// unmark_note_at: every index, plus one past the end. (The Rust index is
// unsigned, so the TypeScript negative-index case is not a golden case.)
{
  const cases = [];
  for (const [name, content] of Object.entries(contents)) {
    const count = Array.isArray(content) ? content.length : 1;
    for (let index = 0; index <= count; index++) {
      const expected = unmarkNoteAt(content, index);
      if (!keepsPlain(expected, plainText(content))) continue;
      cases.push({
        name: `${name} #${index}`,
        content,
        run_index: index,
        expected,
      });
    }
  }
  write("unmark_note_at", cases);
}

// pack_inline: normalization edge cases, zero-width characters included.
{
  const inputs = {
    "empty": [],
    "empty values": [T(""), N("")],
    "text only": [T("Hello"), T("!")],
    "zero width only": [T("​﻿")],
    "zero width inside": [T("A​b"), N("‍(x)‌")],
    "note peeled": [T("Amen"), N(" (zwölfmal) "), T(".")],
    // "whitespace-only note" is left out: see the known bug above.
    "adjacent merge": [T("a"), T("b"), N(""), N("(NN)")],
    "coalesce notes": [N("(NN)"), T(" "), N("(zwölfmal)")],
    "coalesce three": [N("a"), T(" "), N("b"), T("\t"), N("c")],
    "no coalesce on text gap": [N("a"), T(" x "), N("b")],
    "note then space": [N("(x)"), T(" ")],
    "cyrillic": [T("Го́споди "), N(" (трижды) "), T("Амінь")],
    "nbsp and ideographic space": [T("a"), N(" b　"), T("c")],
  };
  write(
    "pack_inline",
    Object.entries(inputs).map(([name, runs]) => ({
      name,
      runs,
      expected: packInline(runs),
    })),
  );
}
