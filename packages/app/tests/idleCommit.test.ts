import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IDLE_COMMIT_DELAY_MS,
  applyIdleCommitTrigger,
  idleCommitDecision,
  nativeEventIsComposing,
} from "../src/idleCommit";

describe("IDLE_COMMIT_DELAY_MS", () => {
  it("is 400ms, inside the 300–500ms band", () => {
    expect(IDLE_COMMIT_DELAY_MS).toBe(400);
    expect(IDLE_COMMIT_DELAY_MS).toBeGreaterThanOrEqual(300);
    expect(IDLE_COMMIT_DELAY_MS).toBeLessThanOrEqual(500);
  });
});

describe("idleCommitDecision", () => {
  it("skips arming while composing", () => {
    expect(
      idleCommitDecision({ type: "input", isComposing: true }),
    ).toBe("noop");
  });

  it("arms on input, paste, and compositionend", () => {
    expect(
      idleCommitDecision({ type: "input", isComposing: false }),
    ).toBe("arm");
    expect(idleCommitDecision({ type: "paste" })).toBe("arm");
    expect(idleCommitDecision({ type: "compositionend" })).toBe("arm");
  });

  it("cancels on flush, blur, and structural commit/paint", () => {
    expect(idleCommitDecision({ type: "flush" })).toBe("cancel");
    expect(idleCommitDecision({ type: "blur" })).toBe("cancel");
    expect(idleCommitDecision({ type: "structural" })).toBe("cancel");
  });
});

describe("applyIdleCommitTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire while composing", () => {
    const timer = { id: null };
    const onIdle = vi.fn();
    applyIdleCommitTrigger(
      timer,
      { type: "input", isComposing: true },
      onIdle,
    );
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("restarts the timer on each input so a burst commits once", () => {
    const timer = { id: null };
    const onIdle = vi.fn();
    applyIdleCommitTrigger(
      timer,
      { type: "input", isComposing: false },
      onIdle,
    );
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS - 100);
    applyIdleCommitTrigger(
      timer,
      { type: "input", isComposing: false },
      onIdle,
    );
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS - 100);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending idle on flush", () => {
    const timer = { id: null };
    const onIdle = vi.fn();
    applyIdleCommitTrigger(
      timer,
      { type: "input", isComposing: false },
      onIdle,
    );
    applyIdleCommitTrigger(timer, { type: "flush" }, onIdle);
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("cancels a pending idle on blur", () => {
    const timer = { id: null };
    const onIdle = vi.fn();
    applyIdleCommitTrigger(
      timer,
      { type: "input", isComposing: false },
      onIdle,
    );
    applyIdleCommitTrigger(timer, { type: "blur" }, onIdle);
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("cancels a pending idle on note-toggle / join / split / spill", () => {
    const timer = { id: null };
    const onIdle = vi.fn();
    applyIdleCommitTrigger(
      timer,
      { type: "input", isComposing: false },
      onIdle,
    );
    applyIdleCommitTrigger(timer, { type: "structural" }, onIdle);
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("fires the idle callback once when the delay elapses", () => {
    const timer = { id: null };
    const onIdle = vi.fn();
    applyIdleCommitTrigger(
      timer,
      { type: "input", isComposing: false },
      onIdle,
    );
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("re-arms after idle so the next burst can commit", () => {
    const timer = { id: null };
    const onIdle = vi.fn();
    applyIdleCommitTrigger(
      timer,
      { type: "input", isComposing: false },
      onIdle,
    );
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS);
    applyIdleCommitTrigger(
      timer,
      { type: "input", isComposing: false },
      onIdle,
    );
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS);
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it("arms on compositionend after composing skipped", () => {
    const timer = { id: null };
    const onIdle = vi.fn();
    applyIdleCommitTrigger(
      timer,
      { type: "input", isComposing: true },
      onIdle,
    );
    applyIdleCommitTrigger(timer, { type: "compositionend" }, onIdle);
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("arms on paste", () => {
    const timer = { id: null };
    const onIdle = vi.fn();
    applyIdleCommitTrigger(timer, { type: "paste" }, onIdle);
    vi.advanceTimersByTime(IDLE_COMMIT_DELAY_MS);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

describe("nativeEventIsComposing", () => {
  it("is true only when the native event reports composing", () => {
    expect(nativeEventIsComposing(new Event("input"))).toBe(false);
    const composing = new Event("input") as Event & { isComposing: boolean };
    composing.isComposing = true;
    expect(nativeEventIsComposing(composing)).toBe(true);
  });
});
