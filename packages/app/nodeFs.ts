/**
 * Shared Node filesystem helpers for Electron main and the Vite browser-dev
 * filesystem bridge. Keeps library path confinement in one module.
 */
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

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

function tempPathFor(full: string): string {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return join(dirname(full), `.${basename(full)}.${nonce}.tmp`);
}

/**
 * Write via a temp file in the same folder + rename, so a crash or a full
 * disk never leaves a half-written file in place of the old one.
 */
export function writeFileAtomic(full: string, content: string): void {
  mkdirSync(dirname(full), { recursive: true });
  const tmp = tempPathFor(full);
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, full);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Create `full` only if nothing exists there yet (never overwrites, also
 * when a file appears between an exists check and the write). Returns false
 * when the target already exists.
 */
export function createFileExclusive(full: string, content: string): boolean {
  mkdirSync(dirname(full), { recursive: true });
  const tmp = tempPathFor(full);
  writeFileSync(tmp, content, "utf8");
  try {
    // link() fails with EEXIST atomically and never exposes a partial file.
    linkSync(tmp, full);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    if (code !== "EPERM" && code !== "ENOTSUP" && code !== "EXDEV") throw err;
    // Filesystems without hard links (exFAT, some network shares).
    try {
      writeFileSync(full, content, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (fallbackErr) {
      if ((fallbackErr as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw fallbackErr;
    }
  } finally {
    rmSync(tmp, { force: true });
  }
}
