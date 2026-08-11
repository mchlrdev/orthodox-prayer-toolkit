/**
 * Optional macOS notarization after electron-builder signs the app.
 * Skips when Apple API credentials are not configured (unsigned OSS builds).
 *
 * Required env (App Store Connect API key):
 *   APPLE_API_KEY       — contents of the .p8 key, OR
 *   APPLE_API_KEY_PATH  — path to the .p8 file
 *   APPLE_API_KEY_ID
 *   APPLE_API_ISSUER
 */
const { existsSync, writeFileSync, unlinkSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const keyId = process.env.APPLE_API_KEY_ID;
  const issuer = process.env.APPLE_API_ISSUER;
  const keyInline = process.env.APPLE_API_KEY;
  const keyPathEnv = process.env.APPLE_API_KEY_PATH;

  if (!keyId || !issuer || (!keyInline && !keyPathEnv)) {
    console.log(
      "[notarize] Skipping — set APPLE_API_KEY(_PATH), APPLE_API_KEY_ID, APPLE_API_ISSUER to enable.",
    );
    return;
  }

  // Only notarize when the app was actually code-signed.
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false" && !process.env.CSC_LINK) {
    console.log("[notarize] Skipping — no code signing identity configured.");
    return;
  }

  let notarize;
  try {
    ({ notarize } = require("@electron/notarize"));
  } catch {
    console.warn(
      "[notarize] @electron/notarize is not installed; skipping notarization.",
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = join(appOutDir, `${appName}.app`);

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

    console.log(`[notarize] Notarizing ${appPath}…`);
    await notarize({
      appPath,
      appleApiKey: apiKeyPath,
      appleApiKeyId: keyId,
      appleApiIssuer: issuer,
    });
    console.log("[notarize] Done.");
  } finally {
    if (tempKeyPath && existsSync(tempKeyPath)) {
      unlinkSync(tempKeyPath);
    }
  }
};
