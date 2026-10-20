import type { Prayer, SpeakerLabel, VariantMeta } from "./types.js";
import { normalizeFormatVersion } from "./formatVersion.js";
import {
  KIND_ID_MAX_LENGTH,
  isValidKindId,
  sanitizeKindIdInput,
} from "./validateStyles.js";

/**
 * Built-in speaker ids, always available in the editor like Kind presets
 * (fixed: not renameable or deletable). Core ships no translated labels.
 */
export const SPEAKER_PRESETS = [
  "bishop",
  "priest",
  "deacon",
  "reader",
  "cantor",
  "choir",
  "people",
  "all",
] as const;

export type SpeakerPreset = (typeof SPEAKER_PRESETS)[number];

export function isSpeakerPreset(id: string): id is SpeakerPreset {
  return (SPEAKER_PRESETS as readonly string[]).includes(id);
}

export type VariantRef = { lang: string; variant: string };

export type SpeakerSummary = {
  /** True for built-in ids ({@link SPEAKER_PRESETS}). Set by {@link listSpeakers}. */
  preset?: boolean;
  id: string;
  /** Number of blocks that carry this speaker. */
  blockCount: number;
  /** Variants that have a name or short label for this speaker. */
  labeledVariants: VariantRef[];
};

/** Same id rules as kind ids. */
export function isValidSpeakerId(id: string): boolean {
  return isValidKindId(id);
}

/** Strip characters that cannot appear in a speaker id; used while typing. */
export function sanitizeSpeakerIdInput(raw: string): string {
  return sanitizeKindIdInput(raw).slice(0, KIND_ID_MAX_LENGTH);
}

/**
 * Title-case display of a speaker id: first letter upper-cased, `-`/`_`
 * become spaces, rest lower-cased ("my-cantor" -> "My cantor").
 */
