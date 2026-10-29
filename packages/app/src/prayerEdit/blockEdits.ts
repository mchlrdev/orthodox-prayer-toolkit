import {
  isKindPreset,
  isValidSpeakerId,
  kindAllowsSpeaker,
  setBlockSpeaker,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import { setBlockKind } from "./structure";

/** One block change from a Tool (Chat pane, Agent): kind and/or speaker. */
export type BlockEdit = { block: string; kind?: string; speaker?: string | null };

/**
 * Apply block edits to a prayer. Throws with a readable message when a block
 * is missing, a kind is not available in the prayer or does not take a speaker.
 */
export function applyBlockEdits(prayer: Prayer, edits: readonly BlockEdit[]): Prayer {
  let next = prayer;
  for (const edit of edits) {
    const index = next.structure.findIndex((b) => b.id === edit.block);
    if (index === -1) throw new Error(`No block "${edit.block}" in "${prayer.id}"`);
    if (edit.kind !== undefined) {
      if (!isKindPreset(edit.kind) && !next.kinds?.some((k) => k.id === edit.kind)) {
        throw new Error(`Kind "${edit.kind}" is not available in "${prayer.id}"`);
      }
      next = setBlockKind(next, index, edit.kind);
    }
    if (edit.speaker !== undefined) {
      if (edit.speaker !== null) {
        if (!isValidSpeakerId(edit.speaker)) throw new Error(`Invalid speaker id "${edit.speaker}"`);
        const kind = next.structure[index]!.kind;
        if (!kindAllowsSpeaker(kind, next)) throw new Error(`Kind "${kind}" does not take a speaker`);
      }
      next = setBlockSpeaker(next, edit.block, edit.speaker);
    }
  }
  return next;
}
