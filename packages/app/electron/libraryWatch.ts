import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { sep } from "node:path";
import { resolveUnderRoot } from "../nodeFs";

const IGNORED_DIRS = new Set(["node_modules", ".git"]);

/** Relative posix path of a watched `.json` file, or null to ignore it. */
export function watchedJsonPath(filename: string | null): string | null {
  if (!filename) return null;
  const rel = filename.split(sep).join("/");
  if (!rel.endsWith(".json")) return null;
  if (rel.split("/").some((part) => IGNORED_DIRS.has(part))) return null;
  return rel;
}

export type LibraryWatcher = {
  start: (root: string) => void;
  stop: () => void;
  /** Remember text this app wrote (null = deleted) so its echo is ignored. */
  noteWrite: (root: string, relativePath: string, content: string | null) => void;
};

/**
 * Recursive watch on one library folder. Batches events, drops the echo of
 * the app's own writes, and reports changed relative `.json` paths.
 */
export function createLibraryWatcher(
  onChange: (root: string, paths: string[]) => void,
  debounceMs = 250,
): LibraryWatcher {
  let watcher: FSWatcher | null = null;
  let root: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = new Set<string>();
  const ownWrites = new Map<string, string | null>();

  const readCurrent = (rel: string): string | null => {
    if (!root) return null;
    try {
      const full = resolveUnderRoot(root, rel);
      return existsSync(full) ? readFileSync(full, "utf8") : null;
    } catch {
      return null;
    }
  };

  const flush = () => {
    timer = null;
    if (!root) return;
    const changed: string[] = [];
    for (const rel of pending) {
      if (ownWrites.has(rel)) {
        if (ownWrites.get(rel) === readCurrent(rel)) continue;
        ownWrites.delete(rel);
      }
      changed.push(rel);
    }
    pending.clear();
    if (changed.length > 0) onChange(root, changed.sort());
  };

  const stop = () => {
    watcher?.close();
    watcher = null;
    root = null;
    pending.clear();
    ownWrites.clear();
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    start(nextRoot) {
      if (root === nextRoot && watcher) return;
      stop();
      try {
        watcher = watch(nextRoot, { recursive: true }, (_event, filename) => {
          const rel = watchedJsonPath(
            typeof filename === "string" ? filename : null,
          );
          if (!rel) return;
          pending.add(rel);
          if (timer) clearTimeout(timer);
          timer = setTimeout(flush, debounceMs);
        });
        watcher.on("error", (err) => {
          console.error("[libraryWatch]", err);
          stop();
        });
        root = nextRoot;
      } catch (err) {
        console.error("[libraryWatch] cannot watch", nextRoot, err);
        stop();
      }
    },
    stop,
    noteWrite(writeRoot, relativePath, content) {
      if (writeRoot !== root) return;
      ownWrites.set(relativePath.split(sep).join("/"), content);
    },
  };
}
