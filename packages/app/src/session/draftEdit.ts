import {
  validate,
  type Prayer,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";
import {
  reconcileVisibleVariants,
  type ActiveVariant,
} from "../variant";
import type { SessionDraft } from "./types";

/** Delay before re-validating after an editor edit (snappy typing). */
export const DRAFT_VALIDATE_DEBOUNCE_MS = 500;

/** Immediate edit: reconcile columns; keep prior errors until validate catches up. */
export function applyDraftEdit(
  next: Prayer,
  visibleVariants: ActiveVariant[],
  previousErrors: ValidationError[] = [],
): SessionDraft {
  const nextVariants = reconcileVisibleVariants(
    visibleVariants,
    next.variants,
    visibleVariants[0] ?? null,
  );
  return {
    prayer: next,
    errors: previousErrors,
    visibleVariants: nextVariants,
    dirty: true,
  };
}

export function validationErrorsFor(prayer: Prayer): ValidationError[] {
  const result = validate(prayer);
  return result.ok ? [] : result.errors;
}
