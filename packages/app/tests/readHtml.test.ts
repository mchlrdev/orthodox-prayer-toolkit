// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyImportOps,
  createImportDraft,
  importDraftToPrayer,
} from "@orthodox-prayer-toolkit/core";
import { readHtmlDocument, sanitizeHtml } from "../src/importDraft/readHtml";

const FIXTURE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/ostertroparion.html"),
  "utf8",
);

function parse(html: string): Document {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeHtml(doc);
  return doc;
}

/** Visible text without whitespace, the way a reader would check "nothing lost". */
function squash(text: string): string {
  return text.replace(/\s+/g, "");
}

describe("HTML Reader", () => {
  const source = readHtmlDocument(parse(FIXTURE), undefined, { name: "orthodoxe-gebete.de" });
  const texts = source.segments.map((s) => s.text);

  it("makes one segment per block, in page order", () => {
    expect(texts).toEqual([
      "Start Gebete",
      "Troparion der Auferstehung",
      "Im 5. Ton",
      "Priester: Christus ist erstanden von den Toten,\nhat zertreten im Tode den Tod,\nund denen in den Gräbern das Leben geschenkt.",
      "Dreimal.",
      "Ehre sei dem Vater und dem Sohn und dem Heiligen Geiste.",
      "Kontakion im 8. Ton",
      "Bist du auch ins Grab hinabgestiegen, o Unsterblicher",
      "Text in einem verschachtelten Absatz.",
      "und der Rest danach.",
      "Christus ist erstanden",
      "Христосъ воскресе",
      "Zeile eins\nZeile zwei",
      "Quelle: orthodoxe-gebete.de · Seite drucken",
    ]);
    expect(source.format).toBe("html");
    expect(source.segments.map((s) => s.id).slice(0, 2)).toEqual(["s1-1", "s1-2"]);
  });

  it("loses no visible text", () => {
    const doc = parse(FIXTURE);
    for (const el of [...doc.querySelectorAll("[style*='display:none'], title, style")]) el.remove();
    expect(squash(texts.join(""))).toBe(squash(doc.body.textContent ?? ""));
  });

  it("drops scripts, handlers and remote loads", () => {
    const doc = parse(FIXTURE);
    expect(doc.querySelector("script, img, iframe")).toBeNull();
    expect(doc.querySelector("[onload], [onclick], [href], [src]")).toBeNull();
  });

  it("puts same-looking segments in one style group", () => {
    const group = (text: string) => source.segments.find((s) => s.text.startsWith(text))?.group;
    expect(group("Troparion der")).toBeDefined();
    expect(group("Troparion der")).toBe(group("Kontakion"));
    expect(group("Im 5. Ton")).toBe(group("Dreimal."));
    expect(group("Priester:")).toBe(group("Ehre sei"));
    expect(group("Im 5. Ton")).not.toBe(group("Priester:"));
    expect(group("Troparion der")).not.toBe(group("Priester:"));
  });

  it("keeps the language of table columns", () => {
    const lang = (text: string) => source.segments.find((s) => s.text === text)?.lang;
    expect(lang("Христосъ воскресе")).toBe("cu");
    expect(lang("Christus ist erstanden")).toBe("de");
    expect(lang("Dreimal.")).toBe("de");
  });

  it("gives a valid draft, and one step sets the kind of a whole group", () => {
    const draft = createImportDraft({
      sources: [source],
      variant: { lang: "de", variant: "standard", title: "Ostertroparion", license: "CC0", source: "Test" },
      meta: { id: "ostertroparion" },
    });
    const heading = source.segments.find((s) => s.text.startsWith("Troparion der"))!;
    const result = applyImportOps(
      draft,
      [{ op: "setKind", target: { group: heading.group! }, kind: "heading" }],
      { by: "human" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = importDraftToPrayer(result.draft).structure.map((b) => b.kind);
    expect(kinds.filter((k) => k === "heading")).toHaveLength(2);
  });
});
