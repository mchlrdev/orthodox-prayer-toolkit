import {
  discoverKinds,
  isKindPreset,
  kindDisplayLabel,
  rawPrayerKinds,
  renameKind,
  renameTemplateKind,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import {
  entriesUsingKind,
  readPrayerText,
  type LibraryCatalog,
} from "../catalog";
import { libraryKindSources } from "./kindOps";
import { prayerFileText } from "./persistPrayer";
import type { KindRenamePlan, SessionDraft } from "./types";

export type { KindRenamePlan } from "./types";

/** The prayer uses `kind` on a block or declares it in `kinds`. */
export function prayerHasKind(prayer: Prayer, kind: string): boolean {
  return (
    prayer.structure.some((b) => b.kind === kind) ||
    (prayer.kinds ?? []).some((k) => k.id === kind)
  );
}

type Drafts = Record<string, SessionDraft>;

/** Unscanned library files as text (unreadable ones are left out). */
async function unscannedTexts(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  drafts: Drafts,
): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (const entry of catalog.entries) {
    if (entry.scanned || entry.path in drafts) continue;
    try {
      out.push({ path: entry.path, text: await api.readText(catalog.root, entry.path) });
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * Whether `kind` exists anywhere in the library: a preset, any prayer
 * (drafts, scanned entries incl. files that do not validate, and
 * not-yet-scanned files read now), any template, or any `styles.json` key
 * (sanitized or raw, e.g. a token-only legacy entry).
 */
export async function kindExistsInLibrary(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  kind: string,
  opts: { drafts: Drafts },
): Promise<boolean> {
  if (isKindPreset(kind)) return true;
  const raw = catalog.libraryStylesRaw;
  const rawStyles = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
  const sources = libraryKindSources(catalog, opts.drafts);
  const styles = { ...rawStyles, ...catalog.libraryStyles };
  if (discoverKinds({ ...sources, styles }).includes(kind)) return true;
  for (const { text } of await unscannedTexts(api, catalog, opts.drafts)) {
    try {
      if (rawPrayerKinds(JSON.parse(text)).includes(kind)) return true;
    } catch {
      /* not JSON: its kinds are unknown */
    }
  }
  return false;
}

type KindPaths = {
  paths: string[];
  /** Of `paths`: files that cannot be rewritten (not valid on disk). */
  blocked: { path: string; reason: string }[];
};

async function collectKindPaths(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  kind: string,
  drafts: Drafts,
): Promise<KindPaths> {
  const paths = new Set<string>();
  const blocked: KindPaths["blocked"] = [];

  // An open draft was read from a valid file.
  for (const [path, draft] of Object.entries(drafts)) {
    if (prayerHasKind(draft.prayer, kind)) paths.add(path);
  }

  for (const entry of entriesUsingKind(catalog, kind)) {
    if (entry.path in drafts) continue;
    paths.add(entry.path);
    if (!entry.valid) blocked.push({ path: entry.path, reason: "invalid prayer" });
  }

  for (const { path, text } of await unscannedTexts(api, catalog, drafts)) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      continue; // not JSON: its kinds are unknown
    }
    if (!rawPrayerKinds(data).includes(kind)) continue;
    paths.add(path);
    const read = readPrayerText(text, catalog.libraryStylesRaw);
    if (!read.json || !read.result.ok) blocked.push({ path, reason: "invalid prayer" });
  }

  return { paths: [...paths], blocked };
}

/**
 * Library paths whose prayer uses or declares `kind`: session drafts (their
 * edited state counts), scanned catalog entries (also files that do not
 * validate) and not-yet-scanned files (read now).
 */
export async function pathsWithKind(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  kind: string,
  opts: { drafts: Drafts },
): Promise<string[]> {
  return (await collectKindPaths(api, catalog, kind, opts.drafts)).paths;
}

type DiskPrayer =
  | { ok: true; prayer: Prayer }
  | { ok: false; reason: string };

/** The prayer file as on disk (migrated in memory), or why it cannot be used. */
async function loadDiskPrayer(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  path: string,
): Promise<DiskPrayer> {
  try {
    const raw = await api.readText(catalog.root, path);
    const read = readPrayerText(raw, catalog.libraryStylesRaw);
    if (!read.json) return { ok: false, reason: "invalid JSON" };
    if (!read.result.ok) return { ok: false, reason: "invalid prayer" };
    return { ok: true, prayer: read.result.prayer };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Plan a library-wide rename: affected prayer paths and template ids, plus
 * `blocked` — affected files that cannot be rewritten (not JSON on disk,
 * invalid, unreadable). A plan with `blocked` entries must not be applied:
 * the rename would be partial.
 */
export async function planKindRename(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  from: string,
  to: string,
  opts: { drafts: Drafts },
): Promise<KindRenamePlan & { blocked: { path: string; reason: string }[] }> {
  const empty = { from, to, affectedPaths: [], affectedTemplates: [], blocked: [] };
  if (isKindPreset(from)) return empty;
  const { paths: affectedPaths, blocked } = await collectKindPaths(
    api,
    catalog,
    from,
    opts.drafts,
  );
  const affectedTemplates = catalog.templates
    .filter((t) => t.kinds.some((k) => k.id === from))
    .map((t) => t.id);
  return { from, to, affectedPaths, affectedTemplates, blocked };
}

/** A rename touching more than one prayer, or any template, asks first. */
export function kindRenameNeedsConfirm(plan: KindRenamePlan): boolean {
  return plan.affectedPaths.length > 1 || plan.affectedTemplates.length > 0;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Confirm text for a pending library-wide rename. */
export function kindRenameConfirmMessage(plan: KindRenamePlan): string {
  const parts = [plural(plan.affectedPaths.length, "prayer")];
  if (plan.affectedTemplates.length > 0) {
    parts.push(plural(plan.affectedTemplates.length, "kind template"));
  }
  return `Rename “${kindDisplayLabel(plan.from)}” to “${kindDisplayLabel(plan.to)}” in ${parts.join(" and ")}? This writes those files now.`;
}

export type KindRenameResult = {
  written: { path: string; prayer: Prayer; text: string }[];
  skipped: { path: string; reason: string }[];
  drafts: Drafts;
};

/**
 * Rename a kind in every affected prayer (Core `renameKind`): the file on
 * disk is renamed and written (unsaved edits are never written); an open
 * draft is renamed in memory (incl. its undo history) and its `saved` /
 * `diskText` follow the file, so `dirty` keeps meaning "differs from disk".
 * Templates and styles are handled by the session op.
 */
export async function renameKindAcrossLibrary(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  plan: KindRenamePlan,
  opts: { drafts: Drafts },
): Promise<KindRenameResult> {
  const { from, to, affectedPaths } = plan;
  const written: KindRenameResult["written"] = [];
  const skipped: KindRenameResult["skipped"] = [];
  const drafts: Drafts = { ...opts.drafts };
  if (isKindPreset(from)) return { written, skipped, drafts };

  for (const path of affectedPaths) {
    const draft = opts.drafts[path];
    const disk = await loadDiskPrayer(api, catalog, path);
    // The renamed file content, when it was written.
    let savedNext: { prayer: Prayer; text: string } | null = null;
    if (disk.ok) {
      const next = renameKind(disk.prayer, from, to);
      if (next !== disk.prayer) {
        const text = prayerFileText(next);
        try {
          await api.writeText(catalog.root, path, text);
          written.push({ path, prayer: next, text });
          savedNext = { prayer: next, text };
        } catch (err) {
          skipped.push({
            path,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } else {
      skipped.push({ path, reason: disk.reason });
    }

    if (!draft) continue;
    const clean = !draft.dirty && savedNext !== null;
    const prayer = clean ? savedNext!.prayer : renameKind(draft.prayer, from, to);
    const saved = savedNext ? savedNext.prayer : draft.saved;
    const rename = (p: Prayer): Prayer =>
      p === draft.saved && saved ? saved : renameKind(p, from, to);
    drafts[path] = {
      ...draft,
      prayer,
      saved,
      diskText: savedNext ? savedNext.text : draft.diskText,
      dirty: saved ? prayer !== saved : true,
      history: draft.history && {
        ...draft.history,
        past: draft.history.past.map(rename),
        future: draft.history.future.map(rename),
      },
    };
  }

  return { written, skipped, drafts };
}

/** Templates after renaming `from` → `to` (same array when unaffected). */
export function renamedTemplates(
  catalog: LibraryCatalog,
  from: string,
  to: string,
) {
  const next = renameTemplateKind(catalog.templates, from, to);
  return next.some((t, i) => t !== catalog.templates[i]) ? next : catalog.templates;
}
