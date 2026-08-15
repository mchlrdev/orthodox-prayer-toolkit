import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  githubUpdaterAssetName,
  sanitizeReleaseDir,
} from "../scripts/sanitize-release-artifacts.mjs";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("githubUpdaterAssetName", () => {
  it("matches the hyphenated names in latest*.yml for v0.1.6 disk filenames", () => {
    expect(
      githubUpdaterAssetName("Orthodox Prayer Toolkit-0.1.6-arm64-mac.zip"),
    ).toBe("Orthodox-Prayer-Toolkit-0.1.6-arm64-mac.zip");
    expect(
      githubUpdaterAssetName("Orthodox Prayer Toolkit Setup 0.1.6.exe"),
    ).toBe("Orthodox-Prayer-Toolkit-Setup-0.1.6.exe");
    expect(
      githubUpdaterAssetName("Orthodox Prayer Toolkit-0.1.6.AppImage"),
    ).toBe("Orthodox-Prayer-Toolkit-0.1.6.AppImage");
  });
});

describe("sanitizeReleaseDir", () => {
  it("renames spaced artifacts in place and leaves latest.yml alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "ptk-artifacts-"));
    writeFileSync(join(dir, "Orthodox Prayer Toolkit-0.1.6-arm64-mac.zip"), "");
    writeFileSync(join(dir, "latest-mac.yml"), "version: 0.1.6\n");

    expect(sanitizeReleaseDir(dir)).toEqual([
      {
        from: "Orthodox Prayer Toolkit-0.1.6-arm64-mac.zip",
        to: "Orthodox-Prayer-Toolkit-0.1.6-arm64-mac.zip",
      },
    ]);
    expect(readdirSync(dir).sort()).toEqual([
      "Orthodox-Prayer-Toolkit-0.1.6-arm64-mac.zip",
      "latest-mac.yml",
    ]);
  });
});

describe("electron-builder.yml", () => {
  it("does not put spaces or productName into installer filenames", () => {
    const yml = readFileSync(join(appRoot, "electron-builder.yml"), "utf8");
    const names = [...yml.matchAll(/artifactName:\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toMatch(/ /);
      expect(name).not.toContain("${productName}");
    }
  });
});
