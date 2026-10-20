import {
  CURRENT_FORMAT_VERSION,
  type Prayer,
  type SpeakerLabel,
  type VariantMeta,
} from "./types.js";

/**
 * Lowest format revision that can hold the prayer: 3 iff `kinds` is
 * non-empty, else 2 iff speakers are used, else `undefined` (field omitted).
 */
export function requiredFormatVersion(prayer: Prayer): number | undefined {
  if (prayer.kinds && prayer.kinds.length > 0) return CURRENT_FORMAT_VERSION;
  const speakers =
    prayer.structure.some((b) => b.speaker !== undefined) ||
    prayer.variants.some((v) => v.speakers && Object.keys(v.speakers).length > 0);
  return speakers ? 2 : undefined;
}

/**
 * Set (or remove) only the `formatVersion` key per {@link requiredFormatVersion}.
 * Returns the same object when nothing changes.
 */
export function applyFormatVersion(prayer: Prayer): Prayer {
  const version = requiredFormatVersion(prayer);
  if (version === undefined) {
    if (!("formatVersion" in prayer)) return prayer;
    const { formatVersion: _f, ...rest } = prayer;
    return rest as Prayer;
  }
  return prayer.formatVersion === version
    ? prayer
    : { ...prayer, formatVersion: version };
}

/**
 * Prune empty speaker label objects and empty maps, then derive
 * `formatVersion` (see {@link requiredFormatVersion}). Returns the same object
 * when nothing changes.
 */
export function normalizeFormatVersion(prayer: Prayer): Prayer {
  let changed = false;
  const variants = prayer.variants.map((v) => {
    if (!("speakers" in v)) return v;
    const map: Record<string, SpeakerLabel> = {};
    for (const [id, label] of Object.entries(v.speakers ?? {})) {
      const next: SpeakerLabel = {};
      if (label?.name) next.name = label.name;
      if (label?.short) next.short = label.short;
      if (Object.keys(next).length > 0) map[id] = next;
    }
    const pruned =
      Object.keys(map).length > 0 &&
      Object.keys(map).length === Object.keys(v.speakers ?? {}).length &&
      Object.entries(map).every(([id, l]) => {
        const o = v.speakers![id]!;
        return o.name === l.name && o.short === l.short &&
          Object.keys(o).length === Object.keys(l).length;
      });
    if (pruned) return v;
    changed = true;
    const { speakers: _s, ...rest } = v;
    return (Object.keys(map).length > 0
      ? { ...rest, speakers: map }
      : rest) as VariantMeta;
  });
  return applyFormatVersion(changed ? { ...prayer, variants } : prayer);
}
