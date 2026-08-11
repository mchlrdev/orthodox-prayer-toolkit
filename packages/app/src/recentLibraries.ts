const STORAGE_KEY = "orthodox-prayer-toolkit.recent-libraries";
const MAX_RECENT = 10;

export type RecentLibrary = {
  path: string;
  lastOpened: number;
};

function isRecentLibrary(value: unknown): value is RecentLibrary {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RecentLibrary).path === "string" &&
    (value as RecentLibrary).path.length > 0 &&
    typeof (value as RecentLibrary).lastOpened === "number" &&
    Number.isFinite((value as RecentLibrary).lastOpened)
  );
}

function readStore(): RecentLibrary[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentLibrary).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function writeStore(entries: RecentLibrary[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_RECENT)));
  } catch {
    // Quota / private mode — ignore; recents are best-effort UX.
  }
}

export function loadRecentLibraries(): RecentLibrary[] {
  return readStore();
}

/** Move `path` to the front (newest). Returns the updated list. */
export function pushRecentLibrary(path: string): RecentLibrary[] {
  const normalized = path.trim();
  if (!normalized) return readStore();
  const now = Date.now();
  const next = [
    { path: normalized, lastOpened: now },
    ...readStore().filter((e) => e.path !== normalized),
  ].slice(0, MAX_RECENT);
  writeStore(next);
  return next;
}

/** Drop a path (e.g. missing folder). Returns the updated list. */
export function removeRecentLibrary(path: string): RecentLibrary[] {
  const next = readStore().filter((e) => e.path !== path);
  writeStore(next);
  return next;
}

/** Basename for display (works with POSIX and Windows separators). */
export function recentLibraryLabel(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
