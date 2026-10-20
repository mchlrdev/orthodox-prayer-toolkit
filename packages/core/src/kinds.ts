import {
  KIND_PRESETS,
  isKindPreset,
  type Block,
  type KindDef,
  type Prayer,
} from "./types.js";
import { normalizeFormatVersion } from "./formatVersion.js";
import { isValidKindId } from "./validateStyles.js";

function kindDef(id: string, speaker: boolean | undefined): KindDef {
  return speaker ? { id, speaker: true } : { id };
}

/**
 * Append defs whose id is neither a preset nor already listed (in order).
 * Existing entries stay unchanged. Returns `list` when nothing is appended.
 */
export function mergeKindDefs(
  list: readonly KindDef[],
  defs: Iterable<KindDef>,
): KindDef[] {
  const known = new Set(list.map((k) => k.id));
  const added: KindDef[] = [];
  for (const def of defs) {
    if (isKindPreset(def.id) || known.has(def.id)) continue;
    known.add(def.id);
    added.push(kindDef(def.id, def.speaker));
  }
  return added.length === 0 ? (list as KindDef[]) : [...list, ...added];
}

/**
 * Rename an entry in place (speaker flag kept). When `to` is a preset, the
 * `from` entry is dropped; when `to` is already listed, the two merge (speaker
 * if either had it). Returns `list` when `from` is not listed.
 */
export function renameKindDef(
  list: readonly KindDef[],
  from: string,
  to: string,
): KindDef[] {
  const source = list.find((k) => k.id === from);
  if (from === to || !source) return list as KindDef[];
  if (isKindPreset(to)) return list.filter((k) => k !== source);
  if (!list.some((k) => k.id === to)) {
    return list.map((k) => (k === source ? kindDef(to, k.speaker) : k));
  }
  return list
    .filter((k) => k !== source)
    .map((k) => (k.id === to ? kindDef(to, k.speaker || source.speaker) : k));
}

/**
 * Non-preset kinds with a valid id used by `blocks`, in order of first
 * appearance. Speaker flag: `allowsSpeaker(kind)` or any of its blocks
 * already carries a speaker. Invalid ids are skipped (validate reports them).
 */
export function kindDefsUsedBy(
  blocks: readonly Block[],
  allowsSpeaker: (kind: string) => boolean,
): KindDef[] {
  const defs = new Map<string, boolean>();
  for (const block of blocks) {
    if (isKindPreset(block.kind) || !isValidKindId(block.kind)) continue;
    const speaker =
      defs.get(block.kind) ||
      block.speaker !== undefined ||
      allowsSpeaker(block.kind);
    defs.set(block.kind, speaker);
  }
  return [...defs].map(([id, speaker]) => kindDef(id, speaker));
}

/**
 * Replace the prayer's `kinds` (omitted when empty; placed before
 * `structure` so files read naturally). Does not normalize `formatVersion`.
 */
export function withKinds(prayer: Prayer, kinds: readonly KindDef[]): Prayer {
  const { kinds: _k, ...rest } = prayer;
  if (kinds.length === 0) return rest as Prayer;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key === "structure") next.kinds = kinds;
    next[key] = value;
  }
  if (!("kinds" in next)) next.kinds = kinds;
  return next as Prayer;
}

/** Set `kinds` and normalize `formatVersion`; same prayer when unchanged. */
function setKinds(prayer: Prayer, kinds: readonly KindDef[]): Prayer {
  if (kinds === prayer.kinds) return prayer;
  if (kinds.length === 0 && prayer.kinds === undefined) return prayer;
  return normalizeFormatVersion(withKinds(prayer, kinds));
}

/** Kinds the editor offers in a prayer: the presets, then its `kinds` in order. */
export function pickerKinds(prayer: Pick<Prayer, "kinds">): string[] {
  return [...KIND_PRESETS, ...(prayer.kinds ?? []).map((k) => k.id)];
}

