export type ReleaseNotes = {
  version: string;
  items: string[];
};

/**
 * User-facing bullets for the What’s new dialog. `version` must equal the
 * running app version (`packages/app/package.json` / `__APP_VERSION__`) or
 * the dialog stays silent. Empty `items` → no dialog.
 *
 * Before every push: add/update bullets for user-visible UI/export changes
 * in that push, drop stale ones, keep the list tiny. `pnpm release` sets
 * `version` to the new tag.
 */
export const RELEASE_NOTES: ReleaseNotes = {
  version: "0.3.1",
  items: [
    "Word table Own column prints the Speaker separator (Priester:)",
    "Empty Word table columns stay visible; Speaker gutter on by default",
    "Export remembers every setting per Prayer",
    "Kind and Speaker menus match the compact right-click menu",
  ],
};

/** Show once per matching version when there are bullets and lastSeen is not that version. */
export function shouldShowWhatsNew(args: {
  lastSeen: string | null;
  runningVersion: string;
  notes: ReleaseNotes;
}): boolean {
  const { lastSeen, runningVersion, notes } = args;
  return (
    notes.version === runningVersion &&
    lastSeen !== runningVersion &&
    notes.items.length > 0
  );
}
