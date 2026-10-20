import {
  hasLegacyStyleFields,
  isPrayerFilename,
  planLibraryMigration,
  sanitizeStyles,
  validate,
  type LibraryMigrationPlan,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import {
  CATALOG_READ_CHUNK_SIZE,
  parseLibraryStyles,
  parseLibraryTemplates,
  patchCatalogPrayer,
} from "../catalog";
import type { LibraryCatalog } from "../catalog";
import {
  STYLES_UNREADABLE_MESSAGE,
  stylesFileUnreadable,
  templatesFileText,
} from "./libraryFiles";
import { errorNotice } from "./operations";
import { prayerFileText } from "./persistPrayer";
import type {
  LibraryMigrationStatus,
  PrayerSessionState,
  SessionDraft,
  SessionNotice,
  SessionOpResult,
} from "./types";

/**
 * Whether to ask "N prayers use the old format — migrate now?". Counts the
 * catalog entries migrated in memory; legacy `speaker` tokens in styles.json
 * also count (unless templates.json is broken: then they cannot be stripped).
 * Only pending once the scan is complete and the user has not declined.
 */
export function libraryMigrationStatus(
  state: PrayerSessionState,
): LibraryMigrationStatus {
  const catalog = state.catalog;
  if (!catalog) {
    return {
      prayers: 0,
      legacyTokens: false,
      pending: false,
      templatesBroken: false,
      blocked: null,
    };
  }
  const prayers = catalog.entries.filter((e) => e.needsMigration).length;
  const legacyTokens = hasLegacyStyleFields(catalog.libraryStylesRaw);
  const blocked = migrationBlockedReason(catalog, prayers);
  const needed = prayers > 0 || legacyTokens;
  return {
    prayers,
    legacyTokens,
    pending:
      needed && blocked === null && catalog.scanComplete && !state.migrationDismissed,
    templatesBroken: catalog.templateErrors.length > 0,
    blocked: needed ? blocked : null,
  };
}

/**
 * Why the migration cannot run now, or null. While styles.json is not a
 * readable object its legacy speaker tokens are unknown: migrating would
 * declare kinds without their speaker flag and lose it for good. Only
 * legacy tokens left while templates.json is broken: nothing can be written.
 */
function migrationBlockedReason(
  catalog: LibraryCatalog,
  prayers: number,
): string | null {
  if (stylesFileUnreadable(catalog)) return STYLES_UNREADABLE_MESSAGE;
  if (prayers === 0 && catalog.templateErrors.length > 0) {
    return "templates.json has errors. Fix the file first.";
  }
  return null;
}

/** "Not now": leave the files as they are for this library session. */
export function dismissLibraryMigration(
  state: PrayerSessionState,
): PrayerSessionState {
  return { ...state, migrationDismissed: true };
}

/** Confirm text of the migration prompt ("N prayers use the old format …"). */
export function migrationPromptText(status: LibraryMigrationStatus): {
  title: string;
  message: string;
  details: string[];
} {
  const n = status.prayers;
  const title =
    n > 0
      ? `${n} prayer${n === 1 ? " uses" : "s use"} the old format — migrate now?`
      : "Library styles use the old format — migrate now?";
  const details: string[] = [];
  if (n > 0) {
    details.push(
      "Custom kinds a prayer uses are declared in that prayer. Blocks, texts and speakers stay as they are.",
    );
  }
  if (status.legacyTokens) {
    details.push(
      "The Speaker setting of custom kinds moves from styles.json into each prayer's kinds.",
    );
  }
  if (status.templatesBroken) {
    details.push(
      "templates.json has errors, so no “Bisherige Kinds” template is added and the old Speaker settings stay in styles.json until it is fixed.",
    );
  } else {
    details.push(
      "All custom kinds the library knew are kept as the kind template “Bisherige Kinds” (unless it exists).",
    );
  }
  return {
    title,
    message:
      "Old files already open fine (migrated in memory). Not now leaves the files unchanged; saving an edited prayer writes the new format.",
    details,
  };
}

export type LibraryMigrationReport = {
  written: string[];
  /** Paths with unsaved session edits: left alone, their next save migrates. */
  skippedUnsaved: string[];
  failed: { path: string; reason: string }[];
  templatesWritten: boolean;
  stylesWritten: boolean;
};

type DiskPrayer = { path: string; data: Prayer };

type DiskRead = {
  prayers: DiskPrayer[];
  /** Files that could not be read or are not JSON (cannot be migrated). */
  unreadable: { path: string; reason: string }[];
};

/** Every prayer file as on disk; unreadable / non-JSON ones are reported. */
async function readDiskPrayers(
  api: PrayerToolkitApi,
  root: string,
): Promise<DiskRead> {
  const paths = (await api.listJsonFiles(root)).filter(isPrayerFilename);
  const out: DiskRead = { prayers: [], unreadable: [] };
  for (let i = 0; i < paths.length; i += CATALOG_READ_CHUNK_SIZE) {
    const chunk = paths.slice(i, i + CATALOG_READ_CHUNK_SIZE);
    const rows = await api.readTexts(root, chunk);
    const byPath = new Map(rows.map((row) => [row.path, row.text]));
    for (const path of chunk) {
      const text = byPath.get(path);
      if (text === undefined) {
        out.unreadable.push({ path, reason: "could not be read" });
        continue;
      }
      try {
        out.prayers.push({ path, data: JSON.parse(text) as Prayer });
      } catch {
        out.unreadable.push({ path, reason: "invalid JSON" });
      }
    }
  }
  return out;
}

/** Whether every file migrated (nothing skipped or failed). */
export function migrationReportClean(report: LibraryMigrationReport): boolean {
  return report.skippedUnsaved.length === 0 && report.failed.length === 0;
}

/**
 * Why legacy `speaker` tokens are still in styles.json after a migration run
 * that had them (null when they were stripped or there were none).
 */
export function migrationTokensKeptReason(
  report: LibraryMigrationReport,
  legacyTokensBefore: boolean,
): string | null {
  if (!legacyTokensBefore || report.stylesWritten) return null;
  if (!migrationReportClean(report)) {
    return "styles.json still holds the old Speaker settings because not every prayer was migrated. Fix or save the prayers listed above, then migrate again (Library settings).";
  }
  return "styles.json still holds the old Speaker settings (it could not be updated). Migrate again from Library settings.";
}

function reportNotice(report: LibraryMigrationReport): SessionNotice {
  const n = report.written.length;
  const parts = [`${n} prayer${n === 1 ? "" : "s"} migrated`];
  if (report.skippedUnsaved.length > 0) {
    parts.push(`${report.skippedUnsaved.length} with unsaved edits skipped (save them to finish)`);
  }
  if (report.failed.length > 0) {
    parts.push(`${report.failed.length} failed`);
  }
  const clean = migrationReportClean(report);
  return {
    color: clean ? "dark" : "accent",
    title: clean ? "Library migrated" : "Library partly migrated",
    message: parts.join(" · "),
    autoClose: clean ? 5000 : 10000,
  };
}

/**
 * One-time migration to per-prayer kinds (Core `planLibraryMigration` on the
 * files as read from disk now). Write order: prayers (each validated), then
 * `templates.json` (only when the plan has one), then `styles.json` without
 * legacy `speaker` tokens — only when every prayer write succeeded (no
 * skipped unsaved drafts, no failures — a file that cannot be read or is not
 * JSON counts as failed) and the templates were written.
 */
export async function migrateLibrary(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
): Promise<SessionOpResult & { report: LibraryMigrationReport | null }> {
  const catalog0 = state.catalog;
  if (!catalog0) return { state, notices: [], report: null };
  const root = catalog0.root;

  let disk: DiskRead;
  let styles: ReturnType<typeof parseLibraryStyles>;
  let templates: ReturnType<typeof parseLibraryTemplates>;
  let plan: LibraryMigrationPlan;
  try {
    disk = await readDiskPrayers(api, root);
    styles = parseLibraryStyles(await api.readLibraryStyles(root));
    templates = parseLibraryTemplates(await api.readLibraryTemplates(root));
    plan = planLibraryMigration({
      prayers: disk.prayers.map((d) => d.data),
      styles: styles.libraryStylesRaw,
      ...(templates.templatesRaw !== undefined
        ? { templates: templates.templatesRaw }
        : {}),
    });
  } catch (err) {
    return { state, notices: [errorNotice("Migration failed", err)], report: null };
  }

  // Fresh disk read: the files may have changed since the catalog scan.
  const blocked = migrationBlockedReason(
    { ...catalog0, ...styles, ...templates },
    plan.prayers.filter((p) => p.changed).length,
  );
  if (blocked) {
    return {
      state,
      notices: [{ color: "accent", title: "Cannot migrate yet", message: blocked }],
      report: null,
    };
  }

  const report: LibraryMigrationReport = {
    written: [],
    skippedUnsaved: [],
    // Not migratable: counts as failed, so legacy tokens stay (no data loss).
    failed: [...disk.unreadable],
    templatesWritten: false,
    stylesWritten: false,
  };
  let catalog = { ...catalog0, ...styles, ...templates };
  const drafts: Record<string, SessionDraft> = { ...state.drafts };

  for (const [i, { prayer, changed }] of plan.prayers.entries()) {
    if (!changed) continue;
    const path = disk.prayers[i]!.path;
    const draft = drafts[path];
    if (draft?.dirty) {
      report.skippedUnsaved.push(path);
      continue;
    }
    const checked = validate(prayer);
    if (!checked.ok) {
      report.failed.push({ path, reason: "invalid prayer" });
      continue;
    }
    const text = prayerFileText(checked.prayer);
    try {
      await api.writeText(root, path, text);
    } catch (err) {
      report.failed.push({
        path,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    report.written.push(path);
    catalog = patchCatalogPrayer(catalog, path, checked.prayer);
    if (draft) {
      drafts[path] = { ...draft, prayer: checked.prayer, saved: checked.prayer, diskText: text };
    }
  }

  const notices: SessionNotice[] = [];
  let templatesOk = true;
  if (plan.templates) {
    try {
      await api.writeLibraryTemplates(root, templatesFileText(plan.templates));
      report.templatesWritten = true;
      catalog = {
        ...catalog,
        templates: plan.templates,
        templateErrors: [],
        templatesRaw: { templates: plan.templates },
      };
    } catch (err) {
      templatesOk = false;
      notices.push(errorNotice("Could not write templates.json", err));
    }
  }

  const prayersOk = report.skippedUnsaved.length === 0 && report.failed.length === 0;
  if (plan.styles && prayersOk && templatesOk) {
    try {
      await api.writeLibraryStyles(root, `${JSON.stringify(plan.styles, null, 2)}\n`);
      report.stylesWritten = true;
      const sanitized = sanitizeStyles(plan.styles);
      catalog = {
        ...catalog,
        libraryStyles: sanitized.styles,
        styleErrors: sanitized.errors,
        libraryStylesRaw: plan.styles,
      };
    } catch (err) {
      notices.push(errorNotice("Could not write styles.json", err));
    }
  }

  return {
    state: { ...state, catalog, drafts },
    notices: [reportNotice(report), ...notices],
    report,
  };
}
