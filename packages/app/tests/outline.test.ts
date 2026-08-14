import { describe, expect, it } from "vitest";
import type { Prayer } from "@orthodox-prayer-toolkit/core";
import {
  buildPrayerOutline,
  OUTLINE_ACTIVE_THRESHOLD_SLACK_PX,
  resolveActiveOutlineId,
  type OutlineAnchor,
} from "../src/prayerEdit/outline";

const col = { lang: "de", variant: "standard" };

function prayerWith(
  structure: Prayer["structure"],
): Prayer {
  return {
    id: "toc-test",
    type: "prayer",
    tone: null,
    variants: [
      {
        lang: "de",
        variant: "standard",
        title: "Test",
        license: "unknown",
        source: "test",
      },
    ],
    structure,
    meta: {},
  };
}

describe("buildPrayerOutline", () => {
  it("nests subheadings under the preceding heading", () => {
    const outline = buildPrayerOutline(
      prayerWith([
        {
          id: "h1",
          kind: "heading",
          translations: [{ lang: "de", variant: "standard", text: "One" }],
        },
        {
          id: "s1",
          kind: "subheading",
          translations: [{ lang: "de", variant: "standard", text: "A" }],
        },
        {
          id: "v1",
          kind: "verse",
          translations: [],
        },
        {
          id: "s2",
          kind: "subheading",
          translations: [{ lang: "de", variant: "standard", text: "B" }],
        },
        {
          id: "h2",
          kind: "heading",
          translations: [{ lang: "de", variant: "standard", text: "Two" }],
        },
        {
          id: "s3",
          kind: "subheading",
          translations: [{ lang: "de", variant: "standard", text: "C" }],
        },
      ]),
      col,
    );

    expect(outline).toEqual([
      {
        blockId: "h1",
        kind: "heading",
        label: "One",
        children: [
          { blockId: "s1", kind: "subheading", label: "A", children: [] },
          { blockId: "s2", kind: "subheading", label: "B", children: [] },
        ],
      },
      {
        blockId: "h2",
        kind: "heading",
        label: "Two",
        children: [
          { blockId: "s3", kind: "subheading", label: "C", children: [] },
        ],
      },
    ]);
  });

  it("keeps orphan subheadings at the root", () => {
    const outline = buildPrayerOutline(
      prayerWith([
        {
          id: "s0",
          kind: "subheading",
          translations: [{ lang: "de", variant: "standard", text: "Preamble" }],
        },
        {
          id: "h1",
          kind: "heading",
          translations: [{ lang: "de", variant: "standard", text: "Body" }],
        },
      ]),
      col,
    );

    expect(outline).toEqual([
      {
        blockId: "s0",
        kind: "subheading",
        label: "Preamble",
        children: [],
      },
      {
        blockId: "h1",
        kind: "heading",
        label: "Body",
        children: [],
      },
    ]);
  });

  it("uses an empty label when the primary column has no text", () => {
    const outline = buildPrayerOutline(
      prayerWith([
        {
          id: "h1",
          kind: "heading",
          translations: [],
        },
      ]),
      col,
    );

    expect(outline).toEqual([
      { blockId: "h1", kind: "heading", label: "", children: [] },
    ]);
  });

  it("returns an empty outline when there are no headings", () => {
    expect(
      buildPrayerOutline(
        prayerWith([
          { id: "v1", kind: "verse", translations: [] },
          { id: "a1", kind: "annotation", translations: [] },
        ]),
        col,
      ),
    ).toEqual([]);
  });

  it("reads labels from the primary column only", () => {
    const outline = buildPrayerOutline(
      prayerWith([
        {
          id: "h1",
          kind: "heading",
          translations: [
            { lang: "de", variant: "standard", text: "Deutsch" },
            { lang: "en", variant: "standard", text: "English" },
          ],
        },
      ]),
      col,
    );

    expect(outline[0]?.label).toBe("Deutsch");
  });
});

describe("resolveActiveOutlineId", () => {
  const anchors: OutlineAnchor[] = [
    { blockId: "s0", kind: "subheading", top: 10, orphan: true },
    { blockId: "h1", kind: "heading", top: 100, orphan: false },
    { blockId: "s1", kind: "subheading", top: 150, orphan: false },
    { blockId: "h2", kind: "heading", top: 300, orphan: false },
  ];

  it("returns null when nothing has reached the threshold", () => {
    expect(resolveActiveOutlineId(anchors, 0, 0)).toBeNull();
  });

  it("marks an orphan subheading when it is the latest qualifying entry", () => {
    expect(resolveActiveOutlineId(anchors, 20, 0)).toBe("s0");
  });

  it("marks the last heading at or above the threshold", () => {
    expect(resolveActiveOutlineId(anchors, 120, 0)).toBe("h1");
    expect(resolveActiveOutlineId(anchors, 310, 0)).toBe("h2");
  });

  it("ignores nested subheadings for the active mark", () => {
    expect(resolveActiveOutlineId(anchors, 160, 0)).toBe("h1");
  });

  it("applies the sticky header offset to the threshold", () => {
    // scrollTop 90 + offset 20 = 110 → h1 qualifies, s0 also does; last is h1
    expect(resolveActiveOutlineId(anchors, 90, 20)).toBe("h1");
  });

  it("keeps the jumped heading active when measurement is 1px past the threshold", () => {
    // Outline jump lands the target at scrollTop + headerOffset. getBoundingClientRect
    // often reports that top a fraction/pixel below the sticky line, which must not
    // leave the previous heading marked active.
    const jumped: OutlineAnchor[] = [
      { blockId: "h1", kind: "heading", top: 100, orphan: false },
      { blockId: "h2", kind: "heading", top: 300.75, orphan: false },
    ];
    expect(resolveActiveOutlineId(jumped, 260, 40)).toBe("h2");
  });

  it("does not activate a heading clearly below the reading line", () => {
    const jumped: OutlineAnchor[] = [
      { blockId: "h1", kind: "heading", top: 100, orphan: false },
      {
        blockId: "h2",
        kind: "heading",
        top: 300 + OUTLINE_ACTIVE_THRESHOLD_SLACK_PX + 1,
        orphan: false,
      },
    ];
    expect(resolveActiveOutlineId(jumped, 260, 40)).toBe("h1");
  });
});
