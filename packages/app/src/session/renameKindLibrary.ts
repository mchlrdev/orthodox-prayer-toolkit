import {
  isKindPreset,
  renameKind,
  validate,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import { entriesUsingKind, type LibraryCatalog } from "../catalog";
import { renameStyleKey } from "../prayerEdit";
import type { KindRenamePlan, SessionDraft } from "./types";

export type { KindRenamePlan } from "./types";

export function prayerUsesKind(prayer: Prayer, kind: string): boolean {
  return prayer.structure.some((b) => b.kind === kind);
}

export async function planKindRename(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  from: string,
  to: string,
  opts: { drafts: Record<string, SessionDraft> },
): Promise<KindRenamePlan> {
  if (isKindPreset(from)) {
    return { from, to, affectedPaths: [] };
  }

  const affected = new Set<string>();
  const unread: string[] = [];

  for (const [path, draft] of Object.entries(opts.drafts)) {
    if (prayerUsesKind(draft.prayer, from)) affected.add(path);
  }

  for (const entry of entriesUsingKind(catalog, from)) {
    if (entry.path in opts.drafts) continue;
    affected.add(entry.path);
  }

  for (const entry of catalog.entries) {
    if (entry.scanned || entry.path in opts.drafts) continue;
    unread.push(entry.path);
  }

  for (const path of unread) {
    try {
      const raw = await api.readText(catalog.root, path);
      const result = validate(JSON.parse(raw) as unknown);
      if (result.ok && prayerUsesKind(result.prayer, from)) {
        affected.add(path);
      }
    } catch {
      /* skip */
    }
  }

  return { from, to, affectedPaths: [...affected] };
}

export type KindRenameResult = {
  writtenPaths: string[];
  written: { path: string; prayer: Prayer }[];
  skipped: { path: string; reason: string }[];
  drafts: Record<string, SessionDraft>;
  appStyles: StyleMap;
  libraryStyles: StyleMap;
};

async function loadPrayerAtPath(
  api: PrayerToolkitApi,
  libraryRoot: string,
  path: string,
  drafts: Record<string, SessionDraft>,
): Promise<{ ok: true; prayer: Prayer } | { ok: false; reason: string }> {
  const session = drafts[path];
  if (session) return { ok: true, prayer: session.prayer };
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
 * session drafts, and app/library style maps.
 */
export async function renameKindAcrossLibrary(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  plan: KindRenamePlan,
  opts: {
    drafts: Record<string, SessionDraft>;
    appStyles: StyleMap;
    libraryStyles: StyleMap;
  },
): Promise<KindRenameResult> {
  const { from, to, affectedPaths } = plan;
  if (isKindPreset(from)) {
    return {
      writtenPaths: [],
      written: [],
      skipped: [],
      drafts: opts.drafts,
      appStyles: opts.appStyles,
      libraryStyles: opts.libraryStyles,
    };
  }

  const writtenPaths: string[] = [];
  const written: { path: string; prayer: Prayer }[] = [];
  const skipped: { path: string; reason: string }[] = [];

  const drafts: Record<string, SessionDraft> = {};
  for (const [path, session] of Object.entries(opts.drafts)) {
    drafts[path] = prayerUsesKind(session.prayer, from)
      ? { ...session, prayer: renameKind(session.prayer, from, to) }
      : session;
  }

  for (const path of affectedPaths) {
    const loaded = await loadPrayerAtPath(api, catalog.root, path, drafts);
    if (!loaded.ok) {
      skipped.push({ path, reason: loaded.reason });
      continue;
    }

    const next = prayerUsesKind(loaded.prayer, from)
      ? renameKind(loaded.prayer, from, to)
      : loaded.prayer;

    try {
      await api.writeText(
        catalog.root,
        path,
        `${JSON.stringify(next, null, 2)}\n`,
      );
      writtenPaths.push(path);
      written.push({ path, prayer: next });
    } catch (err) {
      skipped.push({
        path,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    writtenPaths,
    written,
    skipped,
    drafts,
    appStyles: renameStyleKey(opts.appStyles, from, to),
    libraryStyles: renameStyleKey(opts.libraryStyles, from, to),
  };
}
