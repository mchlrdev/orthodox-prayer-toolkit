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

/**
 * Write a prayer to the library, renaming the file (in its folder) when the
 * id changes. A rename never overwrites: it is refused when another catalog
 * entry already has the id or a file appears at the target meanwhile.
 */
export async function persistPrayer(
  api: PrayerToolkitApi,
  libraryRoot: string,
  path: string,
  prayer: Prayer,
  catalogEntries: readonly { path: string; id: string | null }[] = [],
): Promise<PersistResult> {
  const result = validate(prayer);
  if (!result.ok) {
    return {
      ok: false,
      message: `“${prayer.id}”: fix validation errors first.`,
    };
  }

  const targetName = prayerFilename(prayer.id);
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash + 1) : "";
  const currentBase = path.slice(folder.length);
  const content = prayerFileText(result.prayer);
  try {
    if (currentBase === targetName) {
      await api.writeText(libraryRoot, path, content);
      return { ok: true, path };
    }
    const targetPath = folder + targetName;
    const clash = catalogEntries.find(
      (e) => e.id === prayer.id && e.path !== path,
    );
    if (clash) {
      return {
        ok: false,
        message: `Id collision: “${prayer.id}” already exists as ${clash.path}.`,
      };
    }
    if (!(await api.createText(libraryRoot, targetPath, content))) {
      return {
        ok: false,
        message: `Id collision: ${targetPath} already exists.`,
      };
    }
    await api.deleteFile(libraryRoot, path);
    return { ok: true, path: targetPath };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
