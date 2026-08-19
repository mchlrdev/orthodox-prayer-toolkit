import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_KIND_STYLES,
  FALLBACK_KIND_STYLE,
  exportHtml,
  exportVariant,
  filenameMatchesId,
  findIdCollisions,
  indexKinds,
  indexVariants,
  isLibraryManifest,
  isPrayerFilename,
  isValidStylePrefixStem,
  deleteKind,
  normalizeLibraryManifest,
  normalizeStyleColor,
  parseHtmlAttributes,
  renameKind,
  resolveDisplayTitle,
  resolveLibraryStylePrefixStem,
  resolveStyles,
  sanitizeStyles,
  styleNameWithPrefix,
  tagMapFromStyles,
  validate,
  validateStyles,
  DEFAULT_STYLE_PREFIX_STEM,
  isKindPreset,
  kindDisplayLabel,
  KIND_PRESET_LABELS,
  isValidKindId,
  sanitizeKindIdInput,
} from "../src/index.js";
import type { Prayer } from "../src/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

function loadText(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

describe("validate", () => {
  it("accepts a valid multilingual prayer", () => {
    const result = validate(loadJson("valid-tropar-prokopios.json"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prayer.id).toBe("tropar-prokopios");
      expect(result.prayer.variants).toHaveLength(2);
    }
  });

  it("rejects missing required identity fields", () => {
    const result = validate({
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "X",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [{ id: "b1", kind: "verse", translations: [] }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes("id"))).toBe(true);
    }
  });

  it("rejects empty translation text", () => {
    const result = validate({
      id: "x",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "X",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [
        {
          id: "b1",
          kind: "verse",
          translations: [{ lang: "de", variant: "standard", text: "" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("allows blocks with no translations (incomplete variant)", () => {
    const result = validate({
      id: "partial",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "Teilweise",
          license: "unknown",
          source: "draft",
        },
        {
          lang: "en",
          variant: "standard",
          title: "Partial",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [
        {
          id: "b1",
          kind: "verse",
          translations: [
            { lang: "de", variant: "standard", text: "Nur Deutsch" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects duplicate block ids", () => {
    const result = validate({
      id: "dup",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "D",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [
        { id: "same", kind: "verse", translations: [] },
        { id: "same", kind: "heading", translations: [] },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.message.includes("Duplicate block"))).toBe(
        true,
      );
    }
  });

  it("rejects open kind being empty", () => {
    const result = validate({
      id: "k",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "K",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [{ id: "b1", kind: "", translations: [] }],
    });
    expect(result.ok).toBe(false);
  });

  it("accepts optional description", () => {
    const result = validate({
      id: "with-description",
      type: "prayer",
      description: "Morning prayers before the hours",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "Morgengebete",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [{ id: "b1", kind: "verse", translations: [] }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prayer.description).toBe(
        "Morning prayers before the hours",
      );
    }
  });

  it("accepts meta.custom key/value pairs", () => {
    const result = validate({
      id: "with-custom",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "Mit Meta",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [{ id: "b1", kind: "verse", translations: [] }],
      meta: {
        custom: {
          saint_id: "prokopios-von-caesarea",
          feast_rank: 3,
          published: true,
          note: null,
        },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prayer.meta?.custom?.saint_id).toBe(
        "prokopios-von-caesarea",
      );
    }
  });

  it("strips legacy meta.revised_at", () => {
    const result = validate({
      id: "legacy-revised",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "Alt",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [{ id: "b1", kind: "verse", translations: [] }],
      meta: { revised_at: "2026-08-09" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.prayer.meta).toBeUndefined();
    }
  });

  it("rejects unexpected top-level links", () => {
    const result = validate({
      id: "legacy-links",
      type: "prayer",
      links: { saint_id: "x" },
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "L",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [{ id: "b1", kind: "verse", translations: [] }],
    });
    expect(result.ok).toBe(false);
  });

  it("rejects legacy top-level title", () => {
    const result = validate({
      id: "legacy-title",
      title: "Should not be here",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "L",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [{ id: "b1", kind: "verse", translations: [] }],
    });
    expect(result.ok).toBe(false);
  });
});

describe("resolveDisplayTitle", () => {
  const prayer: Pick<Prayer, "id" | "variants"> = {
    id: "tropar-prokopios",
    variants: [
      {
        lang: "de",
        variant: "standard",
        title: "Tropar des Großmärtyrers Prokopios",
        license: "unknown",
        source: "draft",
      },
      {
        lang: "cu",
        variant: "synodal-cyrl",
        title: "Тропарь великомученику Прокопию",
        license: "unknown",
        source: "draft",
      },
    ],
  };

  it("uses first variant when no preference", () => {
    expect(resolveDisplayTitle(prayer)).toBe(
      "Tropar des Großmärtyrers Prokopios",
    );
  });

  it("prefers matching library default / active variant", () => {
    expect(
      resolveDisplayTitle(prayer, { lang: "cu", variant: "synodal-cyrl" }),
    ).toBe("Тропарь великомученику Прокопию");
  });

  it("falls back to first variant when preferred is missing", () => {
    expect(
      resolveDisplayTitle(prayer, { lang: "en", variant: "standard" }),
    ).toBe("Tropar des Großmärtyrers Prokopios");
  });

  it("falls back to id when variants are empty", () => {
    expect(resolveDisplayTitle({ id: "orphan", variants: [] })).toBe("orphan");
  });
});

describe("exportVariant", () => {
  it("exports de/standard golden fixture", () => {
    const validated = validate(loadJson("valid-tropar-prokopios.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const flat = exportVariant(validated.prayer, {
      lang: "de",
      variant: "standard",
    });
    expect(flat).toEqual(loadJson("flat-tropar-prokopios-de-standard.json"));
  });

  it("omits blocks without translation for cu/synodal-cyrl", () => {
    const validated = validate(loadJson("valid-tropar-prokopios.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const flat = exportVariant(validated.prayer, {
      lang: "cu",
      variant: "synodal-cyrl",
    });
    expect(flat).toEqual(
      loadJson("flat-tropar-prokopios-cu-synodal-cyrl.json"),
    );
    expect(flat.structure.map((b) => b.id)).toEqual(["v1"]);
  });

  it("keeps empty slots when includeBlocksWithoutTranslation is true", () => {
    const validated = validate(loadJson("valid-tropar-prokopios.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const flat = exportVariant(validated.prayer, {
      lang: "cu",
      variant: "synodal-cyrl",
      includeBlocksWithoutTranslation: true,
    });
    expect(flat.structure).toEqual([
      { id: "r1", kind: "annotation", text: "" },
      {
        id: "v1",
        kind: "verse",
        lines: [
          "Мученик Твой, Господи, Прокопий,",
          "во страдании своем венец нетления прият от Тебе, Бога нашего…",
        ],
      },
    ]);
  });

  it("uses lines: [] for empty slots when sibling translations use lines", () => {
    const prayer: Prayer = {
      id: "shape",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "T",
          license: "u",
          source: "s",
        },
        {
          lang: "en",
          variant: "standard",
          title: "T",
          license: "u",
          source: "s",
        },
      ],
      structure: [
        {
          id: "v1",
          kind: "verse",
          translations: [
            { lang: "de", variant: "standard", lines: ["a", "b"] },
          ],
        },
      ],
    };

    expect(
      exportVariant(prayer, {
        lang: "en",
        variant: "standard",
        includeBlocksWithoutTranslation: true,
      }).structure,
    ).toEqual([{ id: "v1", kind: "verse", lines: [] }]);
  });

  it("matches omit goldens when includeBlocksWithoutTranslation is false", () => {
    const validated = validate(loadJson("valid-tropar-prokopios.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(
      exportVariant(validated.prayer, {
        lang: "cu",
        variant: "synodal-cyrl",
        includeBlocksWithoutTranslation: false,
      }),
    ).toEqual(loadJson("flat-tropar-prokopios-cu-synodal-cyrl.json"));
  });

  it("throws when variant is not in registry", () => {
    const validated = validate(loadJson("valid-tropar-prokopios.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(() =>
      exportVariant(validated.prayer, { lang: "fr", variant: "standard" }),
    ).toThrow(/Variant not found/);
  });
});

describe("exportHtml", () => {
  const defaultTags = {
    heading: "h2",
    annotation: "p",
    verse: "p",
  };

  it("exports heading, annotation, and verse with inline note as fragment", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const html = exportHtml(validated.prayer, {
      lang: "de",
      variant: "standard",
      tagMap: defaultTags,
    });
    expect(html).toBe(loadText("html-sample-de-standard.fragment.html"));
  });

  it("omits blocks without translation for the variant", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const html = exportHtml(validated.prayer, {
      lang: "en",
      variant: "standard",
      tagMap: defaultTags,
    });
    expect(html).toBe(
      '<p data-kind="verse">Holy God, Holy Mighty, Holy Immortal, have mercy on us.</p>\n',
    );
  });

  it("emits empty elements when includeBlocksWithoutTranslation is true", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const html = exportHtml(validated.prayer, {
      lang: "en",
      variant: "standard",
      tagMap: defaultTags,
      includeBlocksWithoutTranslation: true,
    });
    expect(html).toBe(
      [
        '<h2 data-kind="heading"></h2>',
        '<p data-kind="annotation"></p>',
        '<p data-kind="verse">Holy God, Holy Mighty, Holy Immortal, have mercy on us.</p>',
        "",
      ].join("\n"),
    );
  });

  it("matches omit goldens when includeBlocksWithoutTranslation is false", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    expect(
      exportHtml(validated.prayer, {
        lang: "en",
        variant: "standard",
        tagMap: defaultTags,
        includeBlocksWithoutTranslation: false,
      }),
    ).toBe(
      '<p data-kind="verse">Holy God, Holy Mighty, Holy Immortal, have mercy on us.</p>\n',
    );
  });

  it("falls back to div for missing or disallowed tags", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const html = exportHtml(validated.prayer, {
      lang: "en",
      variant: "standard",
      tagMap: { verse: "script" },
    });
    expect(html).toBe(
      '<div data-kind="verse">Holy God, Holy Mighty, Holy Immortal, have mercy on us.</div>\n',
    );
  });

  it("escapes text content", () => {
    const prayer: Prayer = {
      id: "esc",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "T",
          license: "u",
          source: "s",
        },
      ],
      structure: [
        {
          id: "b1",
          kind: "annotation",
          translations: [
            {
              lang: "de",
              variant: "standard",
              text: 'A <B> & "C"',
            },
          ],
        },
      ],
    };

    expect(
      exportHtml(prayer, {
        lang: "de",
        variant: "standard",
        tagMap: { annotation: "p" },
      }),
    ).toBe('<p data-kind="annotation">A &lt;B&gt; &amp; &quot;C&quot;</p>\n');
  });

  it("wraps with auto-meta attributes when enabled", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const html = exportHtml(validated.prayer, {
      lang: "de",
      variant: "standard",
      tagMap: defaultTags,
      wrapper: { enabled: true },
    });
    expect(html).toBe(loadText("html-sample-de-standard.wrapped.html"));
  });

  it("lets user wrapper attributes override auto-meta", () => {
    const validated = validate(loadJson("html-export-sample.json"));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const html = exportHtml(validated.prayer, {
      lang: "en",
      variant: "standard",
      tagMap: defaultTags,
      wrapper: {
        enabled: true,
        tag: "section",
        attributes: { "data-title": "Override", class: "prayer" },
      },
    });
    expect(html.startsWith("<section ")).toBe(true);
    expect(html).toContain('data-title="Override"');
    expect(html).toContain('class="prayer"');
    expect(html).toContain('data-lang="en"');
    expect(html).not.toContain("data-id=");
    expect(html).not.toContain('id="v1"');
  });
});

describe("parseHtmlAttributes", () => {
  it("parses quoted attributes", () => {
    const result = parseHtmlAttributes('class="prayer" data-x="1"');
    expect(result).toEqual({
      ok: true,
      attributes: { class: "prayer", "data-x": "1" },
    });
  });

  it("rejects on* handlers and style", () => {
    const result = parseHtmlAttributes('onclick="x" style="color:red" class="ok"');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /onclick/i.test(e))).toBe(true);
    expect(result.errors.some((e) => /style/i.test(e))).toBe(true);
  });

  it("accepts empty input", () => {
    expect(parseHtmlAttributes("  ")).toEqual({ ok: true, attributes: {} });
  });
});

describe("tagMapFromStyles", () => {
  it("keeps allowlisted htmlTag values from resolved styles", () => {
    expect(
      tagMapFromStyles({
        heading: { ...FALLBACK_KIND_STYLE, htmlTag: "h2" },
        verse: { ...FALLBACK_KIND_STYLE, htmlTag: "script" },
        custom: { ...FALLBACK_KIND_STYLE },
      }),
    ).toEqual({ heading: "h2" });
  });
});

describe("kind display labels", () => {
  it("title-cases built-in presets and leaves custom ids unchanged", () => {
    expect(kindDisplayLabel("heading")).toBe("Heading");
    expect(kindDisplayLabel("subheading")).toBe("Subheading");
    expect(kindDisplayLabel("annotation")).toBe("Annotation");
    expect(kindDisplayLabel("verse")).toBe("Verse");
    expect(kindDisplayLabel("strophe")).toBe("strophe");
    expect(isKindPreset("verse")).toBe(true);
    expect(isKindPreset("strophe")).toBe(false);
    expect(KIND_PRESET_LABELS.heading).toBe("Heading");
  });
});

describe("indexKinds / renameKind", () => {
  it("unions kinds across prayers", () => {
    const a = validate(loadJson("valid-tropar-prokopios.json"));
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    const custom: Prayer = {
      id: "custom",
      type: "prayer",
      variants: [
        {
          lang: "de",
          variant: "standard",
          title: "C",
          license: "unknown",
          source: "draft",
        },
      ],
      structure: [
        { id: "x", kind: "epistle-intro", translations: [] },
        { id: "y", kind: "annotation", translations: [] },
      ],
    };

    expect(indexKinds([a.prayer, custom])).toEqual([
      "annotation",
      "epistle-intro",
      "verse",
    ]);
  });

  it("unions lang/variant pairs across prayers", () => {
    expect(
      indexVariants([
        {
          variants: [
            {
              lang: "de",
              variant: "standard",
              title: "A",
              license: "unknown",
              source: "draft",
            },
            {
              lang: "en",
              variant: "standard",
              title: "B",
              license: "unknown",
              source: "draft",
            },
          ],
        },
        {
          variants: [
            {
              lang: "de",
              variant: "standard",
              title: "A again",
              license: "unknown",
              source: "draft",
            },
            {
              lang: "cu",
              variant: "synodal-cyrl",
              title: "C",
              license: "unknown",
              source: "draft",
            },
          ],
        },
      ]),
    ).toEqual([
      { lang: "cu", variant: "synodal-cyrl" },
      { lang: "de", variant: "standard" },
      { lang: "en", variant: "standard" },
    ]);
  });

  it("renames kind only within one prayer", () => {
    const a = validate(loadJson("valid-tropar-prokopios.json"));
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    const renamed = renameKind(a.prayer, "annotation", "instruction");
    expect(renamed.structure[0]?.kind).toBe("instruction");
    expect(a.prayer.structure[0]?.kind).toBe("annotation");
  });

  it("deletes kind by reassigning blocks", () => {
    const a = validate(loadJson("valid-tropar-prokopios.json"));
    expect(a.ok).toBe(true);
    if (!a.ok) return;

    const removed = deleteKind(a.prayer, "annotation");
    expect(removed.structure.every((b) => b.kind !== "annotation")).toBe(true);
    expect(removed.structure[0]?.kind).toBe("verse");
    expect(a.prayer.structure[0]?.kind).toBe("annotation");
  });
});

describe("resolveStyles", () => {
  it("uses defaults for presets and fallback for unknown", () => {
    const styles = resolveStyles({
      discoveredKinds: ["annotation", "custom-kind"],
    });
    expect(styles.annotation).toEqual(DEFAULT_KIND_STYLES.annotation);
    expect(styles["custom-kind"]).toEqual(FALLBACK_KIND_STYLE);
  });

  it("includes builtin htmlTag defaults on presets", () => {
    expect(DEFAULT_KIND_STYLES.heading?.htmlTag).toBe("h2");
    expect(DEFAULT_KIND_STYLES.subheading?.htmlTag).toBe("h3");
    expect(DEFAULT_KIND_STYLES.verse?.htmlTag).toBe("p");
    expect(DEFAULT_KIND_STYLES.verse?.fontSize).toBe("1rem");
    expect(DEFAULT_KIND_STYLES.annotation?.htmlTag).toBe("p");
    expect(FALLBACK_KIND_STYLE.htmlTag).toBeUndefined();
  });

  it("lets library overrides win over app defaults", () => {
    const styles = resolveStyles({
      discoveredKinds: ["verse"],
      appDefaults: {
        verse: {
          fontSize: "2rem",
          color: "base",
          fontWeight: "700",
          fontStyle: "normal",
          htmlTag: "div",
        },
      },
      libraryOverrides: {
        verse: {
          fontSize: "1.5rem",
          color: "accent",
          fontWeight: "400",
          fontStyle: "italic",
          htmlTag: "blockquote",
        },
      },
    });
    expect(styles.verse?.fontSize).toBe("1.5rem");
    expect(styles.verse?.fontStyle).toBe("italic");
    expect(styles.verse?.color).toBe("accent");
    expect(styles.verse?.htmlTag).toBe("blockquote");
  });
});

describe("normalizeStyleColor", () => {
  it("passes through tokens", () => {
    expect(normalizeStyleColor("base")).toBe("base");
    expect(normalizeStyleColor("accent")).toBe("accent");
    expect(normalizeStyleColor(" Accent ")).toBe("accent");
  });

  it("maps known accent hex and other hexes to tokens", () => {
    expect(normalizeStyleColor("#8b2942")).toBe("accent");
    expect(normalizeStyleColor("#8B2942")).toBe("accent");
    expect(normalizeStyleColor("#1a1a1a")).toBe("base");
    expect(normalizeStyleColor("#000")).toBe("base");
    expect(normalizeStyleColor("#abcdef")).toBe("base");
  });

  it("rejects non-colors", () => {
    expect(normalizeStyleColor("red")).toBeNull();
    expect(normalizeStyleColor("rgb(0,0,0)")).toBeNull();
  });
});

describe("validateStyles", () => {
  it("accepts default kind styles", () => {
    const result = validateStyles(DEFAULT_KIND_STYLES);
    expect(result.ok).toBe(true);
  });

  it("accepts allowlisted htmlTag and rejects others", () => {
    const ok = validateStyles({
      verse: {
        fontSize: "1rem",
        color: "base",
        fontWeight: "400",
        fontStyle: "normal",
        htmlTag: "blockquote",
      },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.styles.verse?.htmlTag).toBe("blockquote");

    const bad = validateStyles({
      verse: {
        fontSize: "1rem",
        color: "base",
        fontWeight: "400",
        fontStyle: "normal",
        htmlTag: "script",
      },
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.some((e) => e.path.includes("htmlTag"))).toBe(true);
  });

  it("rejects url() and unknown fields", () => {
    const result = validateStyles({
      verse: {
        fontSize: "1rem",
        color: "url(javascript:alert(1))",
        fontWeight: "400",
        fontStyle: "normal",
        evil: "x",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes("color"))).toBe(true);
    expect(result.errors.some((e) => e.path.includes("evil"))).toBe(true);
  });

  it("sanitizeStyles normalizes legacy hex colors to tokens", () => {
    const { styles, errors } = sanitizeStyles({
      verse: { color: "#1a1a1a" },
      heading: { color: "#8b2942" },
      other: { color: "#112233" },
      bad: { color: "url(http://x)" },
    });
    expect(styles.verse?.color).toBe("base");
    expect(styles.heading?.color).toBe("accent");
    expect(styles.other?.color).toBe("base");
    expect(styles.bad).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("lets resolveStyles fill defaults over partial sanitized overrides", () => {
    const { styles: overrides } = sanitizeStyles({
      verse: { color: "#8b2942" },
    });
    const resolved = resolveStyles({
      discoveredKinds: ["verse"],
      libraryOverrides: overrides,
    });
    expect(resolved.verse?.color).toBe("accent");
    expect(resolved.verse?.fontSize).toBe(DEFAULT_KIND_STYLES.verse?.fontSize);
  });
});

describe("kind ids", () => {
  it("accepts letter-first ids of letters, digits, _ and -", () => {
    expect(isValidKindId("Test")).toBe(true);
    expect(isValidKindId("strophe_2")).toBe(true);
    expect(isValidKindId("foo-bar")).toBe(true);
    expect(isValidKindId("")).toBe(false);
    expect(isValidKindId("Test kind")).toBe(false);
    expect(isValidKindId("1abc")).toBe(false);
  });

  it("strips illegal characters from in-progress input", () => {
    expect(sanitizeKindIdInput("Test kind")).toBe("Testkind");
    expect(sanitizeKindIdInput(" Test")).toBe("Test");
    expect(sanitizeKindIdInput("1abc")).toBe("abc");
    expect(sanitizeKindIdInput("foo_bar-2")).toBe("foo_bar-2");
    expect(sanitizeKindIdInput("a".repeat(80))).toHaveLength(64);
  });

  it("drops invalid kind keys instead of keeping a broken style map", () => {
    const { styles, errors } = sanitizeStyles({
      "Test kind": { color: "base" },
      Test: { color: "accent" },
    });
    expect(styles["Test kind"]).toBeUndefined();
    expect(styles.Test?.color).toBe("accent");
    expect(errors.some((e) => e.message.includes("invalid kind"))).toBe(true);
  });
});

describe("library helpers", () => {
  it("excludes manifest and toolkit styles from prayer files", () => {
    expect(isPrayerFilename("trisagion.json")).toBe(true);
    expect(isPrayerFilename("manifest.json")).toBe(false);
    expect(isPrayerFilename(".orthodox-prayer-toolkit/styles.json")).toBe(
      false,
    );
  });

  it("detects duplicate ids", () => {
    const collisions = findIdCollisions([
      { path: "a/foo.json", id: "foo" },
      { path: "b/foo.json", id: "foo" },
      { path: "bar.json", id: "bar" },
    ]);
    expect(collisions).toEqual([
      { id: "foo", paths: ["a/foo.json", "b/foo.json"] },
    ]);
  });

  it("checks filename matches id", () => {
    expect(filenameMatchesId("tropar-prokopios.json", "tropar-prokopios")).toBe(
      true,
    );
    expect(filenameMatchesId("wrong.json", "tropar-prokopios")).toBe(false);
  });

  it("accepts optional library manifest shape", () => {
    expect(
      isLibraryManifest({
        description: "Examples",
        defaultVariant: { lang: "de", variant: "standard" },
      }),
    ).toBe(true);
    expect(isLibraryManifest({})).toBe(true);
    expect(isLibraryManifest({ description: "notes only" })).toBe(true);
    expect(isLibraryManifest({ description: 1 })).toBe(false);
    expect(isLibraryManifest(null)).toBe(false);
    expect(isLibraryManifest({ stylePrefixStem: "lit" })).toBe(true);
    expect(isLibraryManifest({ stylePrefixStem: "" })).toBe(true);
    expect(isLibraryManifest({ stylePrefixStem: "1bad" })).toBe(false);
    expect(isLibraryManifest({ stylePrefixStem: "bad_stem" })).toBe(false);
  });

  it("strips legacy name/version from library manifests", () => {
    const normalized = normalizeLibraryManifest({
      description: "Examples",
      defaultVariant: { lang: "de", variant: "standard" },
    });
    expect(normalized).toEqual({
      description: "Examples",
      defaultVariant: { lang: "de", variant: "standard" },
    });
    // Extra legacy keys on disk must not survive normalization
    const withLegacy = {
      description: "Examples",
      defaultVariant: { lang: "de", variant: "standard" },
      name: "Old Title",
      version: "0.1.0",
    };
    expect(normalizeLibraryManifest(withLegacy)).toEqual({
      description: "Examples",
      defaultVariant: { lang: "de", variant: "standard" },
    });
    expect(normalizeLibraryManifest(withLegacy)).not.toHaveProperty("name");
    expect(normalizeLibraryManifest(withLegacy)).not.toHaveProperty("version");
  });

  it("keeps valid stylePrefixStem and drops empty", () => {
    expect(
      normalizeLibraryManifest({ stylePrefixStem: "liturgy" }),
    ).toEqual({ stylePrefixStem: "liturgy" });
    expect(normalizeLibraryManifest({ stylePrefixStem: "" })).toEqual({});
    expect(
      normalizeLibraryManifest({
        description: "x",
        stylePrefixStem: "opt",
      }),
    ).toEqual({ description: "x", stylePrefixStem: "opt" });
  });
});

describe("stylePrefix", () => {
  it("validates stem pattern", () => {
    expect(isValidStylePrefixStem("")).toBe(true);
    expect(isValidStylePrefixStem("opt")).toBe(true);
    expect(isValidStylePrefixStem("Liturgy2")).toBe(true);
    expect(isValidStylePrefixStem("1opt")).toBe(false);
    expect(isValidStylePrefixStem("opt_")).toBe(false);
    expect(isValidStylePrefixStem("opt-heading")).toBe(false);
  });

  it("resolves library stem to opt when empty or absent", () => {
    expect(resolveLibraryStylePrefixStem(undefined)).toBe(
      DEFAULT_STYLE_PREFIX_STEM,
    );
    expect(resolveLibraryStylePrefixStem(null)).toBe(DEFAULT_STYLE_PREFIX_STEM);
    expect(resolveLibraryStylePrefixStem("")).toBe(DEFAULT_STYLE_PREFIX_STEM);
    expect(resolveLibraryStylePrefixStem("lit")).toBe("lit");
  });

  it("builds style names with hardcoded underscore", () => {
    expect(styleNameWithPrefix("opt", "heading")).toBe("opt_heading");
    expect(styleNameWithPrefix("", "heading")).toBe("heading");
    expect(styleNameWithPrefix("opt", "note")).toBe("opt_note");
  });
});