export function speakerDisplayLabel(id: string): string {
  const spaced = id.replace(/[-_]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isSameVariant(v: VariantRef, ref: VariantRef): boolean {
  return v.lang === ref.lang && v.variant === ref.variant;
}

function labelOf(
  prayer: Prayer,
  ref: VariantRef,
  id: string,
): SpeakerLabel | undefined {
  return prayer.variants.find((v) => isSameVariant(v, ref))?.speakers?.[id];
}

function firstLetter(s: string): string {
  const ch = [...s.trim()][0];
  return ch ? ch.toUpperCase() : "";
}

/**
 * Speakers of a prayer: union of block speakers (first appearance in the
 * structure) and variant label keys (in variant order).
 */
export function indexSpeakers(prayer: Prayer): SpeakerSummary[] {
  const map = new Map<string, SpeakerSummary>();
  const get = (id: string): SpeakerSummary => {
    let s = map.get(id);
    if (!s) {
      s = { id, blockCount: 0, labeledVariants: [] };
      map.set(id, s);
    }
    return s;
  };
  for (const b of prayer.structure) {
    if (b.speaker !== undefined) get(b.speaker).blockCount += 1;
  }
  for (const v of prayer.variants) {
    for (const [id, label] of Object.entries(v.speakers ?? {})) {
      if (!label?.name && !label?.short) continue;
      get(id).labeledVariants.push({ lang: v.lang, variant: v.variant });
    }
  }
  return [...map.values()];
}

/** Assign (or clear with `null`) the speaker of one block. */
export function setBlockSpeaker(
  prayer: Prayer,
  blockId: string,
  id: string | null,
): Prayer {
  const structure = prayer.structure.map((b) => {
    if (b.id !== blockId) return b;
    if (id === null) {
      const { speaker: _s, ...rest } = b;
      return rest;
    }
    return { ...b, speaker: id };
  });
  return normalizeFormatVersion({ ...prayer, structure });
}

/**
 * Set the printed name/short of a speaker in one variant. Values are trimmed;
 * empty strings remove the field. Passing a field as `undefined` keeps it.
 */
export function setSpeakerLabel(
  prayer: Prayer,
  ref: VariantRef,
  id: string,
  patch: { name?: string; short?: string },
): Prayer {
  const variants = prayer.variants.map((v) => {
    if (!isSameVariant(v, ref)) return v;
    const label: SpeakerLabel = { ...(v.speakers?.[id] ?? {}) };
    for (const field of ["name", "short"] as const) {
      const raw = patch[field];
      if (raw === undefined) continue;
      const trimmed = raw.trim();
      if (trimmed === "") delete label[field];
      else label[field] = trimmed;
    }
    const speakers = { ...(v.speakers ?? {}) };
    if (label.name || label.short) speakers[id] = label;
    else delete speakers[id];
    const { speakers: _s, ...rest } = v;
    return (Object.keys(speakers).length > 0
      ? { ...rest, speakers }
      : rest) as VariantMeta;
  });
  return normalizeFormatVersion({ ...prayer, variants });
}

/** Remove a speaker from every block and every variant label map. */
export function removeSpeaker(prayer: Prayer, id: string): Prayer {
  const structure = prayer.structure.map((b) => {
    if (b.speaker !== id) return b;
    const { speaker: _s, ...rest } = b;
    return rest;
  });
  const variants = prayer.variants.map((v) => {
    if (!v.speakers || !(id in v.speakers)) return v;
    const { [id]: _drop, ...speakers } = v.speakers;
    const { speakers: _s, ...rest } = v;
    return (Object.keys(speakers).length > 0
      ? { ...rest, speakers }
      : rest) as VariantMeta;
  });
  return normalizeFormatVersion({ ...prayer, structure, variants });
}

function isEnglishLang(lang: string): boolean {
  const lower = lang.toLowerCase();
  return lower === "en" || lower.startsWith("en-");
}

/** English edition to borrow labels from when `from` has none. */
function englishFallbackLabel(
  prayer: Prayer,
  from: VariantRef,
  id: string,
): SpeakerLabel | undefined {
  const candidates = prayer.variants.filter(
    (v) => isEnglishLang(v.lang) && !isSameVariant(v, from),
  );
  if (candidates.length === 0) return undefined;
  const pick =
    candidates.find((v) => v.variant === from.variant) ?? candidates[0];
  return pick?.speakers?.[id];
}

/**
 * Printed label of a speaker in a variant.
 * name: this variant, else the English variant, else {@link speakerDisplayLabel}(id).
 * short: this variant's short / first letter of its name, else English short /
 * first letter of English name, else first letter of the resolved name.
 */
export function resolveSpeakerLabel(
  prayer: Prayer,
  ref: VariantRef,
  id: string,
  form: "name" | "short",
): string {
  const here = labelOf(prayer, ref, id);
  const en = englishFallbackLabel(prayer, ref, id);
  const name = here?.name || en?.name || speakerDisplayLabel(id);
  if (form === "name") return name;
  if (here?.short) return here.short;
  if (here?.name) return firstLetter(here.name);
  if (en?.short) return en.short;
  if (en?.name) return firstLetter(en.name);
  return firstLetter(name);
}

/**
 * Editor chip text: same fallbacks as {@link resolveSpeakerLabel} `short`.
 */
export function speakerChipLabel(
  prayer: Prayer,
  ref: VariantRef,
  id: string,
): string {
  return resolveSpeakerLabel(prayer, ref, id, "short");
}

/**
 * Every speaker the editor offers for a prayer: all presets (in preset order),
 * then custom speakers in {@link indexSpeakers} order.
 */
export function listSpeakers(prayer: Prayer): SpeakerSummary[] {
  const used = new Map(indexSpeakers(prayer).map((s) => [s.id, s]));
  const presets = SPEAKER_PRESETS.map((id) => ({
    ...(used.get(id) ?? { id, blockCount: 0, labeledVariants: [] }),
    preset: true,
  }));
  const custom = [...used.values()]
    .filter((s) => !isSpeakerPreset(s.id))
    .map((s) => ({ ...s, preset: false }));
  return [...presets, ...custom];
}

/**
 * Rename a custom speaker id on every block and in every variant label map.
 * Returns `null` when `to` is invalid, a preset, already used, or `from` is a
 * preset; returns the prayer unchanged when `from === to`.
 */
export function renameSpeaker(
  prayer: Prayer,
  from: string,
  to: string,
): Prayer | null {
  if (from === to) return prayer;
  if (isSpeakerPreset(from) || isSpeakerPreset(to) || !isValidSpeakerId(to)) {
    return null;
  }
  if (indexSpeakers(prayer).some((s) => s.id === to)) return null;
  const structure = prayer.structure.map((b) =>
    b.speaker === from ? { ...b, speaker: to } : b,
  );
  const variants = prayer.variants.map((v) => {
    if (!v.speakers || !(from in v.speakers)) return v;
    const speakers: Record<string, SpeakerLabel> = {};
    for (const [id, label] of Object.entries(v.speakers)) {
      speakers[id === from ? to : id] = label;
    }
    return { ...v, speakers };
  });
  return normalizeFormatVersion({ ...prayer, structure, variants });
}
