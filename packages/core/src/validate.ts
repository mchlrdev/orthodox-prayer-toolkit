import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import prayerSchema from "../schema/prayer.schema.json";
import type { Prayer, ValidationError, ValidationResult } from "./types.js";
import { isInlineContent, normalizeRuns, toRuns } from "./textRuns.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
addFormats(ajv);

const validateSchema = ajv.compile(prayerSchema);

function formatAjvError(error: ErrorObject): ValidationError {
  const path = error.instancePath || "/";
  const message = error.message ?? "Invalid value";
  if (error.keyword === "additionalProperties" && error.params.additionalProperty) {
    return {
      path,
      message: `Unexpected property "${String(error.params.additionalProperty)}"`,
    };
  }
  if (error.keyword === "required" && error.params.missingProperty) {
    return {
      path,
      message: `Missing required property "${String(error.params.missingProperty)}"`,
    };
  }
  return { path, message };
}

function checkInline(
  value: unknown,
  path: string,
  errors: ValidationError[],
): void {
  if (!isInlineContent(value)) {
    errors.push({ path, message: "Invalid inline content" });
    return;
  }
  if (typeof value === "string") return;
  const normalized = normalizeRuns(toRuns(value));
  if (normalized.length === 0) {
    errors.push({ path, message: "Inline runs must not be empty" });
    return;
  }
  if (normalized.every((r) => r.t === "text")) {
    errors.push({
      path,
      message:
        "Run arrays must include at least one note (use a plain string otherwise)",
    });
  }
}

function semanticChecks(prayer: Prayer): ValidationError[] {
  const errors: ValidationError[] = [];

  const blockIds = new Set<string>();
  for (const [i, block] of prayer.structure.entries()) {
    if (blockIds.has(block.id)) {
      errors.push({
        path: `/structure/${i}/id`,
        message: `Duplicate block id "${block.id}"`,
      });
    }
    blockIds.add(block.id);

    const seenKeys = new Set<string>();
    for (const [j, tr] of block.translations.entries()) {
      const key = `${tr.lang}::${tr.variant}`;
      if (seenKeys.has(key)) {
        errors.push({
          path: `/structure/${i}/translations/${j}`,
          message: `Duplicate translation for lang="${tr.lang}" variant="${tr.variant}"`,
        });
      }
      seenKeys.add(key);

      const hasText = tr.text !== undefined;
      const hasLines = Array.isArray(tr.lines);
      if (hasText && hasLines) {
        errors.push({
          path: `/structure/${i}/translations/${j}`,
          message: "Translation must have either text or lines, not both",
        });
      }
      if (hasText) {
        checkInline(tr.text, `/structure/${i}/translations/${j}/text`, errors);
      }
      if (hasLines) {
        for (const [k, line] of tr.lines!.entries()) {
          checkInline(
            line,
            `/structure/${i}/translations/${j}/lines/${k}`,
            errors,
          );
        }
      }
    }
  }

  const variantKeys = new Set<string>();
  for (const [i, v] of prayer.variants.entries()) {
    const key = `${v.lang}::${v.variant}`;
    if (variantKeys.has(key)) {
      errors.push({
        path: `/variants/${i}`,
        message: `Duplicate variant lang="${v.lang}" variant="${v.variant}"`,
      });
    }
    variantKeys.add(key);
  }

  return errors;
}

/**
 * Drop legacy fields so older prayer JSON still validates.
 */
function stripLegacyFields(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return data;
  }
  const obj = data as Record<string, unknown>;
  if (
    typeof obj.meta !== "object" ||
    obj.meta === null ||
    Array.isArray(obj.meta)
  ) {
    return data;
  }
  const meta = obj.meta as Record<string, unknown>;
  if (!("revised_at" in meta)) return data;

  const nextMeta = { ...meta };
  delete nextMeta.revised_at;
  const next = { ...obj };
  if (Object.keys(nextMeta).length === 0) {
    delete next.meta;
  } else {
    next.meta = nextMeta;
  }
  return next;
}

/**
 * Validate unknown JSON as a prayer document.
 * Missing translations are allowed (omit the entry — never empty keys).
 */
export function validate(data: unknown): ValidationResult {
  const prepared = stripLegacyFields(data);
  if (!validateSchema(prepared)) {
    const errors = (validateSchema.errors ?? []).map(formatAjvError);
    return { ok: false, errors };
  }

  const prayer = prepared as Prayer;
  const semantic = semanticChecks(prayer);
  if (semantic.length > 0) {
    return { ok: false, errors: semantic };
  }

  return { ok: true, prayer };
}
