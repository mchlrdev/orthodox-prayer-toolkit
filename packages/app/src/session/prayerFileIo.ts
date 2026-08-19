import {
  isPrayerFilename,
  prayerFilename,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import type { CatalogEntry } from "../catalog";
import {
  evictPreviousClean,
  putPrayerFromText,
} from "./operations";
import type { PrayerSessionState, SessionOpResult } from "./types";

export type ImportedPrayerPath =
  | { ok: true; path: string; id: string | null }
  | { ok: false; message: string };

function fileBasename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function prayerIdFromText(content: string): string | null {
  const data = parseJson(content);
  if (typeof data !== "object" || data === null || !("id" in data)) {
    return null;
  }
  return typeof data.id === "string" && data.id.length > 0 ? data.id : null;
}

function isFlatPrayerPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.includes("/")) return false;
  return isPrayerFilename(normalized);
}

/** Target `{id}.json` in the library root, or the source basename if no id. */
export function resolveImportedPrayerPath(
  sourceName: string,
  content: string,
): ImportedPrayerPath {
  const sourceBase = fileBasename(sourceName);
  const id = prayerIdFromText(content);
  const path = id ? prayerFilename(id) : sourceBase;
  if (!isFlatPrayerPath(path)) {
    return {
      ok: false,
      message: `Cannot import “${sourceBase}” as a prayer file.`,
    };
  }
  return { ok: true, path, id };
}

/** Save the complete prayer JSON (disk bytes, or the unsaved draft). */
export async function exportPrayerFile(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  entry: CatalogEntry,
): Promise<SessionOpResult & { exportedPath: string | null | false }> {
  if (!state.catalog) {
    return { state, notices: [], exportedPath: false };
  }

  let content: string;
  const draft = state.drafts[entry.path];
  if (draft?.dirty) {
    content = `${JSON.stringify(draft.prayer, null, 2)}\n`;
  } else {
    try {
      content = await api.readText(state.catalog.root, entry.path);
    } catch (err) {
      return {
        state,
        notices: [
          {
            color: "accent",
            title: "Export failed",
            message: err instanceof Error ? err.message : String(err),
          },
        ],
        exportedPath: false,
      };
    }
  }

  const name = entry.id ? prayerFilename(entry.id) : fileBasename(entry.path);
  try {
    const path = await api.saveExport(name, content);
    return {
      state,
      notices: path
        ? [{ color: "dark", title: "Exported", message: path }]
        : [],
      exportedPath: path,
    };
  } catch (err) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Export failed",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
      exportedPath: false,
    };
  }
}

/** Copy a picked prayer JSON into the open library without rewriting it. */
export async function importPrayerFile(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
): Promise<SessionOpResult> {
  if (!state.catalog) return { state, notices: [] };

  let picked: { name: string; content: string } | null;
  try {
    picked = await api.pickPrayerJson();
  } catch (err) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Import failed",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
  if (!picked) return { state, notices: [] };

  const target = resolveImportedPrayerPath(picked.name, picked.content);
  if (!target.ok) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Cannot import",
          message: target.message,
        },
      ],
    };
  }

  const existingByPath = state.catalog.entries.find(
    (e) => e.path === target.path,
  );
  const existingById = target.id
    ? state.catalog.entries.find((e) => e.id === target.id)
    : undefined;
  if (existingByPath || existingById) {
    const clash = existingByPath ?? existingById!;
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Id collision",
          message: `“${target.id ?? target.path}” already exists as ${clash.path}.`,
        },
      ],
    };
  }

  try {
    if (await api.exists(state.catalog.root, target.path)) {
      return {
        state,
        notices: [
          {
            color: "accent",
            title: "Id collision",
            message: `File ${target.path} already exists.`,
          },
        ],
      };
    }
    await api.writeText(state.catalog.root, target.path, picked.content);
  } catch (err) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Import failed",
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  const opened = putPrayerFromText(
    evictPreviousClean(state, target.path),
    target.path,
    picked.content,
  );
  return {
    state: opened.state,
    notices: [
      { color: "dark", title: "Imported", message: target.path },
      ...opened.notices,
    ],
  };
}
