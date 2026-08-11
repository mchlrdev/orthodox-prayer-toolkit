/**
 * Make macOS Dock / menu show our app name instead of "Electron" in dev.
 *
 * 1. Renames Electron.app → "<App Name>.app" (Dock reads the bundle name)
 * 2. Updates electron/path.txt so the npm launcher still finds the binary
 * 3. Patches CFBundleName / CFBundleDisplayName in Info.plist
 *
 * Safe to re-run; no-ops if Electron isn't installed yet.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const APP_NAME = "Orthodox Prayer Toolkit";
const BUNDLE_NAME = `${APP_NAME}.app`;

function findElectronRoot() {
  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve("electron/package.json"));
  } catch {
    return null;
  }
}

function setPlistString(xml, key, value) {
  const re = new RegExp(
    `(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`,
    "m",
  );
  if (!re.test(xml)) {
    throw new Error(`Key ${key} not found in Info.plist`);
  }
  return xml.replace(re, `$1${value}$3`);
}

const electronRoot = findElectronRoot();
if (!electronRoot) {
  console.warn("[fix-electron-name] electron package not found; skip");
  process.exit(0);
}

const distDir = join(electronRoot, "dist");
const stockApp = join(distDir, "Electron.app");
const namedApp = join(distDir, BUNDLE_NAME);
const pathTxt = join(electronRoot, "path.txt");

if (!existsSync(stockApp) && !existsSync(namedApp)) {
  console.warn("[fix-electron-name] Electron.app not found in dist/; skip");
  process.exit(0);
}

// Rename stock bundle so Dock / Force Quit show our name.
if (existsSync(stockApp)) {
  if (existsSync(namedApp)) {
    // Stale named copy + fresh Electron.app (e.g. after upgrade) — prefer fresh.
    renameSync(namedApp, join(distDir, `${BUNDLE_NAME}.bak`));
  }
  renameSync(stockApp, namedApp);
  console.log(`[fix-electron-name] renamed Electron.app → ${BUNDLE_NAME}`);
}

const plistPath = join(namedApp, "Contents", "Info.plist");
if (!existsSync(plistPath)) {
  console.warn("[fix-electron-name] Info.plist missing after rename; skip");
  process.exit(0);
}

let xml = readFileSync(plistPath, "utf8");
xml = setPlistString(xml, "CFBundleName", APP_NAME);
xml = setPlistString(xml, "CFBundleDisplayName", APP_NAME);
writeFileSync(plistPath, xml);

const expectedPath = `${BUNDLE_NAME}/Contents/MacOS/Electron`;
const currentPath = existsSync(pathTxt)
  ? readFileSync(pathTxt, "utf8").trim()
  : "";
if (currentPath !== expectedPath) {
  writeFileSync(pathTxt, expectedPath);
  console.log(`[fix-electron-name] path.txt → ${expectedPath}`);
}

console.log(`[fix-electron-name] ready as "${APP_NAME}"`);
console.log(
  "[fix-electron-name] Quit the running app fully, then restart pnpm dev:electron",
);
