import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isUnderRoot, resolveUnderRoot, walkJsonFiles } from "../nodeFs";

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
