import { describe, expect, it } from "vitest";
import {
  SPEAKER_PRESETS,
  type Block,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import { commandForKey, SPEAKER_SHORTCUT, shortcutLabel } from "../src/appCommands";
import {
  SPEAKER_ID_INVALID,
  SPEAKER_ID_USED,
  addCustomSpeaker,
  commitSpeakerRename,
  mergeBlocks,
  setBlockKind,
  speakerAddIssue,
  speakerPaneRows,
  speakerRenameIssue,
  splitBlock,
} from "../src/prayerEdit";
import { speakerContextItems, speakerOptions } from "../src/components/SpeakerMenu";
import { prayerFileText } from "../src/session/persistPrayer";

const de = { lang: "de", variant: "standard" };

function prayerWith(...structure: Block[]): Prayer {
  return {
    id: "dialog",
    type: "prayer",
    tone: null,
    variants: [
      { lang: "de", variant: "standard", title: "D", license: "unknown", source: "t" },
    ],
    structure,
    meta: {},
  };
}

const verse = (id: string, text: string, speaker?: string): Block => ({
  id,
  kind: "verse",
  ...(speaker ? { speaker } : {}),
  translations: [{ ...de, lines: [text] }],
});

describe("speakers in structure edits", () => {
  it("drops the speaker when the new kind does not allow one", () => {
    const p = prayerWith(verse("b1", "Segne, Vater.", "deacon"));
    const next = setBlockKind(p, 0, "heading");
    expect(next.structure[0]?.kind).toBe("heading");
    expect(next.structure[0]?.speaker).toBeUndefined();
  });

  it("keeps the speaker for a custom kind that allows speakers", () => {
    const styles = {
      litany: { speaker: "true" },
    } as unknown as StyleMap;
    const p = prayerWith(verse("b1", "Segne, Vater.", "deacon"));
    expect(setBlockKind(p, 0, "litany", styles).structure[0]?.speaker).toBe(
      "deacon",
    );
    // Without "Allow speaker" the custom kind drops it.
    expect(setBlockKind(p, 0, "litany", {}).structure[0]?.speaker).toBeUndefined();
  });

  it("keeps the speaker when the kind stays the same", () => {
    const p = prayerWith({
      ...verse("b1", "x", "priest"),
      kind: "litany",
    });
    expect(setBlockKind(p, 0, "litany", {})).toBe(p);
  });

  it("split: upper block keeps the speaker, the new block has none", () => {
    const p = prayerWith(verse("b1", "Eins Zwei", "priest"));
    const next = splitBlock(p, 0, de, ["Eins"], ["Zwei"], "b2");
    expect(next.structure.map((b) => [b.id, b.speaker])).toEqual([
      ["b1", "priest"],
      ["b2", undefined],
    ]);
  });

  it("join: the speaker follows the block that keeps id and kind", () => {
    const p = prayerWith(verse("b1", "Eins", "priest"), verse("b2", "Zwei", "choir"));
    const keepUpper = mergeBlocks(p, 0, "upper", de)!;
    expect(keepUpper.prayer.structure).toHaveLength(1);
    expect(keepUpper.prayer.structure[0]).toMatchObject({ id: "b1", speaker: "priest" });

    const keepLower = mergeBlocks(p, 0, "lower", de)!;
    expect(keepLower.prayer.structure[0]).toMatchObject({ id: "b2", speaker: "choir" });

    const inherit = mergeBlocks(prayerWith(verse("b1", "Eins"), verse("b2", "Zwei", "choir")), 0, "upper", de)!;
    expect(inherit.prayer.structure[0]).toMatchObject({ id: "b1", speaker: "choir" });

    const roundTrip = mergeBlocks(prayerWith(verse("b1", "Eins", "priest"), verse("b2", "Zwei")), 0, "lower", de)!;
    expect(roundTrip.prayer.structure[0]).toMatchObject({ id: "b2", speaker: "priest" });

    const none = mergeBlocks(prayerWith(verse("b1", "Eins"), verse("b2", "Zwei")), 0, "upper", de)!;
    expect(none.prayer.structure[0]?.speaker).toBeUndefined();
  });
});

describe("prayer file text (save path)", () => {
  it("writes files without speakers exactly as before", () => {
    const p = prayerWith(verse("b1", "Herr, erbarme dich."));
    expect(prayerFileText(p)).toBe(`${JSON.stringify(p, null, 2)}\n`);
    expect(prayerFileText(p)).not.toContain("formatVersion");
  });

  it("adds formatVersion 2 (first key) when a block has a speaker", () => {
    const p = prayerWith(verse("b1", "Segne, Vater.", "deacon"));
    const parsed = JSON.parse(prayerFileText(p)) as Record<string, unknown>;
    expect(parsed.formatVersion).toBe(2);
    expect(Object.keys(parsed)[0]).toBe("formatVersion");
  });

  it("removes formatVersion once no speaker is left", () => {
    const p = { ...prayerWith(verse("b1", "x")), formatVersion: 2 };
    expect(prayerFileText(p)).not.toContain("formatVersion");
  });

  it("keeps formatVersion for speaker labels without blocks", () => {
    const p = prayerWith(verse("b1", "x"));
    p.variants[0] = { ...p.variants[0]!, speakers: { priest: { name: "Priester" } } };
    expect(JSON.parse(prayerFileText(p)).formatVersion).toBe(2);
  });
});

describe("Speaker shortcut", () => {
  it("maps Mod+Shift+P to assign-speaker", () => {
    const key = (k: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean }) => ({
      key: k,
      metaKey: mods.meta ?? false,
      ctrlKey: mods.ctrl ?? false,
      shiftKey: mods.shift ?? false,
      altKey: false,
    });
    expect(commandForKey(key("P", { meta: true, shift: true }), true)).toBe(
      "assign-speaker",
    );
    expect(commandForKey(key("P", { ctrl: true, shift: true }), false)).toBe(
      "assign-speaker",
    );
    expect(commandForKey(key("p", { meta: true }), true)).toBeNull();
    expect(shortcutLabel(SPEAKER_SHORTCUT, true)).toBe("⌘⇧P");
    expect(shortcutLabel(SPEAKER_SHORTCUT, false)).toBe("Ctrl+Shift+P");
  });
});

