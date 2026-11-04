import { kindDisplayLabel, type DraftChange } from "@orthodox-prayer-toolkit/core";

/** One line per changed block, in everyday words: "Speaker: Priest · Label removed". */
export function changeLines(
  changes: readonly DraftChange[],
  speakerName: (id: string) => string = (id) => id,
): Array<{ block: string; text: string }> {
  const byBlock = new Map<string, string[]>();
  const add = (block: string, text: string) => byBlock.set(block, [...(byBlock.get(block) ?? []), text]);
  for (const c of changes) {
    switch (c.what) {
      case "kind":
        add(c.block, `→ ${kindDisplayLabel(c.to)}`);
        break;
      case "speaker":
        add(c.block, c.to ? `Speaker: ${speakerName(c.to)}` : "No speaker");
        break;
      case "text":
        add(c.block, labelRemoved(c) ? "Label removed" : "Text changed");
        break;
      case "note":
        add(c.block, "Inline annotation");
        break;
      case "excluded":
        add(c.block, "Left out");
        break;
      case "included":
        add(c.block, "Restored");
        break;
      case "added":
        add(c.block, "New");
        break;
      case "removed":
        add(c.block, "Removed");
        break;
    }
  }
  return [...byBlock].map(([block, parts]) => ({ block, text: parts.join(" · ") }));
}

function labelRemoved(c: Extract<DraftChange, { what: "text" }>): boolean {
  return Boolean(c.to && c.from.endsWith(c.to));
}

/** True when an answer changed wording (not just removed a speaker label). */
export function changedWording(changes: readonly DraftChange[]): boolean {
  return changes.some((c) => c.what === "text" && !labelRemoved(c));
}

/** The banner line for an answer: "2 left out", "3 → Annotation · 1 speaker". */
export function changeSummary(
  changes: readonly DraftChange[],
  speakerName: (id: string) => string = (id) => id,
): string {
  const parts: string[] = [];
  const blocks = (list: readonly DraftChange[]) => new Set(list.map((c) => c.block)).size;
  const of = <W extends DraftChange["what"]>(what: W) =>
    changes.filter((c): c is Extract<DraftChange, { what: W }> => c.what === what);
  const excluded = of("excluded");
  if (excluded.length) parts.push(`${blocks(excluded)} left out`);
  const included = of("included");
  if (included.length) parts.push(`${blocks(included)} restored`);
  const kinds = of("kind");
  if (kinds.length) {
    const to = new Set(kinds.map((c) => c.to));
    parts.push(to.size === 1 ? `${blocks(kinds)} → ${kindDisplayLabel(kinds[0]!.to)}` : `${blocks(kinds)} kinds changed`);
  }
  const speakers = of("speaker");
  if (speakers.length) {
    const to = new Set(speakers.map((c) => c.to ?? ""));
    const only = speakers[0]!.to;
    parts.push(
      to.size === 1 && only
        ? `${blocks(speakers)} → ${speakerName(only)}`
        : to.size === 1
          ? `${blocks(speakers)} without speaker`
          : `${blocks(speakers)} speakers changed`,
    );
  }
  const texts = of("text");
  if (texts.length) {
    const labels = texts.filter(labelRemoved);
    if (labels.length) parts.push(`${blocks(labels)} ${blocks(labels) === 1 ? "label" : "labels"} removed`);
    const edited = texts.filter((c) => !labelRemoved(c));
    if (edited.length) parts.push(`${blocks(edited)} text changed`);
  }
  const notes = of("note");
  if (notes.length) parts.push(`${blocks(notes)} inline ${blocks(notes) === 1 ? "annotation" : "annotations"}`);
  const added = of("added");
  if (added.length) parts.push(`${blocks(added)} new`);
  const removed = of("removed");
  if (removed.length) parts.push(`${blocks(removed)} removed`);
  return parts.join(" · ");
}
