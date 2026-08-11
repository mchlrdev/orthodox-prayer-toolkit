import type { Prayer, ValidationError } from "@orthodox-prayer-toolkit/core";
import type { ActiveVariant } from "../variant";

export type SessionDraft = {
  prayer: Prayer;
  errors: ValidationError[];
  visibleVariants: ActiveVariant[];
};

export type LeaveAction =
  | { type: "close-window" }
  | { type: "reload-library" }
  | { type: "open-folder"; root: string };

export type PersistResult =
  | { ok: true; path: string }
  | { ok: false; message: string };
