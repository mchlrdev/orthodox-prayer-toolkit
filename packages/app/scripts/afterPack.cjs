/**
 * electron-builder afterPack hook: the Built-in model's native runtime.
 *
 * Fails the build when the packages for the target are missing (a runner only
 * installs its own architecture unless told otherwise, which once shipped an
 * Intel Mac app that could not run the model), and drops the other Mac
 * architecture's package, which the app would never load.
 */
const { existsSync, rmSync } = require("node:fs");
const { join } = require("node:path");

/** electron-builder's Arch enum → the packages each target must carry. */
const ARCH = { 1: "x64", 3: "arm64" };
const REQUIRED = {
  "darwin-x64": ["mac-x64"],
  "darwin-arm64": ["mac-arm64-metal"],
  "win32-x64": ["win-x64", "win-x64-vulkan", "win-x64-cuda"],
  "linux-x64": ["linux-x64", "linux-x64-vulkan", "linux-x64-cuda"],
};
const MAC_PACKAGES = ["mac-x64", "mac-arm64-metal"];

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName;
  const target = `${platform}-${ARCH[context.arch]}`;
  const required = REQUIRED[target];
  if (!required) return;
  const resources =
    platform === "darwin"
      ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : join(context.appOutDir, "resources");
  const packages = join(resources, "app.asar.unpacked", "node_modules", "@node-llama-cpp");
  const missing = required.filter((name) => !existsSync(join(packages, name)));
  if (missing.length > 0) {
    throw new Error(
      `${target}: the Built-in model's runtime is missing @node-llama-cpp/${missing.join(", ")}. Install with pnpm's --cpu for this architecture (see release.yml).`,
    );
  }
  if (platform === "darwin") {
    for (const name of MAC_PACKAGES) {
      if (!required.includes(name)) rmSync(join(packages, name), { recursive: true, force: true });
    }
  }
};
