import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFileExclusive,
  isUnderRoot,
  resolveUnderRoot,
  walkJsonFiles,
  writeFileAtomic,
} from "../nodeFs";

function makeLibrary(): string {
  const root = mkdtempSync(join(tmpdir(), "ptk-lib-"));
  writeFileSync(join(root, "a.json"), "{}");
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "b.json"), "{}");
  return root;
}

describe("resolveUnderRoot", () => {
  it("resolves a relative file inside the library", () => {
    const root = makeLibrary();
    expect(resolveUnderRoot(root, "a.json")).toBe(join(root, "a.json"));
    expect(resolveUnderRoot(root, "nested/b.json")).toBe(
      join(root, "nested", "b.json"),
    );
  });

  it("rejects parent-directory escapes", () => {
    const root = makeLibrary();
    expect(() => resolveUnderRoot(root, "../secret.json")).toThrow(
      /escapes library root/,
    );
    expect(() => resolveUnderRoot(root, "nested/../../secret.json")).toThrow(
      /escapes library root/,
    );
  });

  it("rejects null bytes", () => {
    const root = makeLibrary();
    expect(() => resolveUnderRoot(root, "a\0.json")).toThrow(/Invalid path/);
  });

  it("allows writing a new file under an existing subfolder", () => {
    const root = makeLibrary();
    expect(resolveUnderRoot(root, "nested/new.json")).toBe(
      join(root, "nested", "new.json"),
    );
  });

  it("rejects symlink that jumps outside the library", () => {
    const root = makeLibrary();
    const outside = mkdtempSync(join(tmpdir(), "ptk-out-"));
    writeFileSync(join(outside, "secret.json"), "nope");
    symlinkSync(outside, join(root, "link"));
    expect(() => resolveUnderRoot(root, "link/secret.json")).toThrow(
      /escapes library root/,
    );
  });
});

describe("isUnderRoot", () => {
  it("accepts the root itself and nested paths", () => {
    const root = makeLibrary();
    expect(isUnderRoot(root, root)).toBe(true);
    expect(isUnderRoot(root, join(root, "a.json"))).toBe(true);
  });

  it("rejects siblings outside the root", () => {
    const root = makeLibrary();
    expect(isUnderRoot(root, join(root, "..", "other"))).toBe(false);
  });
});

describe("walkJsonFiles", () => {
  it("lists json files as posix relative paths", () => {
    const root = makeLibrary();
    const out: string[] = [];
    walkJsonFiles(root, root, out);
    expect(out.sort()).toEqual(["a.json", "nested/b.json"]);
  });
});

describe("writeFileAtomic / createFileExclusive", () => {
  it("replaces a file and leaves no temp files behind", () => {
    const root = makeLibrary();
    writeFileAtomic(join(root, "a.json"), '{"v":2}');
    expect(readFileSync(join(root, "a.json"), "utf8")).toBe('{"v":2}');
    writeFileAtomic(join(root, "new", "c.json"), "{}");
    expect(readFileSync(join(root, "new", "c.json"), "utf8")).toBe("{}");
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("creates a new file but never overwrites an existing one", () => {
    const root = makeLibrary();
    expect(createFileExclusive(join(root, "c.json"), '{"c":1}')).toBe(true);
    expect(readFileSync(join(root, "c.json"), "utf8")).toBe('{"c":1}');
    expect(createFileExclusive(join(root, "a.json"), '{"x":1}')).toBe(false);
    expect(readFileSync(join(root, "a.json"), "utf8")).toBe("{}");
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});
