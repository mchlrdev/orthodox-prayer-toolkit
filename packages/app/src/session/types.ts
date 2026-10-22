import type { Prayer, ValidationError } from "@orthodox-prayer-toolkit/core";
import type { CatalogEntry, LibraryCatalog } from "../catalog";
import type { ActiveVariant } from "../variant";
import type { DraftHistory } from "./history";

/** What the library folder watcher saw for an open prayer with local edits. */
export type DiskConflict = "changed" | "deleted";

export type SessionDraft = {
  prayer: Prayer;
  errors: ValidationError[];
  /** Non-blocking findings (e.g. speaker-name-missing); never mark invalid. */
  warnings?: ValidationError[];
  visibleVariants: ActiveVariant[];
  dirty: boolean;
  history?: DraftHistory;
  /** Prayer as last read from / written to disk (dirty after undo = differs). */
  saved?: Prayer;
  /** File text as last read / written; external edits are detected against it. */
  diskText?: string;
  /** Set by the folder watcher when the file changed under unsaved edits. */
  diskConflict?: DiskConflict;
};

export type LeaveAction =
  | { type: "close-window" }
  | { type: "reload-library" }
  | { type: "open-folder"; root: string }
  | { type: "install-update" };

export type PersistResult =
  | { ok: true; path: string }
  | { ok: false; message: string };

export type SessionNotice = {
  color: "dark" | "accent";
  title: string;
  message: string;
  autoClose?: number;
};

export type KindRenamePlan = {
  from: string;
  to: string;
  /** Prayer files that use or declare `from` (written by the rename). */
  affectedPaths: string[];
  /** Ids of kind templates that list `from`. */
  affectedTemplates: string[];
};

/** What the library still needs from the one-time per-prayer-kinds migration. */
export type LibraryMigrationStatus = {
  /** Catalog entries whose file is in the old format (migrated in memory). */
  prayers: number;
  /** `styles.json` still has legacy `speaker` tokens. */
  legacyTokens: boolean;
  /** Ask the user ("N prayers use the old format — migrate now?"). */
  pending: boolean;
  /** templates.json has errors: the "Bisherige Kinds" template is not written. */
  templatesBroken: boolean;
  /** Migration is needed but cannot run until this is fixed (null = can run). */
  blocked: string | null;
};

export type PrayerSessionState = {
  catalog: LibraryCatalog | null;
  drafts: Record<string, SessionDraft>;
  selectedPath: string | null;
  createDraft: Prayer | null;
  createVariant: ActiveVariant | null;
  /** Kind template stamped into `createDraft` (null = presets only). */
  createTemplateId: string | null;
  pendingLeave: LeaveAction | null;
  pendingDelete: CatalogEntry | null;
  pendingKindRename: KindRenamePlan | null;
  /** The user declined the library migration prompt for this library. */
  migrationDismissed: boolean;
};

export type SessionOpResult = {
  state: PrayerSessionState;
  notices: SessionNotice[];
  /** Catalog paths this op removed; merge must not resurrect them. */
  dropCatalogPaths?: string[];
  /** Drafts this op moved to a new path (from → to), e.g. rename on save. */
  movedPaths?: Record<string, string>;
};
