import {
  normalizeFormatVersion,
  normalizePrayerVariants,
  prayerFilename,
  validate,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import type { PersistResult } from "./types";

/**
 * Canonical on-disk text for a prayer file. `formatVersion` is written (first
 * key) only when needed (3 with declared `kinds`, 2 with speakers); plain
 * files serialize exactly as before, so older apps can still open them.
 */
export function prayerFileText(prayer: Prayer): string {
  const normalized = normalizeFormatVersion(normalizePrayerVariants(prayer));
  const { formatVersion, ...rest } = normalized;
  const ordered = formatVersion === undefined ? rest : { formatVersion, ...rest };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Write a prayer to the library, renaming the file when the id changes. */
export async function persistPrayer(
  api: PrayerToolkitApi,
  libraryRoot: string,
  path: string,
  prayer: Prayer,
): Promise<PersistResult> {
  const result = validate(prayer);
  if (!result.ok) {
    return {
      ok: false,
      message: `“${prayer.id}”: fix validation errors first.`,
    };
  }

  const targetName = prayerFilename(prayer.id);
  const currentBase = path.split("/").pop() ?? path;

  if (currentBase !== targetName) {
    const exists = await api.exists(libraryRoot, targetName);
    if (exists) {
      return {
        ok: false,
        message: `Id collision: ${targetName} already exists.`,
      };
    }
  }

  const content = prayerFileText(result.prayer);
  try {
    if (currentBase !== targetName) {
      await api.writeText(libraryRoot, targetName, content);
      await api.deleteFile(libraryRoot, path);
      return { ok: true, path: targetName };
    }
    await api.writeText(libraryRoot, path, content);
    return { ok: true, path };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
