import type { ActiveVariant } from "./variant";

const STORAGE_KEY = "orthodox-prayer-toolkit.prayer-views";

type ViewStore = Record<string, Record<string, ActiveVariant[]>>;

function isActiveVariant(value: unknown): value is ActiveVariant {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ActiveVariant).lang === "string" &&
    typeof (value as ActiveVariant).variant === "string" &&
    (value as ActiveVariant).lang.length > 0 &&
    (value as ActiveVariant).variant.length > 0
  );
}

function readStore(): ViewStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const store: ViewStore = {};
    for (const [root, prayers] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!prayers || typeof prayers !== "object" || Array.isArray(prayers)) {
        continue;
      }
      const byPath: Record<string, ActiveVariant[]> = {};
      for (const [path, cols] of Object.entries(
        prayers as Record<string, unknown>,
      )) {
        if (!Array.isArray(cols)) continue;
        const cleaned = cols.filter(isActiveVariant);
        if (cleaned.length > 0) byPath[path] = cleaned;
      }
      if (Object.keys(byPath).length > 0) store[root] = byPath;
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(store: ViewStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota / private mode — ignore; view prefs are best-effort UX.
  }
}

/** Saved column layout for a prayer (may be empty / stale). */
export function loadPrayerView(
  libraryRoot: string,
  path: string,
): ActiveVariant[] | null {
  const cols = readStore()[libraryRoot]?.[path];
  return cols && cols.length > 0 ? cols.map((c) => ({ ...c })) : null;
}

export function savePrayerView(
  libraryRoot: string,
  path: string,
  columns: ActiveVariant[],
): void {
  if (columns.length === 0) return;
  const store = readStore();
  const byPath = { ...(store[libraryRoot] ?? {}) };
  byPath[path] = columns.map((c) => ({ lang: c.lang, variant: c.variant }));
  store[libraryRoot] = byPath;
  writeStore(store);
}

export function removePrayerView(libraryRoot: string, path: string): void {
  const store = readStore();
  const byPath = store[libraryRoot];
  if (!byPath || !(path in byPath)) return;
  const next = { ...byPath };
  delete next[path];
  if (Object.keys(next).length === 0) {
    delete store[libraryRoot];
  } else {
    store[libraryRoot] = next;
  }
  writeStore(store);
}

/** When a prayer file is renamed (`id` change), move the saved view with it. */
export function movePrayerView(
  libraryRoot: string,
  fromPath: string,
  toPath: string,
): void {
  if (fromPath === toPath) return;
  const store = readStore();
  const byPath = store[libraryRoot];
  if (!byPath) return;
  const cols = byPath[fromPath];
  if (!cols) return;
  const next = { ...byPath };
  delete next[fromPath];
  next[toPath] = cols;
  store[libraryRoot] = next;
  writeStore(store);
}