/**
 * Whether blocks of a kind may take a speaker in this prayer.
 * verse: always; heading/subheading/annotation: never; custom kinds: when
 * the prayer's `kinds` entry has `speaker: true`.
 */
export function kindAllowsSpeaker(
  kind: string,
  prayer: Pick<Prayer, "kinds">,
): boolean {
  if (kind === "verse") return true;
  if (isKindPreset(kind)) return false;
  return prayer.kinds?.some((k) => k.id === kind && k.speaker === true) ?? false;
}

/**
 * Declare custom kinds in a prayer: appends missing ids (presets skipped,
 * existing entries unchanged). Returns the same prayer when nothing is added.
 */
export function declareKinds(prayer: Prayer, defs: Iterable<KindDef>): Prayer {
  return setKinds(prayer, mergeKindDefs(prayer.kinds ?? [], defs));
}

/**
 * Declare every non-preset kind used by `blocks` (e.g. pasted or imported
 * from `source`) that the prayer does not declare yet. The speaker flag is
 * carried over from `source.kinds` when known.
 */
export function declareBlockKinds(
  prayer: Prayer,
  blocks: readonly Block[],
  source?: Pick<Prayer, "kinds">,
): Prayer {
  const defs = kindDefsUsedBy(blocks, (kind) =>
    source ? kindAllowsSpeaker(kind, source) : false,
  );
  return declareKinds(prayer, defs);
}

/**
 * Set or clear the speaker flag of a declared custom kind. Presets and
 * undeclared kinds are ignored. Block speakers are left untouched.
 */
export function setKindSpeaker(
  prayer: Prayer,
  kind: string,
  allowed: boolean,
): Prayer {
  const list = prayer.kinds ?? [];
  const current = list.find((k) => k.id === kind);
  if (!current || (current.speaker === true) === allowed) return prayer;
  return setKinds(
    prayer,
    list.map((k) => (k.id === kind ? kindDef(kind, allowed) : k)),
  );
}

/**
 * Rename a kind within a single prayer: blocks and the `kinds` entry
 * (does not touch other prayers). Presets cannot be renamed. When blocks are
 * renamed, `to` ends up declared (unless it is a preset).
 */
export function renameKind(prayer: Prayer, from: string, to: string): Prayer {
  if (from === to || isKindPreset(from)) return prayer;
  let list = renameKindDef(prayer.kinds ?? [], from, to);
  if (!prayer.structure.some((b) => b.kind === from)) {
    return setKinds(prayer, list);
  }
  const structure = prayer.structure.map((block) =>
    block.kind === from ? { ...block, kind: to } : block,
  );
  list = mergeKindDefs(
    list,
    kindDefsUsedBy(structure.filter((b) => b.kind === to), () => false),
  );
  return setKinds({ ...prayer, structure }, list);
}

/**
 * Remove a kind from a prayer: drops its `kinds` entry and reassigns its
 * blocks to `fallback` when that is a preset or declared kind (other than
 * `kind`); otherwise to `verse` (`annotation` when deleting verse).
 */
export function deleteKind(
  prayer: Prayer,
  kind: string,
  fallback = "verse",
): Prayer {
  const list = prayer.kinds ?? [];
  const declared = list.some((k) => k.id === kind);
  const used = prayer.structure.some((b) => b.kind === kind);
  if (!declared && !used) return prayer;
  const usable = (k: string): boolean =>
    k !== kind && (isKindPreset(k) || list.some((d) => d.id === k));
  const target = usable(fallback)
    ? fallback
    : kind === "verse"
      ? "annotation"
      : "verse";
  const reassigned: Prayer = used
    ? {
        ...prayer,
        structure: prayer.structure.map((block) =>
          block.kind === kind ? { ...block, kind: target } : block,
        ),
      }
    : prayer;
  return setKinds(reassigned, declared ? list.filter((k) => k.id !== kind) : list);
}
