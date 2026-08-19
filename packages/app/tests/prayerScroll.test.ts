import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPrayerScroll,
  prayerScrollKey,
  recallPrayerScroll,
  rememberPrayerScroll,
  resetPrayerScrollMemory,
} from "../src/prayerScroll";

describe("prayerScroll", () => {
  beforeEach(() => {
    resetPrayerScrollMemory();
  });

  it("recalls 0 for a prayer that has not been scrolled", () => {
    expect(recallPrayerScroll(prayerScrollKey("/lib", "a.json"))).toBe(0);
  });

  it("does not apply the previous prayer's scroll to the next prayer", () => {
    const el = { scrollTop: 800 };
    applyPrayerScroll(
      el,
      prayerScrollKey("/lib", "a.json"),
      prayerScrollKey("/lib", "b.json"),
    );
    expect(el.scrollTop).toBe(0);
    expect(recallPrayerScroll(prayerScrollKey("/lib", "a.json"))).toBe(800);
  });

  it("keeps the stored position if the scroller is later clamped", () => {
    const a = prayerScrollKey("/lib", "a.json");
    const b = prayerScrollKey("/lib", "b.json");
    const el = { scrollTop: 800 };
    applyPrayerScroll(el, a, b);
    el.scrollTop = 40;
    expect(recallPrayerScroll(a)).toBe(800);
  });

  it("restores the remembered position when returning to a prayer", () => {
    const el = { scrollTop: 800 };
    applyPrayerScroll(el, prayerScrollKey("/lib", "a.json"), prayerScrollKey("/lib", "b.json"));
    el.scrollTop = 120;
    applyPrayerScroll(el, prayerScrollKey("/lib", "b.json"), prayerScrollKey("/lib", "a.json"));
    expect(el.scrollTop).toBe(800);
  });

  it("keeps libraries with the same relative path separate", () => {
    rememberPrayerScroll(prayerScrollKey("/lib-a", "vespers.json"), 400);
    rememberPrayerScroll(prayerScrollKey("/lib-b", "vespers.json"), 90);
    expect(recallPrayerScroll(prayerScrollKey("/lib-a", "vespers.json"))).toBe(400);
    expect(recallPrayerScroll(prayerScrollKey("/lib-b", "vespers.json"))).toBe(90);
  });
});
