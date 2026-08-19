import type { InlineContent, Prayer } from "@orthodox-prayer-toolkit/core";
import type { ActiveVariant } from "../variant";
import { applyCommittedContent } from "./commitContent";
import {
  translationEditorContent,
  usesLines,
} from "./translations";

export function createBlockId(
  structureLength: number,
  now: number = Date.now(),
): string {
  return `b${structureLength + 1}-${now.toString(36)}`;
}

export function addBlock(
  prayer: Prayer,
  kind: string,
  blockId: string = createBlockId(prayer.structure.length),
): Prayer {
  return {
    ...prayer,
    structure: [
      ...prayer.structure,
      { id: blockId, kind, translations: [] },
    ],
  };
}

export function insertBlockAfter(
  prayer: Prayer,
  index: number,
  col: ActiveVariant,
  committed: InlineContent | InlineContent[] | null,
  blockId?: string,
): Prayer {
  const current = prayer.structure[index];
  if (!current) return prayer;

  const withCommit = applyCommittedContent(
    prayer,
    current.id,
    col,
    committed,
  );
  const id = blockId ?? createBlockId(withCommit.structure.length);
  const structure = [...withCommit.structure];
  structure.splice(index + 1, 0, {
    id,
    kind: current.kind,
    translations: [],
  });
  return { ...withCommit, structure };
}

export function moveBlock(
  prayer: Prayer,
  index: number,
  dir: -1 | 1,
): Prayer {
  const target = index + dir;
  if (target < 0 || target >= prayer.structure.length) return prayer;
  const structure = [...prayer.structure];
  const tmp = structure[index]!;
  structure[index] = structure[target]!;
  structure[target] = tmp;
  return { ...prayer, structure };
}

export function removeBlock(prayer: Prayer, index: number): Prayer {
  return {
    ...prayer,
    structure: prayer.structure.filter((_, i) => i !== index),
  };
}

/** Change a block kind, converting `lines` ↔ `text` when the payload shape changes. */
export function setBlockKind(
  prayer: Prayer,
  index: number,
  kind: string,
): Prayer {
  const current = prayer.structure[index];
  if (!current) return prayer;

  const withKind: Prayer = {
    ...prayer,
    structure: prayer.structure.map((b, i) =>
      i === index ? { ...b, kind } : b,
    ),
  };

  if (usesLines(current.kind) === usesLines(kind)) return withKind;

  return current.translations.reduce((next, tr) => {
    const content = translationEditorContent(current.kind, tr);
    const empty =
      usesLines(current.kind)
        ? (content as InlineContent[]).length === 0
        : content === "";
    return applyCommittedContent(
      next,
      current.id,
      { lang: tr.lang, variant: tr.variant },
      empty ? null : content,
    );
  }, withKind);
}
