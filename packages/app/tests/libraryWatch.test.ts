import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLibraryWatcher,
  watchedJsonPath,
} from "../electron/libraryWatch";

describe("watchedJsonPath", () => {
  it("keeps json files and drops ignored folders", () => {
    expect(watchedJsonPath("a.json")).toBe("a.json");
    expect(watchedJsonPath("sub/b.json")).toBe("sub/b.json");
    expect(watchedJsonPath("a.txt")).toBeNull();
    expect(watchedJsonPath("node_modules/x.json")).toBeNull();
    expect(watchedJsonPath(".git/x.json")).toBeNull();
    expect(watchedJsonPath(null)).toBeNull();
  });
});

describe("createLibraryWatcher", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  async function writeUntilSeen(path: string, name: string, seen: string[][]) {
    const deadline = Date.now() + 10_000;
    for (let i = 0; !seen.flat().includes(name); i++) {
      if (Date.now() > deadline) throw new Error("The watch never reported a write");
      writeFileSync(path, `${i}\n`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  it("reports external writes and skips the app's own", { timeout: 25_000 }, async () => {
    dir = mkdtempSync(join(tmpdir(), "opt-watch-"));
    const seen: string[][] = [];
    const watcher = createLibraryWatcher((_root, paths) => seen.push(paths), 50);
    watcher.start(dir);
    try {
      // A watch goes live some time after start() (FSEvents, later under load)
      // and misses what came before: write until it reports, then begin.
      await writeUntilSeen(join(dir, "ready.json"), "ready.json", seen);

      watcher.noteWrite(dir, "own.json", "{}\n");
      writeFileSync(join(dir, "own.json"), "{}\n");
      writeFileSync(join(dir, "other.json"), "{}\n");
      writeFileSync(join(dir, "note.txt"), "x");
      const deadline = Date.now() + 10_000;
      while (!seen.flat().includes("other.json") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      // A little longer, so a wrongly reported own write would arrive too.
      await new Promise((r) => setTimeout(r, 200));
    } finally {
      watcher.stop();
    }
    expect(seen.flat()).toContain("other.json");
    expect(seen.flat()).not.toContain("own.json");
    expect(seen.flat()).not.toContain("note.txt");
  });
});
