#!/usr/bin/env node
/**
 * Rename installer files so GitHub Releases match electron-updater.
 *
 * electron-builder writes latest*.yml URLs with spaces replaced by hyphens
 * (GitHubProvider.resolveFiles). Uploading names that still contain spaces
 * makes GitHub turn those spaces into dots (Orthodox.Prayer.Toolkit-…),
 * and the updater 404s looking for Orthodox-Prayer-Toolkit-….
 */
import { readdirSync, renameSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Same rule as electron-updater GitHubProvider.resolveFiles. */
export function githubUpdaterAssetName(fileName) {
  return fileName.replace(/ /g, "-");
}

export function sanitizeReleaseDir(dir) {
  const renamed = [];
  const seen = new Set();
  for (const name of readdirSync(dir)) {
    const next = githubUpdaterAssetName(name);
    if (next === name) continue;
    if (seen.has(next)) {
      throw new Error(`Refusing to rename both to the same target: ${next}`);
    }
    seen.add(next);
    renameSync(join(dir, name), join(dir, next));
    renamed.push({ from: name, to: next });
  }
  return renamed;
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) {
  const dir = process.argv[2];
  if (!dir) {
    console.error(`Usage: ${basename(process.argv[1])} <dir>`);
    process.exit(1);
  }
  const renamed = sanitizeReleaseDir(dir);
  if (renamed.length === 0) {
    console.log(`No spaced artifact names in ${dir}`);
  }
  for (const { from, to } of renamed) {
    console.log(`Renamed: ${from} → ${to}`);
  }
}
