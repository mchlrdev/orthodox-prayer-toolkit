export const WHATS_NEW_STORAGE_KEY = "orthodox-prayer-toolkit.whats-new";

export type WhatsNewPrefs = {
  lastSeenWhatsNew: string | null;
};

function readPrefs(): WhatsNewPrefs {
  try {
    const raw = localStorage.getItem(WHATS_NEW_STORAGE_KEY);
    if (!raw) return { lastSeenWhatsNew: null };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { lastSeenWhatsNew: null };
    }
    const value = (parsed as Record<string, unknown>).lastSeenWhatsNew;
    return {
      lastSeenWhatsNew:
        typeof value === "string" && value.length > 0 ? value : null,
    };
  } catch {
    return { lastSeenWhatsNew: null };
  }
}

export function loadLastSeenWhatsNew(): string | null {
  return readPrefs().lastSeenWhatsNew;
}

export function saveLastSeenWhatsNew(version: string): void {
  try {
    localStorage.setItem(
      WHATS_NEW_STORAGE_KEY,
      JSON.stringify({ lastSeenWhatsNew: version }),
    );
  } catch {
    // Quota / private mode — ignore.
  }
}
