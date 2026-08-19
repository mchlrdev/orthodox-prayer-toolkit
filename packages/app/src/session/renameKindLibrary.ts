import {
  isKindPreset,
  isPrayerFilename,
  renameKind,
  validate,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import { renameStyleKey } from "../prayerEdit";
import type { SessionDraft } from "./types";

export function prayerUsesKind(prayer: Prayer, kind: string): boolean {
  return prayer.structure.some((b) => b.kind === kind);
}

export type KindRenamePlan = {
  from: string;
  to: string;
  affectedPaths: string[];
};

export async function planKindRename(
  api: PrayerToolkitApi,
  libraryRoot: string,
  from: string,
  to: string,
  opts: {
    unsaved: Record<string, SessionDraft>;
    selectedPath: string | null;
    draft: Prayer | null;
  },
): Promise<KindRenamePlan> {
  if (isKindPreset(from)) {
    return { from, to, affectedPaths: [] };
  }

  const files = (await api.listJsonFiles(libraryRoot)).filter(isPrayerFilename);
  const affectedPaths: string[] = [];

  for (const path of files) {
    const session = opts.unsaved[path];
    const open =
      opts.selectedPath === path && opts.draft ? opts.draft : null;
    const memory = session?.prayer ?? open;

    if (memory) {
      if (prayerUsesKind(memory, from)) affectedPaths.push(path);
      continue;
    }

    try {
      const raw = await api.readText(libraryRoot, path);
      const result = validate(JSON.parse(raw) as unknown);
      if (result.ok && prayerUsesKind(result.prayer, from)) {
        affectedPaths.push(path);
      }
    } catch {
      /* skip */
    }
  }

  return { from, to, affectedPaths };
}

export type KindRenameResult = {
  writtenPaths: string[];
  skipped: { path: string; reason: string }[];
  unsaved: Record<string, SessionDraft>;
  draft: Prayer | null;
  appStyles: StyleMap;
  libraryStyles: StyleMap;
};

async function loadPrayerAtPath(
  api: PrayerToolkitApi,
  libraryRoot: string,
  path: string,
  opts: {
    unsaved: Record<string, SessionDraft>;
    selectedPath: string | null;
    draft: Prayer | null;
  },
): Promise<
  { ok: true; prayer: Prayer } | { ok: false; reason: string }
> {
  const session = opts.unsaved[path];
  if (session) return { ok: true, prayer: session.prayer };
  if (opts.selectedPath === path && opts.draft) {
    return { ok: true, prayer: opts.draft };
  }
  try {
    const raw = await api.readText(libraryRoot, path);
    const result = validate(JSON.parse(raw) as unknown);
    if (!result.ok) return { ok: false, reason: "invalid prayer JSON" };
    return { ok: true, prayer: result.prayer };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Rename a kind across the open library: every affected prayer file,
 * unsaved drafts, the open draft, and app/library style maps.
 */
export async function renameKindAcrossLibrary(
  api: PrayerToolkitApi,
  libraryRoot: string,
  plan: KindRenamePlan,
  opts: {
    unsaved: Record<string, SessionDraft>;
    selectedPath: string | null;
    draft: Prayer | null;
    appStyles: StyleMap;
    libraryStyles: StyleMap;
  },
): Promise<KindRenameResult> {
  const { from, to, affectedPaths } = plan;
  if (isKindPreset(from)) {
    return {
      writtenPaths: [],
      skipped: [],
      unsaved: opts.unsaved,
      draft: opts.draft,
      appStyles: opts.appStyles,
      libraryStyles: opts.libraryStyles,
    };
  }

  const writtenPaths: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  const draft =
    opts.draft && prayerUsesKind(opts.draft, from)
      ? renameKind(opts.draft, from, to)
      : opts.draft;

  const unsaved: Record<string, SessionDraft> = {};
  for (const [path, session] of Object.entries(opts.unsaved)) {
    unsaved[path] = prayerUsesKind(session.prayer, from)
      ? { ...session, prayer: renameKind(session.prayer, from, to) }
      : session;
  }

  const memoryOpts = {
    unsaved,
    selectedPath: opts.selectedPath,
    draft,
  };

  for (const path of affectedPaths) {
    const loaded = await loadPrayerAtPath(api, libraryRoot, path, memoryOpts);
    if (!loaded.ok) {
      skipped.push({ path, reason: loaded.reason });
      continue;
    }

    const next = prayerUsesKind(loaded.prayer, from)
      ? renameKind(loaded.prayer, from, to)
      : loaded.prayer;

    try {
      await api.writeText(
        libraryRoot,
        path,
        `${JSON.stringify(next, null, 2)}\n`,
      );
      writtenPaths.push(path);
    } catch (err) {
      skipped.push({
        path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    writtenPaths,
    skipped,
    unsaved,
    draft,
    appStyles: renameStyleKey(opts.appStyles, from, to),
    libraryStyles: renameStyleKey(opts.libraryStyles, from, to),
  };
}
