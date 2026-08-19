import type {
  Prayer,
  StyleMap,
  ValidationError,
} from "@orthodox-prayer-toolkit/core";
import type { CatalogEntry, LibraryCatalog } from "../catalog";
import type { ActiveVariant } from "../variant";

export type SessionDraft = {
  prayer: Prayer;
  errors: ValidationError[];
  visibleVariants: ActiveVariant[];
  dirty: boolean;
};

export type LeaveAction =
  | { type: "close-window" }
  | { type: "reload-library" }
  | { type: "open-folder"; root: string };

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
  affectedPaths: string[];
};

export type PrayerSessionState = {
  catalog: LibraryCatalog | null;
  drafts: Record<string, SessionDraft>;
  selectedPath: string | null;
  createDraft: Prayer | null;
  createVariant: ActiveVariant | null;
  appStyles: StyleMap;
  pendingLeave: LeaveAction | null;
  pendingDelete: CatalogEntry | null;
  pendingKindRename: KindRenamePlan | null;
};

export type SessionOpResult = {
  state: PrayerSessionState;
  notices: SessionNotice[];
  /** Catalog paths this op removed; merge must not resurrect them. */
  dropCatalogPaths?: string[];
};
