import { describe, expect, it } from "vitest";
import type { KindStyle, KindTemplate } from "@orthodox-prayer-toolkit/core";
import {
  kindAddChoices,
  kindSpeakerNote,
  patchKindStyle,
  templateMissingKinds,
} from "../src/prayerEdit";
import {
  isLibraryMetaPath,
  migrationPromptText,
  migrationTokensKeptReason,
  type LibraryMigrationReport,
} from "../src/session";
import { templateSelectData } from "../src/components/NewPrayerModal";

const hymns: KindTemplate = {
  id: "hymns",
  label: "Hymns",
  kinds: [{ id: "refrain", speaker: true }, { id: "tone-label" }],
};

describe("kind panel helpers", () => {
  it("offers library custom kinds not listed yet, sorted, never presets", () => {
    expect(
      kindAddChoices(["verse", "tone-label", "refrain", "stich", "refrain"], [
        { id: "refrain" },
      ]),
    ).toEqual(["stich", "tone-label"]);
  });

  it("lists what Apply template would add", () => {
    expect(templateMissingKinds(undefined, hymns)).toEqual(["refrain", "tone-label"]);
    expect(templateMissingKinds([{ id: "refrain" }], hymns)).toEqual(["tone-label"]);
    expect(
      templateMissingKinds([{ id: "tone-label" }, { id: "refrain" }], hymns),
    ).toEqual([]);
  });

  it("states the fixed speaker rule of presets only", () => {
    expect(kindSpeakerNote("verse")).toMatch(/always/);
    expect(kindSpeakerNote("heading")).toMatch(/never/);
    expect(kindSpeakerNote("annotation")).toMatch(/never/);
    expect(kindSpeakerNote("refrain")).toBeNull();
  });

  it("patches a style without leaving empty optional fields", () => {
    const base: KindStyle = {
      fontSize: "1rem",
      color: "accent",
      fontWeight: "400",
      fontStyle: "normal",
      htmlTag: "p",
    };
    expect(patchKindStyle(base, { htmlTag: "" as never })).toEqual({
      fontSize: "1rem",
      color: "accent",
      fontWeight: "400",
      fontStyle: "normal",
    });
    expect(patchKindStyle(base, { fontWeight: "700" }).fontWeight).toBe("700");
  });
});

describe("new prayer template select", () => {
  it("starts with No template, then the templates with their kinds", () => {
    const data = templateSelectData([hymns, { id: "empty", label: "Empty", kinds: [] }]);
    expect(data.map((d) => d.label)).toEqual([
      "No template (built-in kinds only)",
      "Hymns — refrain, tone-label",
      "Empty",
    ]);
    expect(data.slice(1).map((d) => d.value)).toEqual(["hymns", "empty"]);
    // The "none" value can never be a template id (slug pattern).
    expect(data[0]!.value).not.toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});

describe("migration prompt texts", () => {
  it("counts prayers and mentions legacy speaker tokens", () => {
    const text = migrationPromptText({ prayers: 3, legacyTokens: true, pending: true, templatesBroken: false, blocked: null });
    expect(text.title).toBe("3 prayers use the old format — migrate now?");
    expect(text.details.join(" ")).toMatch(/Speaker setting/);
    expect(text.message).toMatch(/Not now leaves the files unchanged/);
    expect(
      migrationPromptText({ prayers: 1, legacyTokens: false, pending: true, templatesBroken: false, blocked: null }).title,
    ).toBe("1 prayer uses the old format — migrate now?");
    expect(
      migrationPromptText({ prayers: 0, legacyTokens: true, pending: true, templatesBroken: false, blocked: null }).title,
    ).toMatch(/styles/);
    const broken = migrationPromptText({
      prayers: 2,
      legacyTokens: true,
      pending: true,
      templatesBroken: true,
      blocked: null,
    });
    expect(broken.details.join(" ")).toMatch(/templates\.json has errors/);
    expect(broken.details.join(" ")).not.toMatch(/kept as the kind template/);
  });

  it("explains kept tokens only when a run left them in styles.json", () => {
    const clean: LibraryMigrationReport = {
      written: ["a.json"],
      skippedUnsaved: [],
      failed: [],
      templatesWritten: true,
      stylesWritten: true,
    };
    expect(migrationTokensKeptReason(clean, true)).toBeNull();
    expect(migrationTokensKeptReason({ ...clean, stylesWritten: false }, false)).toBeNull();
    expect(
      migrationTokensKeptReason(
        { ...clean, stylesWritten: false, failed: [{ path: "b.json", reason: "invalid JSON" }] },
        true,
      ),
    ).toMatch(/not every prayer was migrated/);
  });
});

describe("library meta files", () => {
  it("rescans for manifest, styles and templates changes only", () => {
    expect(isLibraryMetaPath("manifest.json")).toBe(true);
    expect(isLibraryMetaPath(".orthodox-prayer-toolkit/styles.json")).toBe(true);
    expect(isLibraryMetaPath(".orthodox-prayer-toolkit/templates.json")).toBe(true);
    expect(isLibraryMetaPath("morning.json")).toBe(false);
  });
});
