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

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
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
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
