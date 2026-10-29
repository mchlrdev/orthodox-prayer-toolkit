import { kindDisplayLabel, type DraftChange } from "@orthodox-prayer-toolkit/core";

/** One line per changed block for the chat's change card: "Speaker priest · label removed". */
export function changeLines(
  changes: readonly DraftChange[],
  speakerName: (id: string) => string = (id) => id,
): Array<{ block: string; text: string }> {
  const byBlock = new Map<string, string[]>();
  const add = (block: string, text: string) => byBlock.set(block, [...(byBlock.get(block) ?? []), text]);
  for (const c of changes) {
    switch (c.what) {
      case "kind":
        add(c.block, `Kind ${kindDisplayLabel(c.to)}`);
        break;
      case "speaker":
        add(c.block, c.to ? `Speaker ${speakerName(c.to)}` : "Speaker removed");
        break;
      case "text":
        add(c.block, c.to && c.from.endsWith(c.to) ? "label removed" : "Text changed");
        break;
      case "excluded":
        add(c.block, "Excluded");
        break;
      case "included":
        add(c.block, "Included");
        break;
      case "added":
        add(c.block, "New block");
        break;
      case "removed":
        add(c.block, "Removed");
        break;
    }
  }
  return [...byBlock].map(([block, parts]) => ({ block, text: parts.join(" · ") }));
}

/** True when an answer changed wording (not just removed a speaker label). */
export function changedWording(changes: readonly DraftChange[]): boolean {
  return changes.some((c) => c.what === "text" && !(c.to && c.from.endsWith(c.to)));
}
