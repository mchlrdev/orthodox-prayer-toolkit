import { describe, expect, it } from "vitest";
import {
  applyMenuBarPinned,
  applyZoomAction,
  shouldAutoHideMenuBar,
  zoomActionFromInput,
  type ZoomKeyInput,
} from "../electron/windowChrome";

const key = (
  k: string,
  mods: Partial<
    Pick<ZoomKeyInput, "control" | "meta" | "alt" | "code" | "type">
  > = {},
): ZoomKeyInput => ({
  type: mods.type ?? "keyDown",
  key: k,
  code: mods.code,
  control: mods.control ?? false,
  meta: mods.meta ?? false,
  alt: mods.alt ?? false,
});

describe("shouldAutoHideMenuBar", () => {
  it("hides the in-window bar on Windows and Linux only", () => {
    expect(shouldAutoHideMenuBar("win32")).toBe(true);
    expect(shouldAutoHideMenuBar("linux")).toBe(true);
    expect(shouldAutoHideMenuBar("darwin")).toBe(false);
  });
});

describe("applyMenuBarPinned", () => {
  it("pins visible or restores auto-hide", () => {
    const calls: string[] = [];
    const win = {
      setAutoHideMenuBar: (hide: boolean) => {
        calls.push(`autoHide:${hide}`);
      },
      setMenuBarVisibility: (visible: boolean) => {
        calls.push(`visible:${visible}`);
      },
    };
    applyMenuBarPinned(win, true);
    applyMenuBarPinned(win, false);
    expect(calls).toEqual([
      "autoHide:false",
      "visible:true",
      "autoHide:true",
      "visible:false",
    ]);
  });
});

describe("zoomActionFromInput", () => {
  it("zooms with Ctrl on Windows/Linux and Cmd on macOS", () => {
    expect(zoomActionFromInput(key("+", { control: true }), false)).toBe("in");
    expect(zoomActionFromInput(key("=", { control: true }), false)).toBe("in");
    expect(zoomActionFromInput(key("-", { control: true }), false)).toBe("out");
    expect(zoomActionFromInput(key("0", { control: true }), false)).toBe(
      "reset",
    );
    expect(zoomActionFromInput(key("+", { meta: true }), true)).toBe("in");
    expect(zoomActionFromInput(key("+", { control: true }), true)).toBeNull();
    expect(zoomActionFromInput(key("+", { meta: true }), false)).toBeNull();
  });

  it("accepts numpad plus/minus", () => {
    expect(
      zoomActionFromInput(
        key("Add", { control: true, code: "NumpadAdd" }),
        false,
      ),
    ).toBe("in");
    expect(
      zoomActionFromInput(
        key("Subtract", { control: true, code: "NumpadSubtract" }),
        false,
      ),
    ).toBe("out");
  });

  it("ignores keyup, Alt combos, and unrelated keys", () => {
    expect(
      zoomActionFromInput(key("+", { control: true, type: "keyUp" }), false),
    ).toBeNull();
    expect(
      zoomActionFromInput(key("+", { control: true, alt: true }), false),
    ).toBeNull();
    expect(zoomActionFromInput(key("s", { control: true }), false)).toBeNull();
  });
});

describe("applyZoomAction", () => {
  it("steps zoom level by 0.5 and resets to 0", () => {
    const wc = { zoomLevel: 0 };
    applyZoomAction(wc, "in");
    applyZoomAction(wc, "in");
    expect(wc.zoomLevel).toBe(1);
    applyZoomAction(wc, "out");
    expect(wc.zoomLevel).toBe(0.5);
    applyZoomAction(wc, "reset");
    expect(wc.zoomLevel).toBe(0);
  });
});
