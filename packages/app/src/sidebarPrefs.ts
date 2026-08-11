const STORAGE_KEY = "orthodox-prayer-toolkit.sidebar-prefs";

export type SidebarPrefs = {
  libraryCollapsed: boolean;
  contentCollapsed: boolean;
};

const DEFAULTS: SidebarPrefs = {
  libraryCollapsed: false,
  contentCollapsed: true,
};

function readPrefs(): SidebarPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULTS };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      libraryCollapsed:
        typeof obj.libraryCollapsed === "boolean"
          ? obj.libraryCollapsed
          : DEFAULTS.libraryCollapsed,
      contentCollapsed:
        typeof obj.contentCollapsed === "boolean"
          ? obj.contentCollapsed
          : DEFAULTS.contentCollapsed,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function loadSidebarPrefs(): SidebarPrefs {
  return readPrefs();
}

export function saveSidebarPrefs(prefs: SidebarPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Quota / private mode — ignore.
  }
}
