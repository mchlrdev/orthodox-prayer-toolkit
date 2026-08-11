export const APPEARANCE_STORAGE_KEY =
  "orthodox-prayer-toolkit.appearance-prefs";

export type ColorSchemePreference = "light" | "dark" | "system";

export type AppearancePrefs = {
  colorScheme: ColorSchemePreference;
};

const DEFAULTS: AppearancePrefs = {
  colorScheme: "system",
};

function isPreference(value: unknown): value is ColorSchemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readPrefs(): AppearancePrefs {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULTS };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      colorScheme: isPreference(obj.colorScheme)
        ? obj.colorScheme
        : DEFAULTS.colorScheme,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function loadAppearancePrefs(): AppearancePrefs {
  return readPrefs();
}

export function saveAppearancePrefs(prefs: AppearancePrefs): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Quota / private mode — ignore.
  }
}
