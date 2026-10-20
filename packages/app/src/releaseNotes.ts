export type ReleaseNotesEntry = { version: string; items: string[] };

/**
 * User-facing What’s new history, newest first. The dialog lists every
 * entry whose version is ≤ the running app (`getAppInfo().version`);
 * auto-open uses unseen entries only (`version > lastSeen`).
 *
 * Before every push: prepend a block for the next tag if needed, add tiny
 * bullets for user-visible UI/export changes, never delete older rows.
 * `pnpm release` leaves a matching newest row alone, or prepends an empty
 * row for the new tag so history is not overwritten.
 */
export const RELEASE_NOTES: ReleaseNotesEntry[] = [
  {
    version: "0.3.5",
    items: [
      "Custom kinds now belong to each Prayer (Prayer settings → Kinds)",
      "Kind templates: pick one for a new Prayer or apply it later (Library settings)",
      "Older libraries ask once to migrate; files stay unchanged until you agree",
      "Speaker allowance is set per kind in the Prayer, not in Kind styles",
      "Library settings show all kind styles and offer to remove unused ones",
      "Hovering a block shows the full speaker name next to Kind, in the first visible language",
    ],
  },
  {
    version: "0.3.4",
    items: [
      "Word table Own column prints the Speaker separator (Priester:)",
      "Empty Word table columns stay visible; Speaker gutter is on by default",
      "Export remembers every setting per Prayer",
      "Kind and Speaker menus match the compact right-click menu",
    ],
  },
  {
    version: "0.3.1",
    items: [
      "Commit Block edits on idle (~400ms), Save, or leave — not only on blur",
      "Save commits the current Block without switching",
      "Deleting an inline note no longer leaves a ghost",
      "Set Kind from the Block right-click menu, like Speaker",
    ],
  },
];

/** This repo ships `x.y.z` only — no prerelease / build suffix. */
function parseXyz(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative if `a < b`, 0 if equal, positive if `a > b`. Null if either is not `x.y.z`. */
export function compareSemver(a: string, b: string): number | null {
  const pa = parseXyz(a);
  const pb = parseXyz(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  }
  return 0;
}

/** Newest seeded row (array is newest-first), or `""` if the list is empty. */
export function newestNotesVersion(notes: readonly ReleaseNotesEntry[]): string {
  return notes[0]?.version ?? "";
}

/** Entries with version ≤ `runningVersion` and at least one item, newest first. */
export function notesForRunning(
  notes: readonly ReleaseNotesEntry[],
  runningVersion: string,
): ReleaseNotesEntry[] {
  return notes
    .filter((entry) => {
      if (entry.items.length === 0) return false;
      const cmp = compareSemver(entry.version, runningVersion);
      return cmp !== null && cmp <= 0;
    })
    .slice()
    .sort((a, b) => {
      const cmp = compareSemver(b.version, a.version);
      return cmp ?? 0;
    });
}

/**
 * Slice of {@link notesForRunning} newer than `lastSeen`.
 * `lastSeen` null / empty / unparseable → the full running history.
 */
export function unseenNotes(
  notes: readonly ReleaseNotesEntry[],
  lastSeen: string | null,
  runningVersion: string,
): ReleaseNotesEntry[] {
  const visible = notesForRunning(notes, runningVersion);
  if (lastSeen == null || lastSeen.length === 0 || parseXyz(lastSeen) == null) {
    return visible;
  }
  return visible.filter((entry) => {
    const cmp = compareSemver(entry.version, lastSeen);
    return cmp !== null && cmp > 0;
  });
}

/** Auto-open when the running build knows at least one unseen, non-empty entry. */
export function shouldShowWhatsNew(args: {
  lastSeen: string | null;
  runningVersion: string;
  notes: readonly ReleaseNotesEntry[];
}): boolean {
  const { lastSeen, runningVersion, notes } = args;
  return (
    runningVersion.length > 0 &&
    unseenNotes(notes, lastSeen, runningVersion).length > 0
  );
}
