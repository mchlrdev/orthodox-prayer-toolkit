/**
 * Ensure the Electron macOS .app bundle is complete after npm/pnpm install.
 *
 * electron's install.js uses extract-zip, which on some Node versions (e.g. 26)
 * silently extracts only MacOS/ + Resources/ and skips Frameworks/ + Info.plist.
 * isInstalled() still passes because the stub binary exists → broken app / ENOENT.
 *
 * On darwin we re-extract the cached zip with ditto when the bundle looks incomplete.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { arch, homedir, platform } from "node:os";
import { dirname, join } from "node:path";

function findElectronRoot() {
  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve("electron/package.json"));
  } catch {
    return null;
  }
}

function isCompleteBundle(appDir) {
  return (
    existsSync(join(appDir, "Contents", "Info.plist")) &&
    existsSync(join(appDir, "Contents", "Frameworks")) &&
    existsSync(join(appDir, "Contents", "MacOS", "Electron"))
  );
}

function darwinArch(cpuArch) {
  return cpuArch === "arm64" ? "arm64" : "x64";
}

function findCachedZip(version, cpuArch) {
  const cacheRoot = join(homedir(), "Library", "Caches", "electron");
  if (!existsSync(cacheRoot)) return null;
  const name = `electron-v${version}-darwin-${darwinArch(cpuArch)}.zip`;
  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(cacheRoot, entry.name, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const electronRoot = findElectronRoot();
if (!electronRoot) {
  console.warn("[ensure-electron] electron package not found; skip");
  process.exit(0);
}

const distDir = join(electronRoot, "dist");
const stockApp = join(distDir, "Electron.app");
const { version } = JSON.parse(
  readFileSync(join(electronRoot, "package.json"), "utf8"),
);

const namedApps = existsSync(distDir)
  ? readdirSync(distDir).filter((n) => n.endsWith(".app"))
  : [];
const existingApp =
  (existsSync(stockApp) ? stockApp : null) ||
  (namedApps[0] ? join(distDir, namedApps[0]) : null);

if (existingApp && isCompleteBundle(existingApp)) {
  process.exit(0);
}

if (platform() !== "darwin") {
  if (existingApp && !isCompleteBundle(existingApp)) {
    console.warn(
      "[ensure-electron] Electron dist looks incomplete; reinstall the electron package",
    );
  }
  process.exit(0);
}

console.warn(
  "[ensure-electron] Electron.app incomplete or missing; re-extracting with ditto…",
);

// Ensure the zip is in the electron cache (install.js download may succeed even
// when extract-zip leaves a partial tree).
try {
  execFileSync(process.execPath, [join(electronRoot, "install.js")], {
    cwd: electronRoot,
    stdio: "inherit",
  });
} catch {
  // Partial extract still leaves a cache zip we can ditto.
}

const zip = findCachedZip(version, arch());
if (!zip) {
  console.error(
    `[ensure-electron] No cached electron-v${version}-darwin-*.zip under ~/Library/Caches/electron`,
  );
  console.error(
    "[ensure-electron] Try: rm -rf ~/Library/Caches/electron && pnpm install",
  );
  process.exit(1);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
execFileSync("ditto", ["-x", "-k", zip, distDir], { stdio: "inherit" });

if (!isCompleteBundle(stockApp)) {
  console.error("[ensure-electron] ditto extract still incomplete; abort");
  process.exit(1);
}

writeFileSync(
  join(electronRoot, "path.txt"),
  "Electron.app/Contents/MacOS/Electron",
);
writeFileSync(join(distDir, "version"), version);
console.log(`[ensure-electron] restored Electron ${version} via ditto`);
