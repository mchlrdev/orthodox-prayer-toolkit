import { execFile } from "node:child_process";

/** Virtual adapters that cannot run a model. */
const NOT_A_GPU = /microsoft|remote|virtual|parsec|displaylink|citrix/i;

let cached: Promise<string[]> | null = null;

/**
 * Graphics cards of this computer by name, also those the model runtime cannot
 * see. Windows only: that is where a machine has a second card the runtime can
 * miss; elsewhere the runtime's own list is enough. Empty when it cannot be read.
 */
export function systemGpus(): Promise<string[]> {
  cached ??= new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_VideoController).Name"],
      { timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve([]);
        resolve(stdout.split(/\r?\n/).map((name) => name.trim()).filter((name) => name && !NOT_A_GPU.test(name)));
      },
    );
  });
  return cached;
}
