export type AppInfo = {
  version: string;
  packaged: boolean;
};

export type AppUpdateCheckResult =
  | { status: "dev"; version: string }
  | { status: "up-to-date"; version: string; latestVersion: string }
  | { status: "available"; version: string; latestVersion: string }
  | { status: "ready"; version: string; latestVersion: string }
  | { status: "error"; version: string; message: string };

export function resolveUpdateCheck(input: {
  packaged: boolean;
  currentVersion: string;
  pendingVersion: string | null;
  latestVersion: string | null;
  isUpdateAvailable: boolean | null;
  errorMessage: string | null;
}): AppUpdateCheckResult {
  const version = input.currentVersion;
  if (!input.packaged) {
    return { status: "dev", version };
  }
  if (input.errorMessage) {
    return { status: "error", version, message: input.errorMessage };
  }
  if (input.pendingVersion) {
    return {
      status: "ready",
      version,
      latestVersion: input.pendingVersion,
    };
  }
  const latestVersion = input.latestVersion ?? version;
  const available =
    input.isUpdateAvailable ?? latestVersion !== version;
  if (available) {
    return { status: "available", version, latestVersion };
  }
  return { status: "up-to-date", version, latestVersion };
}

export function updateStatusMessage(result: AppUpdateCheckResult): string {
  switch (result.status) {
    case "dev":
      return "Update checks run only in the installed app.";
    case "up-to-date":
      return "You're up to date.";
    case "available":
      return `Version ${result.latestVersion} is available.`;
    case "ready":
      return `Version ${result.latestVersion} is ready to install.`;
    case "error":
      return result.message;
  }
}
