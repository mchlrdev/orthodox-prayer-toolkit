import { describe, expect, it } from "vitest";
import { commandForKey } from "../src/appCommands";

const key = (
  k: string,
  mods: Partial<Record<"meta" | "ctrl" | "shift" | "alt", boolean>> = {},
) => ({
  key: k,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
});

describe("commandForKey", () => {
  it("uses Cmd on macOS and Ctrl elsewhere", () => {
    expect(commandForKey(key("s", { meta: true }), true)).toBe("save");
    expect(commandForKey(key("s", { ctrl: true }), true)).toBeNull();
    expect(commandForKey(key("s", { ctrl: true }), false)).toBe("save");
    expect(commandForKey(key("s", { meta: true }), false)).toBeNull();
  });

  it("maps the shortcut set", () => {
    const mac = (k: string, shift = false) =>
      commandForKey(key(k, { meta: true, shift }), true);
    expect(mac("S", true)).toBe("save-all");
    expect(mac("o")).toBe("open-library");
    expect(mac("n")).toBe("new-prayer");
    expect(mac(",")).toBe("settings");
    expect(mac("z")).toBe("undo");
    expect(mac("Z", true)).toBe("redo");
    expect(mac("y")).toBeNull();
    expect(commandForKey(key("y", { ctrl: true }), false)).toBe("redo");
  });

  it("ignores Alt combos and plain keys", () => {
    expect(commandForKey(key("f", { meta: true, alt: true }), true)).toBeNull();
    expect(commandForKey(key("s"), true)).toBeNull();
  });
});
