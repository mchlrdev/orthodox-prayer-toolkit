import { resolveSpeakerLabel } from "./speakers.js";
import { styleNameWithPrefix } from "./stylePrefix.js";
import type { Prayer } from "./types.js";

/**
 * Speaker export options shared by HTML / layout RTF / layout DOCX.
 * `column` only has an effect in layout DOCX; HTML and RTF treat it as `inline`.
 */
export type SpeakerExportOptions = {
  placement: "inline" | "column" | "off";
  form: "name" | "short";
  separator: string;
};

export const DEFAULT_SPEAKER_EXPORT: SpeakerExportOptions = {
  placement: "inline",
  form: "name",
  separator: ": ",
};

/** Word table speaker options (`exportLayoutDocxParallel`). */
export type ParallelSpeakerExportOptions = {
  placement: "inline-left" | "inline-both" | "column" | "off";
  form: "name" | "short";
  separator: string;
};

export const DEFAULT_PARALLEL_SPEAKER_EXPORT: ParallelSpeakerExportOptions = {
  placement: "column",
  form: "name",
  separator: ": ",
};

export function resolveSpeakerExport(
  o: Partial<SpeakerExportOptions> | undefined,
): SpeakerExportOptions {
  return { ...DEFAULT_SPEAKER_EXPORT, ...stripUndefined(o) };
}

export function resolveParallelSpeakerExport(
  o: Partial<ParallelSpeakerExportOptions> | undefined,
): ParallelSpeakerExportOptions {
  return { ...DEFAULT_PARALLEL_SPEAKER_EXPORT, ...stripUndefined(o) };
}

function stripUndefined<T extends object>(o: T | undefined): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

/**
 * Inline rule: the speaker-styled run is `label + separator.trimEnd()`,
 * followed by a plain run containing exactly one space (always, even when
 * the separator is empty).
 */
export function inlineSpeakerText(label: string, separator: string): string {
  return label + separator.trimEnd();
}

export const INLINE_SPEAKER_GAP = " ";

export function speakerStyleName(stem: string, id: string): string {
  return styleNameWithPrefix(stem, `speaker_${id}`);
}

/** Printed label for a block's speaker in a variant, or null when none. */
export function blockSpeakerLabel(
  prayer: Prayer,
  block: Prayer["structure"][number],
  lang: string,
  variant: string,
  form: "name" | "short",
): string | null {
  if (block.speaker === undefined) return null;
  return resolveSpeakerLabel(prayer, { lang, variant }, block.speaker, form);
}
