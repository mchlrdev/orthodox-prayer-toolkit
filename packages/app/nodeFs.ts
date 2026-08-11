/**
 * Shared Node filesystem helpers for Electron main and the Vite browser-dev
 * filesystem bridge. Keeps library path confinement in one module.
 */
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

function withTrailingSep(absolute: string): string {
  return absolute.endsWith(sep) ? absolute : absolute + sep;
}

/** Lexical + symlink-aware check: `absolutePath` must stay under `root`. */
export function isUnderRoot(root: string, absolutePath: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedPath = resolve(absolutePath);
  const rootPrefix = withTrailingSep(normalizedRoot);

  if (
    normalizedPath !== normalizedRoot &&
    !normalizedPath.startsWith(rootPrefix)
  ) {
    return false;
  }

  let realRoot = normalizedRoot;
  try {
    if (existsSync(normalizedRoot)) {
      realRoot = realpathSync(normalizedRoot);
    }
  } catch {
    /* use lexical root */
  }

  let probe = normalizedPath;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }

  let realProbe = probe;
  try {
    if (existsSync(probe)) {
      realProbe = realpathSync(probe);
    }
  } catch {
    /* use lexical probe */
  }

  const realRootPrefix = withTrailingSep(realRoot);
  return realProbe === realRoot || realProbe.startsWith(realRootPrefix);
}

/**
 * Resolve `relativePath` under `root`, rejecting escapes (`..`, absolute
 * segments, symlink jumps outside the library).
 */
export function resolveUnderRoot(root: string, relativePath: string): string {
  if (relativePath.includes("\0")) {
    throw new Error(`Invalid path: ${relativePath}`);
  }

  const normalizedRoot = resolve(root);
  const full = resolve(normalizedRoot, relativePath);

  if (!isUnderRoot(normalizedRoot, full)) {
    throw new Error(`Path escapes library root: ${relativePath}`);
  }

  return full;
}

/** Recursively list `.json` files under `root` as posix-style relative paths. */
export function walkJsonFiles(root: string, dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = joinSafe(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walkJsonFiles(root, full, out);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      out.push(relative(root, full).split(sep).join("/"));
    }
  }
}

function joinSafe(dir: string, name: string): string {
  return resolve(dir, name);
}
