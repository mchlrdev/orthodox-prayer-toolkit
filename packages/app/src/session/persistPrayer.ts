import {
  prayerFilename,
  validate,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import type { PersistResult } from "./types";

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

  const content = `${JSON.stringify(prayer, null, 2)}\n`;
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
