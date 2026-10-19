import { describe, expect, it } from "vitest";
import { KIND_PRESETS, kindDisplayLabel } from "@orthodox-prayer-toolkit/core";
import { kindContextItems } from "../src/components/KindSelect";

function labels(items: ReturnType<typeof kindContextItems>): string[] {
  return items.map((i) =>
    "divider" in i ? "—" : "label" in i ? String(i.label) : "?",
  );
}

describe("kindContextItems", () => {
  it("lists presets first with title-case labels, then custom ids as-is", () => {
    const items = kindContextItems({
      value: "verse",
      options: ["strophe", "verse", "heading", "annotation", "subheading"],
      onSelect: () => undefined,
    });
    expect(labels(items)).toEqual([
      "Heading",
      "Subheading",
      "Annotation",
      "Verse",
      "strophe",
    ]);
  });

  it("marks the current kind with a check and omits More kinds… without onMore", () => {
    const items = kindContextItems({
      value: "annotation",
      options: [...KIND_PRESETS],
      onSelect: () => undefined,
    });
    expect(labels(items)).not.toContain("More kinds…");
    const annotation = items.find(
      (i) => "label" in i && i.label === "Annotation",
    );
    const heading = items.find((i) => "label" in i && i.label === "Heading");
    expect(annotation && "right" in annotation && annotation.right).toBeTruthy();
    expect(heading && "right" in heading ? heading.right : "missing").toBeUndefined();
  });

  it("right-click submenu: kinds · More kinds…", () => {
    const items = kindContextItems({
      value: "verse",
      options: [...KIND_PRESETS, "strophe"],
      onSelect: () => undefined,
      onMore: () => undefined,
    });
    const text = labels(items);
    expect(text.slice(0, KIND_PRESETS.length)).toEqual(
      KIND_PRESETS.map((k) => kindDisplayLabel(k)),
    );
    expect(text).toContain("strophe");
    expect(text.slice(-2)).toEqual(["—", "More kinds…"]);
  });

  it("selects by kind id, not the display label", () => {
    const picked: string[] = [];
    const items = kindContextItems({
      value: "verse",
      options: ["heading", "verse"],
      onSelect: (kind) => picked.push(kind),
    });
    const heading = items.find((i) => "label" in i && i.label === "Heading");
    expect(heading && "onClick" in heading).toBe(true);
    if (heading && "onClick" in heading) heading.onClick();
    expect(picked).toEqual(["heading"]);
  });
});
