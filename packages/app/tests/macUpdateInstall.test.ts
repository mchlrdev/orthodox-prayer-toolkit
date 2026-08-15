import { describe, expect, it } from "vitest";
import {
  macUpdateInstallScript,
  resolveMacAppBundle,
} from "../electron/macUpdateInstall";

describe("resolveMacAppBundle", () => {
  it("walks from Contents/MacOS/executable up to the .app bundle", () => {
    expect(
      resolveMacAppBundle(
        "/Applications/Orthodox Prayer Toolkit.app/Contents/MacOS/OrthodoxPrayerToolkit",
      ),
    ).toBe("/Applications/Orthodox Prayer Toolkit.app");
  });
});

describe("macUpdateInstallScript", () => {
  it("waits for the old pid, unpacks the zip, replaces the bundle, and relaunches", () => {
    const script = macUpdateInstallScript();
    expect(script).toContain('kill -0 "$APP_PID"');
    expect(script).toContain('ditto -x -k "$ZIP"');
    expect(script).toContain('ditto "$NEW_APP" "$APP_BUNDLE"');
    expect(script).toContain('open "$APP_BUNDLE"');
    expect(script).toContain("APP_PID=\"$1\"");
    expect(script).toContain("APP_BUNDLE=\"$2\"");
    expect(script).toContain("ZIP=\"$3\"");
  });
});
