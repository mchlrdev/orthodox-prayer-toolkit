import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

/**
 * Contents/MacOS/<executable> → Foo.app
 * electron-updater's Squirrel.Mac installer needs a Developer ID; OSS / ad-hoc
 * builds get a silent no-op from quitAndInstall. We replace the bundle ourselves.
 */
export function resolveMacAppBundle(execPath: string): string {
  return resolve(execPath, "..", "..", "..");
}

export function macUpdateInstallScript(): string {
  return `#!/bin/bash
set -euo pipefail
APP_PID="$1"
APP_BUNDLE="$2"
ZIP="$3"
LOG="\${TMPDIR:-/tmp}/orthodox-prayer-toolkit-update.log"
exec >>"$LOG" 2>&1
echo "update start $(date) pid=$APP_PID"

for _ in $(seq 1 120); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

if kill -0 "$APP_PID" 2>/dev/null; then
  echo "app still running after wait"
  exit 1
fi

EXTRACT=$(mktemp -d)
trap 'rm -rf "$EXTRACT"' EXIT
ditto -x -k "$ZIP" "$EXTRACT"
NEW_APP=$(find "$EXTRACT" -maxdepth 1 -name "*.app" -print -quit)
if [ -z "$NEW_APP" ]; then
  echo "no .app in zip"
  exit 1
fi

rm -rf "$APP_BUNDLE"
ditto "$NEW_APP" "$APP_BUNDLE"
open "$APP_BUNDLE"
echo "update done $(date)"
`;
}

/** Spawn a detached helper that swaps the .app after this process exits. */
export function startMacUpdateInstall(opts: {
  execPath: string;
  pid: number;
  zipPath: string;
}): void {
  const appBundle = resolveMacAppBundle(opts.execPath);
  const scriptPath = join(tmpdir(), "orthodox-prayer-toolkit-install-update.sh");
  writeFileSync(scriptPath, macUpdateInstallScript(), { mode: 0o755 });
  const child = spawn(
    "/bin/bash",
    [scriptPath, String(opts.pid), appBundle, opts.zipPath],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
}
