import { describe, expect, it } from "vitest";
import { readText, suggestTitle, type Source } from "../src/index.js";

describe("suggestTitle", () => {
  it("takes a heading near the top", () => {
    const source: Source = {
      id: "s1",
      format: "html",
      name: "page.html",
      segments: [
        { id: "a", text: "Menü", look: { tag: "p", size: "12px" } },
        { id: "b", text: "Ostertroparion", look: { tag: "h1", size: "24px" } },
        { id: "c", text: "Christus ist auferstanden von den Toten.", look: { tag: "p", size: "12px" } },
      ],
    };
    expect(suggestTitle(source)).toBe("Ostertroparion");
  });

  it("falls back to a short first line, never a sentence", () => {
    expect(suggestTitle(readText("Ostertroparion\n\nChristus ist auferstanden."))).toBe("Ostertroparion");
    expect(suggestTitle(readText("Christus ist auferstanden von den Toten."))).toBeUndefined();
  });
});

describe("suggestTitle on web pages", () => {
  const page = (title: string | undefined, siteName?: string): Source => ({
    id: "s1",
    format: "html",
    name: "https://orthodoxe-kirche-balingen.de/unser-vater",
    page: { title, siteName },
    segments: [
      { id: "a", text: "Orthodoxe Kirchengemeinden Balingen und Albstadt", look: { tag: "h1", size: "28px" } },
      { id: "b", text: "Start · Gottesdienste · Gebete", look: { tag: "p", size: "12px" } },
      { id: "c", text: "Das Gebet des Herrn", look: { tag: "h2", size: "22px" } },
      { id: "d", text: "Vater unser, der Du bist im Himmel, geheiligt werde Dein Name.", look: { tag: "p", size: "14px" } },
    ],
  });

  it("skips the site's banner heading", () => {
    expect(suggestTitle(page("Das Gebet des Herrn – Orthodoxe Kirchengemeinden Balingen und Albstadt"))).toBe("Das Gebet des Herrn");
    expect(suggestTitle(page("Gebete", "Orthodoxe Kirchengemeinden Balingen und Albstadt"))).toBe("Das Gebet des Herrn");
  });

  it("uses the page title's own part when no heading matches", () => {
    const source = page("Vaterunser | Orthodoxe Kirchengemeinden Balingen und Albstadt");
    source.segments = source.segments.filter((s) => s.id !== "c");
    expect(suggestTitle(source)).toBe("Vaterunser");
  });
});
