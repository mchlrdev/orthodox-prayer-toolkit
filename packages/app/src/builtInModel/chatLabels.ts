import { speakerDisplayLabel, type ImportDraft, type Prayer } from "@orthodox-prayer-toolkit/core";
import { segmentIndex, sourceParts } from "../importDraft/sourceView";

export type ChatTarget = { importDraft: ImportDraft | null; prayer: Prayer | null };

/**
 * How the chat names a block: in an Import draft by its first source section
 * ("Section 4", the number in the source column), in the editor by position
 * ("Block 4"). Null when the block is gone.
 */
export function chatBlockLabel(target: ChatTarget, block: string): { word: string; n: number } | null {
  const draft = target.importDraft;
  if (draft) {
    const found = draft.blocks.find((b) => b.id === block);
    if (!found) return null;
    const part = sourceParts(found, segmentIndex(draft))[0];
    if (part) return { word: "Section", n: part.n };
    return { word: "Block", n: draft.blocks.indexOf(found) + 1 };
  }
  const index = target.prayer?.structure.findIndex((b) => b.id === block) ?? -1;
  return index < 0 ? null : { word: "Block", n: index + 1 };
}

/** A speaker id's name in the open draft or prayer (the preset's label when unnamed). */
export function chatSpeakerName(target: ChatTarget, id: string): string {
  const variants = target.importDraft?.variants ?? target.prayer?.variants ?? [];
  for (const v of variants) {
    const name = v.speakers?.[id]?.name;
    if (name) return name;
  }
  return speakerDisplayLabel(id);
}
