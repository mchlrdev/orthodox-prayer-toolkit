export type ReleaseNotes = {
  version: string;
  items: string[];
};

/**
 * User-facing bullets for the What’s new dialog, shown once per running app
 * version (`getAppInfo().version`). Empty `items` → no dialog.
 *
 * Before every push: add/update bullets for user-visible UI/export changes
 * in that push, drop stale ones, keep the list tiny. `pnpm release` sets
 * `version` to the new tag; it is bookkeeping only and does not gate the
 * dialog (v0.3.3 shipped with `version: "0.3.2"` and stayed silent).
 */
export const RELEASE_NOTES: ReleaseNotes = {
  version: "0.3.4",
  items: [
    "Custom kinds now belong to each Prayer (Prayer settings → Kinds)",
    "Kind templates: pick one for a new Prayer or apply it later (Library settings)",
    "Older libraries ask once to migrate; files stay unchanged until you agree",
    "Speaker allowance is set per kind in the Prayer, not in Kind styles",
    "Library settings show all kind styles and offer to remove unused ones",
    "Hovering a block shows the full speaker name next to Kind, in the first visible language",
  ],
};

/**
 * Show once per running version when there are bullets. `notes.version` is
 * deliberately ignored so a missed bump cannot hide the dialog.
 */
export function shouldShowWhatsNew(args: {
  lastSeen: string | null;
  runningVersion: string;
  notes: ReleaseNotes;
}): boolean {
  const { lastSeen, runningVersion, notes } = args;
  return (
    runningVersion.length > 0 &&
    lastSeen !== runningVersion &&
    notes.items.length > 0
  );
}
