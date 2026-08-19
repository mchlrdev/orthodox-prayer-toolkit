import { describe, expect, it } from "vitest";
import {
  resolveUpdateCheck,
  updateStatusMessage,
} from "../electron/updateCheck";

describe("resolveUpdateCheck", () => {
  it("reports dev when the app is not packaged", () => {
    expect(
      resolveUpdateCheck({
        packaged: false,
        currentVersion: "0.1.9",
        pendingVersion: null,
        latestVersion: "0.2.0",
        isUpdateAvailable: true,
        errorMessage: null,
      }),
    ).toEqual({ status: "dev", version: "0.1.9" });
  });

  it("reports ready when a downloaded update is pending", () => {
    expect(
      resolveUpdateCheck({
        packaged: true,
        currentVersion: "0.1.8",
        pendingVersion: "0.1.9",
        latestVersion: "0.1.9",
        isUpdateAvailable: true,
        errorMessage: null,
      }),
    ).toEqual({
      status: "ready",
      version: "0.1.8",
      latestVersion: "0.1.9",
    });
  });

  it("reports an error from the updater", () => {
    expect(
      resolveUpdateCheck({
        packaged: true,
        currentVersion: "0.1.9",
        pendingVersion: null,
        latestVersion: null,
        isUpdateAvailable: null,
        errorMessage: "Could not check for updates.",
      }),
    ).toEqual({
      status: "error",
      version: "0.1.9",
      message: "Could not check for updates.",
    });
  });

  it("reports available when the feed has a newer release", () => {
    expect(
      resolveUpdateCheck({
        packaged: true,
        currentVersion: "0.1.8",
        pendingVersion: null,
        latestVersion: "0.1.9",
        isUpdateAvailable: true,
        errorMessage: null,
      }),
    ).toEqual({
      status: "available",
      version: "0.1.8",
      latestVersion: "0.1.9",
    });
  });

  it("reports up to date when the feed matches the installed version", () => {
    expect(
      resolveUpdateCheck({
        packaged: true,
        currentVersion: "0.1.9",
        pendingVersion: null,
        latestVersion: "0.1.9",
        isUpdateAvailable: false,
        errorMessage: null,
      }),
    ).toEqual({
      status: "up-to-date",
      version: "0.1.9",
      latestVersion: "0.1.9",
    });
  });

  it("falls back to comparing versions when availability is unknown", () => {
    expect(
      resolveUpdateCheck({
        packaged: true,
        currentVersion: "0.1.8",
        pendingVersion: null,
        latestVersion: "0.1.9",
        isUpdateAvailable: null,
        errorMessage: null,
      }).status,
    ).toBe("available");
    expect(
      resolveUpdateCheck({
        packaged: true,
        currentVersion: "0.1.9",
        pendingVersion: null,
        latestVersion: "0.1.9",
        isUpdateAvailable: null,
        errorMessage: null,
      }).status,
    ).toBe("up-to-date");
  });
});

describe("updateStatusMessage", () => {
  it("explains that checks need a packaged build", () => {
    expect(
      updateStatusMessage({ status: "dev", version: "0.1.9" }),
    ).toBe("Update checks run only in the installed app.");
  });

  it("says the app is current", () => {
    expect(
      updateStatusMessage({
        status: "up-to-date",
        version: "0.1.9",
        latestVersion: "0.1.9",
      }),
    ).toBe("You're up to date.");
  });

  it("names the available and ready versions", () => {
    expect(
      updateStatusMessage({
        status: "available",
        version: "0.1.8",
        latestVersion: "0.1.9",
      }),
    ).toBe("Version 0.1.9 is available.");
    expect(
      updateStatusMessage({
        status: "ready",
        version: "0.1.8",
        latestVersion: "0.1.9",
      }),
    ).toBe("Version 0.1.9 is ready to install.");
  });
});
