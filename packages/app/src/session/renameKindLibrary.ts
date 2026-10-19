import {
  deleteKind,
  isKindPreset,
  renameKind,
  validate,
  type Prayer,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import { entriesUsingKind, type LibraryCatalog } from "../catalog";
import { removeStyleKey, renameStyleKey } from "../prayerEdit";
import { prayerFileText } from "./persistPrayer";
import type { KindDeletePlan, KindRenamePlan, SessionDraft } from "./types";

export type { KindDeletePlan, KindRenamePlan } from "./types";

export function prayerUsesKind(prayer: Prayer, kind: string): boolean {
  return prayer.structure.some((b) => b.kind === kind);
}

/**
 * Library paths whose prayer uses `kind`: session drafts (their edited
 * state wins), scanned catalog entries, and not-yet-scanned files (read now).
 */
export async function pathsUsingKind(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  kind: string,
  opts: { drafts: Record<string, SessionDraft> },
): Promise<string[]> {
  const affected = new Set<string>();
  const unread: string[] = [];

  for (const [path, draft] of Object.entries(opts.drafts)) {
    if (prayerUsesKind(draft.prayer, kind)) affected.add(path);
  }

  for (const entry of entriesUsingKind(catalog, kind)) {
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
      if (result.ok && prayerUsesKind(result.prayer, kind)) {
        affected.add(path);
      }
    } catch {
      /* skip */
    }
  }

  return [...affected];
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
  return {
    from,
    to,
    affectedPaths: await pathsUsingKind(api, catalog, from, opts),
  };
}

export async function planKindDelete(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  kind: string,
  opts: { drafts: Record<string, SessionDraft> },
): Promise<KindDeletePlan> {
  if (isKindPreset(kind)) return { kind, affectedPaths: [] };
  return { kind, affectedPaths: await pathsUsingKind(api, catalog, kind, opts) };
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

type KindRewrite = {
  kind: string;
  affectedPaths: string[];
  prayer: (prayer: Prayer) => Prayer;
  styles: (styles: StyleMap) => StyleMap;
};

/**
 * Rewrite every prayer of the library that uses `kind` (affected files are
 * written now; session drafts are updated) plus the app / library style maps.
 */
async function rewriteKindAcrossLibrary(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  rewrite: KindRewrite,
  opts: {
    drafts: Record<string, SessionDraft>;
    appStyles: StyleMap;
    libraryStyles: StyleMap;
  },
): Promise<KindRenameResult> {
  const { kind, affectedPaths } = rewrite;
  if (isKindPreset(kind)) {
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
    drafts[path] = prayerUsesKind(session.prayer, kind)
      ? { ...session, prayer: rewrite.prayer(session.prayer) }
      : session;
  }

  for (const path of affectedPaths) {
    const loaded = await loadPrayerAtPath(api, catalog.root, path, drafts);
    if (!loaded.ok) {
      skipped.push({ path, reason: loaded.reason });
      continue;
    }

    const next = prayerUsesKind(loaded.prayer, kind)
      ? rewrite.prayer(loaded.prayer)
      : loaded.prayer;

    try {
      await api.writeText(catalog.root, path, prayerFileText(next));
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
    appStyles: rewrite.styles(opts.appStyles),
    libraryStyles: rewrite.styles(opts.libraryStyles),
  };
}

/**
 * Rename a kind across the open library: every affected prayer file,
 * session drafts, and app/library style maps.
 */
export function renameKindAcrossLibrary(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  plan: KindRenamePlan,
  opts: {
    drafts: Record<string, SessionDraft>;
    appStyles: StyleMap;
    libraryStyles: StyleMap;
  },
): Promise<KindRenameResult> {
  const { from, to } = plan;
  return rewriteKindAcrossLibrary(
    api,
    catalog,
    {
      kind: from,
      affectedPaths: plan.affectedPaths,
      prayer: (p) => renameKind(p, from, to),
      styles: (m) => renameStyleKey(m, from, to),
    },
    opts,
  );
}

/**
 * Delete a custom kind across the open library: its blocks become verse
 * (annotation for verse) in every affected prayer file and session draft,
 * and its style entries are removed.
 */
export function deleteKindAcrossLibrary(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  plan: KindDeletePlan,
  opts: {
    drafts: Record<string, SessionDraft>;
    appStyles: StyleMap;
    libraryStyles: StyleMap;
  },
): Promise<KindRenameResult> {
  const { kind } = plan;
  return rewriteKindAcrossLibrary(
    api,
    catalog,
    {
      kind,
      affectedPaths: plan.affectedPaths,
      prayer: (p) => deleteKind(p, kind),
      styles: (m) => removeStyleKey(m, kind),
    },
    opts,
  );
}
