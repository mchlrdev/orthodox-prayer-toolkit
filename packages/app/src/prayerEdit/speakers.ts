import {
  isSpeakerPreset,
  isValidSpeakerId,
  listSpeakers,
  renameSpeaker,
  setSpeakerLabel,
  speakerDisplayLabel,
  type Prayer,
  type SpeakerSummary,
} from "@orthodox-prayer-toolkit/core";

export const SPEAKER_ID_INVALID = "Invalid id";
export const SPEAKER_ID_USED = "Id already used";

/**
 * Speakers shown in Prayer settings → Speakers: {@link listSpeakers} (presets
 * first, then custom), plus custom ids in `keep` that no longer exist (an
 * unused speaker whose only label was just cleared stays listed while the
 * pane is open).
 */
export function speakerPaneRows(
  prayer: Prayer,
  keep: readonly string[] = [],
): SpeakerSummary[] {
  const rows = listSpeakers(prayer);
  const present = new Set(rows.map((s) => s.id));
  for (const id of keep) {
    if (present.has(id) || isSpeakerPreset(id)) continue;
    present.add(id);
    rows.push({ id, blockCount: 0, labeledVariants: [], preset: false });
  }
  return rows;
}

/** Why `raw` cannot become a new custom speaker id, or null when it can. */
export function speakerAddIssue(
  raw: string,
  existing: Iterable<string>,
): string | null {
  const id = raw.trim();
  if (!id) return null;
  if (!isValidSpeakerId(id)) return SPEAKER_ID_INVALID;
  if (isSpeakerPreset(id) || [...existing].includes(id)) return SPEAKER_ID_USED;
  return null;
}

/**
 * Add a custom speaker. A speaker exists only through block use or a label
 * (no registry in the file), so the first variant gets the display label as
 * its name and the speaker persists before any block uses it.
 */
export function addCustomSpeaker(
  prayer: Prayer,
  raw: string,
  existing: Iterable<string>,
): Prayer | null {
  const id = raw.trim();
  const first = prayer.variants[0];
  if (!id || !first || speakerAddIssue(id, existing)) return null;
  return setSpeakerLabel(prayer, first, id, { name: speakerDisplayLabel(id) });
}

/** Why `from` cannot be renamed to `raw`, or null when it can (or is unchanged). */
export function speakerRenameIssue(
  prayer: Prayer,
  from: string,
  raw: string,
): string | null {
  const to = raw.trim();
  if (to === from) return null;
  if (!to || !isValidSpeakerId(to)) return SPEAKER_ID_INVALID;
  return renameSpeaker(prayer, from, to) === null ? SPEAKER_ID_USED : null;
}

export type SpeakerRenameResult =
  | { ok: true; prayer: Prayer; id: string }
  | { ok: false; issue: string };

/** Rename a custom speaker id on blocks and labels (Core `renameSpeaker`). */
export function commitSpeakerRename(
  prayer: Prayer,
  from: string,
  raw: string,
): SpeakerRenameResult {
  const to = raw.trim();
  if (to === from) return { ok: true, prayer, id: from };
  const issue = speakerRenameIssue(prayer, from, to);
  if (issue) return { ok: false, issue };
  const next = renameSpeaker(prayer, from, to);
  if (!next) return { ok: false, issue: SPEAKER_ID_USED };
  return { ok: true, prayer: next, id: to };
}
