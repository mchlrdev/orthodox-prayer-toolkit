/**
 * What changed between two states of an Import draft, per block: for the
 * Chat pane's change card and the highlighted rows of one answer.
 */
import { draftBlockPlainText, draftBlockVisible, type ImportDraft } from "./importDraft.js";

export type DraftChange =
  | { block: string; what: "kind"; from: string; to: string }
  | { block: string; what: "speaker"; from: string | null; to: string | null }
  | { block: string; what: "excluded" | "included" | "added" | "removed" }
  | { block: string; what: "text"; variant: string; from: string; to: string };

export function draftChanges(before: ImportDraft, after: ImportDraft): DraftChange[] {
  const old = new Map(before.blocks.map((b) => [b.id, b]));
  const out: DraftChange[] = [];
  for (const block of after.blocks) {
    const prev = old.get(block.id);
    const visible = draftBlockVisible(after, block);
    if (!prev) {
      if (visible) out.push({ block: block.id, what: "added" });
      continue;
    }
    const wasVisible = draftBlockVisible(before, prev);
    if (wasVisible && !visible) {
      out.push({ block: block.id, what: "excluded" });
      continue;
    }
    if (!wasVisible && visible) out.push({ block: block.id, what: "included" });
    if (prev.kind !== block.kind) out.push({ block: block.id, what: "kind", from: prev.kind, to: block.kind });
    if ((prev.speaker ?? null) !== (block.speaker ?? null)) {
      out.push({ block: block.id, what: "speaker", from: prev.speaker ?? null, to: block.speaker ?? null });
    }
    for (const v of after.variants) {
      const from = draftBlockPlainText(before, prev, v.key);
      const to = draftBlockPlainText(after, block, v.key);
      // A kind change alone re-joins lines; compare without line breaks.
      if (from.replace(/\s+/g, " ") !== to.replace(/\s+/g, " ")) {
        out.push({ block: block.id, what: "text", variant: v.key, from, to });
      }
    }
  }
  const now = new Set(after.blocks.map((b) => b.id));
  for (const prev of before.blocks) {
    if (!now.has(prev.id) && draftBlockVisible(before, prev)) out.push({ block: prev.id, what: "removed" });
  }
  return out;
}