describe("speaker lists (dropdown, right-click, settings pane)", () => {
  const withCustom = (): Prayer => ({
    ...prayerWith(verse("b1", "Herr, erbarme dich.", "cantor2"), verse("b2", "Amen.", "choir")),
    variants: [
      {
        lang: "de",
        variant: "standard",
        title: "D",
        license: "unknown",
        source: "t",
        speakers: { priest: { name: "Priester", short: "P" }, solo: { name: "Solist" } },
      },
    ],
  });

  it("offers every preset first, in preset order, then custom speakers", () => {
    const ids = speakerOptions(withCustom(), de).map((o) => o.id);
    expect(ids.slice(0, SPEAKER_PRESETS.length)).toEqual([...SPEAKER_PRESETS]);
    expect(ids.slice(SPEAKER_PRESETS.length).sort()).toEqual(["cantor2", "solo"]);
  });

  it("names are canonical English; the chip letter follows the first column", () => {
    const options = speakerOptions(withCustom(), de);
    expect(options.find((o) => o.id === "priest")).toMatchObject({
      name: "Priest",
      chip: "P",
    });
    expect(options.find((o) => o.id === "solo")?.name).toBe("Solo");
    const labels = speakerContextItems({
      value: undefined,
      options,
      onSelect: () => undefined,
      onMore: () => undefined,
    }).map((i) => ("label" in i ? String(i.label) : ""));
    expect(labels).toContain("Priest");
    expect(labels).not.toContain("Priester");
  });

  it("right-click submenu: No speaker · speakers · More speakers…", () => {
    const options = speakerOptions(withCustom(), de);
    const items = speakerContextItems({
      value: "choir",
      options,
      onSelect: () => undefined,
      onMore: () => undefined,
    });
    const labels = items.map((i) =>
      "divider" in i ? "—" : "label" in i ? String(i.label) : "?",
    );
    expect(labels[0]).toBe("No speaker");
    expect(labels[1]).toBe("—");
    expect(labels.slice(-2)).toEqual(["—", "More speakers…"]);
    expect(labels.length).toBe(options.length + 4);
  });

  it("pane rows: presets always, kept custom ids stay listed", () => {
    const p = withCustom();
    const rows = speakerPaneRows(p, ["gone", "priest"]);
    expect(rows.filter((r) => r.preset).map((r) => r.id)).toEqual([...SPEAKER_PRESETS]);
    expect(rows.filter((r) => !r.preset).map((r) => r.id)).toEqual([
      "cantor2",
      "solo",
      "gone",
    ]);
  });
});

describe("custom speaker add / rename", () => {
  const p = prayerWith(verse("b1", "Amen.", "solo"));

  it("validates new ids", () => {
    expect(speakerAddIssue("", ["solo"])).toBeNull();
    expect(speakerAddIssue("solo", ["solo"])).toBe(SPEAKER_ID_USED);
    expect(speakerAddIssue("priest", [])).toBe(SPEAKER_ID_USED);
    expect(speakerAddIssue("9x", [])).toBe(SPEAKER_ID_INVALID);
    expect(speakerAddIssue("lector", ["solo"])).toBeNull();
  });

  it("adds a custom speaker with a seeded name so it persists without blocks", () => {
    const next = addCustomSpeaker(p, "lector", ["solo"]);
    expect(next?.variants[0]?.speakers?.lector?.name).toBe("Lector");
    expect(addCustomSpeaker(p, "solo", ["solo"])).toBeNull();
  });

  it("renames a custom id on blocks and labels", () => {
    const result = commitSpeakerRename(p, "solo", "lector");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toBe("lector");
      expect(result.prayer.structure[0]?.speaker).toBe("lector");
    }
  });

  it("reports invalid and used ids", () => {
    expect(commitSpeakerRename(p, "solo", "")).toEqual({
      ok: false,
      issue: SPEAKER_ID_INVALID,
    });
    expect(commitSpeakerRename(p, "solo", "9x")).toEqual({
      ok: false,
      issue: SPEAKER_ID_INVALID,
    });
    expect(commitSpeakerRename(p, "solo", "priest")).toEqual({
      ok: false,
      issue: SPEAKER_ID_USED,
    });
    expect(speakerRenameIssue(p, "solo", "solo")).toBeNull();
  });
});
