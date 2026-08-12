/**
 * macOS afterSign hook for electron-builder.
 *
 * 1) No Developer ID (OSS / no CSC_LINK): apply free ad-hoc signature (`codesign -s -`).
 *    Apple Silicon treats fully unsigned apps as "damaged" with no Privacy & Security
 *    bypass. Ad-hoc signing restores the usual "unidentified developer" → Allow flow.
 *
 * 2) Developer ID + App Store Connect API secrets: notarize (optional paid path).
 */
const { existsSync, writeFileSync, unlinkSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { execFileSync } = require("node:child_process");

function appPathFromContext(context) {
  const appName = context.packager.appInfo.productFilename;
  return join(context.appOutDir, `${appName}.app`);
}

function adHocSign(appPath, entitlementsPath) {
  const args = ["--force", "--deep", "--sign", "-"];
  if (entitlementsPath && existsSync(entitlementsPath)) {
    args.push("--entitlements", entitlementsPath);
  }
  // Hardened Runtime helps Electron helpers; works with ad-hoc + entitlements.
  args.push("--options", "runtime");
  args.push(appPath);
  console.log(`[afterSign] Ad-hoc codesign: codesign ${args.join(" ")}`);
  execFileSync("codesign", args, { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "inherit",
  });
  console.log("[afterSign] Ad-hoc signature OK.");
}

async function notarizeIfConfigured(appPath) {
  const keyId = process.env.APPLE_API_KEY_ID;
  const issuer = process.env.APPLE_API_ISSUER;
  const keyInline = process.env.APPLE_API_KEY;
  const keyPathEnv = process.env.APPLE_API_KEY_PATH;

  if (!keyId || !issuer || (!keyInline && !keyPathEnv)) {
    console.log(
      "[afterSign] Notarize skipped — no APPLE_API_* secrets (optional paid path).",
    );
    return;
  }

  if (!process.env.CSC_LINK) {
    console.log(
      "[afterSign] Notarize skipped — needs Developer ID (CSC_LINK), not ad-hoc.",
    );
    return;
  }

  let notarize;
  try {
    ({ notarize } = require("@electron/notarize"));
  } catch {
    console.warn("[afterSign] @electron/notarize missing; skip notarize.");
    return;
  }

  let tempKeyPath = null;
  try {
    let apiKeyPath = keyPathEnv;
    if (!apiKeyPath && keyInline) {
      tempKeyPath = join(tmpdir(), `AuthKey_${keyId}.p8`);
      writeFileSync(tempKeyPath, keyInline, "utf8");
      apiKeyPath = tempKeyPath;
    }
    if (!apiKeyPath || !existsSync(apiKeyPath)) {
      throw new Error("Apple API key file not found");
    }

    console.log(`[afterSign] Notarizing ${appPath}…`);
    await notarize({
      appPath,
      appleApiKey: apiKeyPath,
      appleApiKeyId: keyId,
      appleApiIssuer: issuer,
    });
    console.log("[afterSign] Notarize done.");
  } finally {
    if (tempKeyPath && existsSync(tempKeyPath)) {
      unlinkSync(tempKeyPath);
    }
  }
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = appPathFromContext(context);
  const entitlements = join(
    context.packager.projectDir,
    "build",
    "entitlements.mac.plist",
  );

  // Real cert via CSC_LINK: electron-builder already signed. Optionally notarize.
  if (process.env.CSC_LINK) {
    await notarizeIfConfigured(appPath);
    return;
  }

  // OSS path: free ad-hoc signature so Gatekeeper shows "Allow" instead of "damaged".
  adHocSign(appPath, entitlements);
};
