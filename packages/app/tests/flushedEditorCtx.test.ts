import { describe, expect, it } from "vitest";
import {
  rememberCtxPrayer,
  snapshotAfterFlush,
} from "../src/flushedEditorCtx";

type Ctx = { prayer: string };

describe("snapshotAfterFlush", () => {
  it("reads ctx after flush so a structure op sees committed typing", () => {
    const ctx = { current: { prayer: "verse-v1" } satisfies Ctx };
    const flush = () => rememberCtxPrayer(ctx, "verse-v1 typed");
    const { prayer } = snapshotAfterFlush(flush, ctx);
    expect(prayer).toBe("verse-v1 typed");
  });

  it("structure op after flush keeps typing instead of the opening-render prayer", () => {
    const ctx = { current: { prayer: "verse-v1" } satisfies Ctx };
    const session: string[] = [];
    const onChange = (next: string) => {
      session.push(next);
      rememberCtxPrayer(ctx, next);
    };
    const flush = () => onChange("verse-v1 typed");

    const { prayer } = snapshotAfterFlush(flush, ctx);
    onChange(`${prayer}|add-below`);
    expect(session).toEqual(["verse-v1 typed", "verse-v1 typed|add-below"]);
  });

  it("without flush, a structure op from the opening render drops typing", () => {
    const prayerFromRender = "verse-v1";
    const session: string[] = [];
    session.push(`${prayerFromRender}|add-below`);
    expect(session).toEqual(["verse-v1|add-below"]);
  });
});
