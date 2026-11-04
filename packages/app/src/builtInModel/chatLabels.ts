import { presetSpeakerName, speakerDisplayLabel, type ImportDraft, type Prayer } from "@orthodox-prayer-toolkit/core";
import { segmentIndex, sourceParts } from "../importDraft/sourceView";

export type ChatTarget = { importDraft: ImportDraft | null; prayer: Prayer | null };

/**
 * How the chat names a block in a chip: in an Import draft by the number in
 * the source column ("#4"), in the editor by the start of its text. Null when
 * the block is gone.
 */
export function chatBlockLabel(target: ChatTarget, block: string, variant?: string): string | null {
  const n = chatBlockNumber(target, block, variant);
  if (n === null) return null;
  if (target.importDraft) return `#${n}`;
  const found = target.prayer?.structure.find((b) => b.id === block);
  const first = found?.translations[0];
  const text = first ? (first.lines ? first.lines.map(plainText).join(" ") : plainText(first.text)) : "";
  return text ? `“${shorten(text, 22)}”` : `#${n}`;
}

/**
 * The block's number: in an import the first source number in the language
 * shown (`variant` key), else its position.
 */
export function chatBlockNumber(target: ChatTarget, block: string, variant?: string): number | null {
  const draft = target.importDraft;
  if (draft) {
    const found = draft.blocks.find((b) => b.id === block);
    if (!found) return null;
    const segs = segmentIndex(draft);
    return (
      (variant ? sourceParts(found, segs, variant)[0]?.n : undefined) ??
      sourceParts(found, segs)[0]?.n ??
      draft.blocks.indexOf(found) + 1
    );
  }
  const index = target.prayer?.structure.findIndex((b) => b.id === block) ?? -1;
  return index < 0 ? null : index + 1;
}

function plainText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(plainText).join("");
  if (content && typeof content === "object" && "text" in content) return String((content as { text: unknown }).text);
  return "";
}

function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A speaker id's name in the open draft or prayer (the preset's label when unnamed). */
export function chatSpeakerName(target: ChatTarget, id: string): string {
  const variants = target.importDraft?.variants ?? target.prayer?.variants ?? [];
  for (const v of variants) {
    const name = v.speakers?.[id]?.name;
    if (name) return name;
  }
  // The preset's usual name in the main language ("Leser" in German).
  return (variants[0] ? presetSpeakerName(id, variants[0].lang) : undefined) ?? speakerDisplayLabel(id);
}
