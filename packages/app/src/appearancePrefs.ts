export const APPEARANCE_STORAGE_KEY =
  "orthodox-prayer-toolkit.appearance-prefs";

export type ColorSchemePreference = "light" | "dark" | "system";

/** Editor prayer text; kind-style rem sizes are relative to this. */
export const EDITOR_FONT_SIZE_MIN = 12;
export const EDITOR_FONT_SIZE_MAX = 28;
export const DEFAULT_EDITOR_FONT_SIZE = 16;

export type AppearancePrefs = {
  colorScheme: ColorSchemePreference;
  editorFontSize: number;
};

const DEFAULTS: AppearancePrefs = {
  colorScheme: "system",
  editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
};

export function clampEditorFontSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.min(
    EDITOR_FONT_SIZE_MAX,
    Math.max(EDITOR_FONT_SIZE_MIN, Math.round(n)),
  );
}

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
      editorFontSize: clampEditorFontSize(
        obj.editorFontSize === undefined
          ? DEFAULT_EDITOR_FONT_SIZE
          : obj.editorFontSize,
      ),
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
