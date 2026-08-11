import type { IdCollision, LibraryManifest } from "./types.js";
import { isValidStylePrefixStem } from "./stylePrefix.js";

const NON_PRAYER_BASENAMES = new Set(["manifest.json", "styles.json"]);

/**
 * True if a relative path points at a prayer JSON file
 * (excludes manifest.json and toolkit style files).
 */
export function isPrayerFilename(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? normalized;
  if (!base.endsWith(".json")) return false;
  if (NON_PRAYER_BASENAMES.has(base)) return false;
  if (normalized.includes("/.orthodox-prayer-toolkit/")) return false;
  if (normalized.startsWith(".orthodox-prayer-toolkit/")) return false;
  return true;
}

/**
 * Expected filename for a prayer id (flat layout).
 */
export function prayerFilename(id: string): string {
  return `${id}.json`;
}

/**
 * Detect duplicate ids and id/filename mismatches.
 * `entries` maps relative path → prayer id (from file contents when parseable).
 */
export function findIdCollisions(
  entries: Array<{ path: string; id: string | null }>,
): IdCollision[] {
  const byId = new Map<string, string[]>();
  const collisions: IdCollision[] = [];

  for (const entry of entries) {
    if (entry.id === null) continue;
    const list = byId.get(entry.id) ?? [];
    list.push(entry.path);
    byId.set(entry.id, list);
  }

  for (const [id, paths] of byId) {
    if (paths.length > 1) {
      collisions.push({ id, paths: [...paths].sort() });
    }
  }

  return collisions.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Filename `{id}.json` must match document `id`.
 */
export function filenameMatchesId(path: string, id: string): boolean {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? path;
  return base === prayerFilename(id);
}

export function isLibraryManifest(data: unknown): data is LibraryManifest {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  if (obj.description !== undefined && typeof obj.description !== "string") {
    return false;
  }
  if (obj.defaultVariant !== undefined) {
    const dv = obj.defaultVariant;
    if (typeof dv !== "object" || dv === null) return false;
    const d = dv as Record<string, unknown>;
    if (typeof d.lang !== "string" || typeof d.variant !== "string") {
      return false;
    }
  }
  if (obj.stylePrefixStem !== undefined) {
    if (typeof obj.stylePrefixStem !== "string") return false;
    if (!isValidStylePrefixStem(obj.stylePrefixStem)) return false;
  }
  return true;
}

/** Keep only known manifest fields (drops legacy name/version etc.). */
export function normalizeLibraryManifest(
  data: LibraryManifest,
): LibraryManifest {
  const manifest: LibraryManifest = {};
  if (data.description !== undefined) {
    manifest.description = data.description;
  }
  if (data.defaultVariant !== undefined) {
    manifest.defaultVariant = {
      lang: data.defaultVariant.lang,
      variant: data.defaultVariant.variant,
    };
  }
  if (
    data.stylePrefixStem !== undefined &&
    data.stylePrefixStem !== "" &&
    isValidStylePrefixStem(data.stylePrefixStem)
  ) {
    manifest.stylePrefixStem = data.stylePrefixStem;
  }
  return manifest;
}
