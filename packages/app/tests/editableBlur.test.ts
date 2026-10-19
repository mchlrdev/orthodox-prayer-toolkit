import { describe, expect, it } from "vitest";
import {
  armTransientSkipBlurCommit,
  editableBlurDecision,
} from "../src/editableBlur";

describe("editableBlurDecision", () => {
  it("keeps focus when blur is into the inline-note toolbar", () => {
    expect(
      editableBlurDecision({
        relatedIsNoteToolbar: true,
        skipBlurCommit: true,
        dirty: true,
      }),
    ).toBe("ignore-toolbar");
  });

  it("skips commit for join/split/spill even if the cell is dirty", () => {
    expect(
      editableBlurDecision({
        relatedIsNoteToolbar: false,
        skipBlurCommit: true,
        dirty: true,
      }),
    ).toBe("skip-commit");
  });

  it("keeps the DOM without committing when nothing is dirty", () => {
    expect(
      editableBlurDecision({
        relatedIsNoteToolbar: false,
        skipBlurCommit: false,
        dirty: false,
      }),
    ).toBe("keep-dom");
  });

  it("commits dirty edits on a real blur", () => {
    expect(
      editableBlurDecision({
        relatedIsNoteToolbar: false,
        skipBlurCommit: false,
        dirty: true,
      }),
    ).toBe("commit");
  });
});

describe("armTransientSkipBlurCommit", () => {
  it("disarms after this turn so later edits in the same focus session still commit", async () => {
    const skipRef = { current: false };
    armTransientSkipBlurCommit(skipRef);
    expect(skipRef.current).toBe(true);
    await Promise.resolve();
    expect(skipRef.current).toBe(false);
  });
});

describe("remove inline note then delete then blur", () => {
  it("commits the deletion instead of restoring post-toggle session-draft text", async () => {
    const skipRef = { current: false };
    let dirty = false;

    // Toolbar "Remove inline note": arm skip in case the click steals focus.
    armTransientSkipBlurCommit(skipRef);
    // applyToggleNote already committed the un-noted text and kept the caret.
    dirty = false;
    skipRef.current = false;

    await Promise.resolve();
    expect(skipRef.current).toBe(false);

    // Delete the former-note text without leaving the cell.
    dirty = true;

    // Switch / focus another Block.
    expect(
      editableBlurDecision({
        relatedIsNoteToolbar: false,
        skipBlurCommit: skipRef.current,
        dirty,
      }),
    ).toBe("commit");
  });
});
