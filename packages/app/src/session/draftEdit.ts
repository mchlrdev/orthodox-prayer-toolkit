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
  previousWarnings?: ValidationError[],
): SessionDraft {
  const nextVariants = reconcileVisibleVariants(
    visibleVariants,
    next.variants,
    visibleVariants[0] ?? null,
  );
  return {
    prayer: next,
    errors: previousErrors,
    ...(previousWarnings ? { warnings: previousWarnings } : {}),
    visibleVariants: nextVariants,
    dirty: true,
  };
}

export function validationErrorsFor(prayer: Prayer): ValidationError[] {
  const result = validate(prayer);
  return result.ok ? [] : result.errors;
}

/** Errors (block saving) and warnings (informational) from one validate run. */
export function validationFor(prayer: Prayer): {
  errors: ValidationError[];
  warnings: ValidationError[];
} {
  const result = validate(prayer);
  return {
    errors: result.ok ? [] : result.errors,
    warnings: result.warnings,
  };
}
