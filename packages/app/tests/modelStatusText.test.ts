import { describe, expect, it } from "vitest";
import type { ModelStatus } from "../electron/modelStore";
import { modelStatusLine } from "../src/builtInModel/modelStatusText";

const model = { name: "Qwen3.5 4B", version: "1", size: 3.4e9 };
const line = (s: Partial<ModelStatus>) =>
  modelStatusLine({ model, state: "absent", received: 0, ...s });

describe("Built-in model status line", () => {
  it("says what the user can do next", () => {
    expect(line({})).toBe("3.4 GB download");
    expect(line({ previousVersion: "0" })).toBe("A new version is available · 3.4 GB");
    expect(line({ state: "downloading", received: 1.2e9, bytesPerSecond: 18e6 })).toBe(
      "1.2 GB of 3.4 GB · about 2 min left",
    );
    expect(line({ state: "downloading", received: 1.2e9 })).toBe("1.2 GB of 3.4 GB");
    expect(line({ state: "downloading", received: 3.3e9, bytesPerSecond: 18e6 })).toBe(
      "3.3 GB of 3.4 GB · less than a minute left",
    );
    expect(line({ state: "paused", received: 1.2e9 })).toBe("1.2 GB of 3.4 GB · paused");
    expect(line({ state: "installed", received: 3.4e9 })).toBe(
      "Installed · 3.4 GB · kept until the next model update",
    );
    expect(line({ state: "error", message: "Not enough disk space" })).toBe("Not enough disk space");
  });
});
