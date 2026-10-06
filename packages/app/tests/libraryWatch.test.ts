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

  it("reports external writes and skips the app's own", async () => {
    dir = mkdtempSync(join(tmpdir(), "opt-watch-"));
    const seen: string[][] = [];
    const watcher = createLibraryWatcher((_root, paths) => seen.push(paths), 50);
    watcher.start(dir);
    try {
      watcher.noteWrite(dir, "own.json", "{}\n");
      writeFileSync(join(dir, "own.json"), "{}\n");
      writeFileSync(join(dir, "other.json"), "{}\n");
      writeFileSync(join(dir, "note.txt"), "x");
      await new Promise((r) => setTimeout(r, 400));
    } finally {
      watcher.stop();
    }
    expect(seen.flat()).toContain("other.json");
    expect(seen.flat()).not.toContain("own.json");
    expect(seen.flat()).not.toContain("note.txt");
  });
});
