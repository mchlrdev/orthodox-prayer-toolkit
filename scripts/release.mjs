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

function parseReleaseNotes(src) {
  const block = src.match(
    /export const RELEASE_NOTES[^=]*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!block) return null;
  const body = block[1];
  const version = body.match(/version:\s*"([^"]+)"/)?.[1];
  const itemsBody = body.match(/items:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const items = [...itemsBody.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(
    (m) => m[1],
  );
  if (!version) return null;
  return { version, items };
}

function assertNotesMatchCurrentVersion() {
  const src = readFileSync(notesPath, "utf8");
  const notes = parseReleaseNotes(src);
  if (!notes) {
    console.error(`Could not parse RELEASE_NOTES in ${notesPath}.`);
    process.exit(1);
  }
  const pkgVersion = readPackageVersion();
  if (notes.items.length > 0 && notes.version !== pkgVersion) {
    console.error(
      `RELEASE_NOTES.version (${notes.version}) must equal the current package version (${pkgVersion}) when items is non-empty.`,
    );
    console.error(
      "Update packages/app/src/releaseNotes.ts before releasing.",
    );
    process.exit(1);
  }
}

function syncNotesVersion() {
  const pkgVersion = readPackageVersion();
  const src = readFileSync(notesPath, "utf8");
  const next = src.replace(
    /(export const RELEASE_NOTES[^=]*=\s*\{[\s\S]*?\bversion:\s*")[^"]+(")/,
    `$1${pkgVersion}$2`,
  );
  if (next === src) {
    const notes = parseReleaseNotes(src);
    if (notes?.version === pkgVersion) return;
    console.error(
      `Could not set RELEASE_NOTES.version to ${pkgVersion} in ${notesPath}.`,
    );
    process.exit(1);
  }
  writeFileSync(notesPath, next);
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

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "bumpp",
    "-r",
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
