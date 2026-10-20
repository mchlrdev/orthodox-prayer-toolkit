#!/usr/bin/env node
/**
 * One-shot release: SemVer bump → commit → tag → push (CI + Release Actions).
 *
 * Usage: pnpm release
 *        pnpm release -- patch
 *        pnpm release -- minor
 *        pnpm release -- major
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const notesPath = resolve(root, "packages/app/src/releaseNotes.ts");
const packagePath = resolve(root, "package.json");

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
}

function readPackageVersion() {
  return JSON.parse(readFileSync(packagePath, "utf8")).version;
}

function parseXyz(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a, b) {
  const pa = parseXyz(a);
  const pb = parseXyz(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function isOnePatchAhead(newer, base) {
  const a = parseXyz(newer);
  const b = parseXyz(base);
  if (!a || !b) return false;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] + 1;
}

function parseReleaseNotes(src) {
  const block = src.match(
    /export const RELEASE_NOTES[^=]*=\s*\[([\s\S]*?)\n\];/,
  );
  if (!block) return null;
  const body = block[1];
  const entries = [];
  const objRe =
    /\{\s*version:\s*"([^"]+)"\s*,\s*items:\s*\[([\s\S]*?)\]\s*,?\s*\}/g;
  let match;
  while ((match = objRe.exec(body))) {
    const items = [...match[2].matchAll(/"((?:\\.|[^"\\])*)"/g)].map(
      (m) => m[1],
    );
    entries.push({ version: match[1], items });
  }
  if (entries.length === 0) return null;
  return entries;
}

function assertUniqueVersions(notes) {
  const versions = notes.map((n) => n.version);
  const seen = new Set();
  for (const version of versions) {
    if (seen.has(version)) {
      console.error(`RELEASE_NOTES has duplicate version ${version}.`);
      process.exit(1);
    }
    seen.add(version);
  }
}

function assertNotesMatchCurrentVersion() {
  const src = readFileSync(notesPath, "utf8");
  const notes = parseReleaseNotes(src);
  if (!notes) {
    console.error(`Could not parse RELEASE_NOTES in ${notesPath}.`);
    process.exit(1);
  }
  assertUniqueVersions(notes);
  const pkgVersion = readPackageVersion();
  const newest = notes[0].version;
  if (newest === pkgVersion || isOnePatchAhead(newest, pkgVersion)) return;
  const cmp = compareSemver(newest, pkgVersion);
  if (cmp !== null && cmp < 0) {
    console.error(
      `Newest RELEASE_NOTES version (${newest}) is behind the package version (${pkgVersion}).`,
    );
  } else {
    console.error(
      `Newest RELEASE_NOTES version (${newest}) must equal the package version (${pkgVersion}) or be ahead by one patch.`,
    );
  }
  console.error("Update packages/app/src/releaseNotes.ts before releasing.");
  process.exit(1);
}

function syncNotesVersion() {
  const pkgVersion = readPackageVersion();
  const src = readFileSync(notesPath, "utf8");
  const notes = parseReleaseNotes(src);
  if (!notes) {
    console.error(`Could not parse RELEASE_NOTES in ${notesPath}.`);
    process.exit(1);
  }
  assertUniqueVersions(notes);
  const newest = notes[0];
  if (newest.version === pkgVersion) return;
  if (notes.some((n) => n.version === pkgVersion)) {
    console.error(
      `RELEASE_NOTES already has ${pkgVersion} but it is not the newest entry.`,
    );
    process.exit(1);
  }
  const next = src.replace(
    /(export const RELEASE_NOTES[^=]*=\s*\[)/,
    `$1\n  {\n    version: "${pkgVersion}",\n    items: [],\n  },`,
  );
  if (next === src) {
    console.error(
      `Could not prepend RELEASE_NOTES entry for ${pkgVersion} in ${notesPath}.`,
    );
    process.exit(1);
  }
  writeFileSync(notesPath, next);
  execSync(`git add -- "${notesPath}"`);
}

if (process.argv[2] === "--sync-notes") {
  syncNotesVersion();
  process.exit(0);
}

const branch = git("branch --show-current");
if (branch !== "main" && branch !== "master") {
  console.error(
    `Release only from main/master (currently on "${branch}"). Switch branch and try again.`,
  );
  process.exit(1);
}

const status = git("status --porcelain");
if (status) {
  console.error(
    "Working tree is not clean. Commit or stash your changes before releasing.",
  );
  console.error(status);
  process.exit(1);
}

assertNotesMatchCurrentVersion();

// bumpp without --all runs `git commit <bumped package.json files>`; a pathspec
// commit ignores everything else in the index, so the notes file staged by
// --execute never reached the tag (v0.3.3). --all → `git commit --all`, which
// takes every tracked change; safe because the tree was clean above.
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "bumpp",
    "-r",
    "--all",
    "--commit",
    "chore: release v%s",
    "--tag",
    "v%s",
    "--push",
    "--execute",
    "node ./scripts/release.mjs --sync-notes",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
