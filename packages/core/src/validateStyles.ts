import type {
  KindStyle,
  StyleMap,
  ValidationError,
} from "./types.js";
import { isAllowedHtmlTag } from "./htmlTags.js";
import { normalizeStyleColor } from "./styleColor.js";

export type StyleValidationResult =
  | { ok: true; styles: StyleMap }
  | { ok: false; errors: ValidationError[] };

export const KIND_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
export const KIND_ID_MAX_LENGTH = 64;

export function isValidKindId(kind: string): boolean {
  return KIND_ID_PATTERN.test(kind);
}

/** Strip characters that cannot appear in a kind id; used while typing. */
export function sanitizeKindIdInput(raw: string): string {
  return raw
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .replace(/^[^a-zA-Z]+/, "")
    .slice(0, KIND_ID_MAX_LENGTH);
}

const ALLOWED_FIELDS = new Set([
  "fontSize",
  "color",
  "fontWeight",
  "fontStyle",
  "initialCap",
  "indicate",
  "htmlTag",
  "textAlign",
]);

const DANGEROUS = /url\s*\(|expression\s*\(|javascript:|@import|</i;

function isSafeCssLength(value: string): boolean {
  const t = value.trim();
  if (t === "0") return true;
  return /^-?\d+(\.\d+)?(px|rem|em|%)$/i.test(t);
}

function isSafeFontWeight(value: string): boolean {
  return /^(normal|bold|bolder|lighter|[1-9]00)$/i.test(value.trim());
}

function isSafeFontStyle(value: string): boolean {
  return /^(normal|italic|oblique)$/i.test(value.trim());
}

function isSafeTextAlign(value: string): boolean {
  return /^(left|center|justify)$/i.test(value.trim());
}

function fieldError(
  kind: string,
  field: string,
  message: string,
): ValidationError {
  return { path: `/${kind}/${field}`, message };
}

function validateField(
  kind: string,
  field: string,
  value: unknown,
  errors: ValidationError[],
): string | undefined {
  if (typeof value !== "string") {
    errors.push(fieldError(kind, field, "must be a string"));
    return undefined;
  }
  if (value.length > 64) {
    errors.push(fieldError(kind, field, "value too long"));
    return undefined;
  }
  if (DANGEROUS.test(value)) {
    errors.push(fieldError(kind, field, "disallowed CSS value"));
    return undefined;
  }

  switch (field) {
    case "fontSize":
      if (!isSafeCssLength(value)) {
        errors.push(
          fieldError(kind, field, "expected a length like 1rem or 16px"),
        );
        return undefined;
      }
      return value.trim();
    case "color": {
      const token = normalizeStyleColor(value);
      if (token === null) {
        errors.push(
          fieldError(kind, field, 'expected "base", "accent", or a legacy hex'),
        );
        return undefined;
      }
      return token;
    }
    case "fontWeight":
      if (!isSafeFontWeight(value)) {
        errors.push(
          fieldError(kind, field, "expected normal, bold, or 100–900"),
        );
        return undefined;
      }
      return value.trim();
    case "fontStyle":
      if (!isSafeFontStyle(value)) {
        errors.push(
          fieldError(kind, field, "expected normal, italic, or oblique"),
        );
        return undefined;
      }
      return value.trim();
    case "initialCap":
    case "indicate":
      if (value !== "true" && value !== "false") {
        errors.push(fieldError(kind, field, 'expected "true" or "false"'));
        return undefined;
      }
      return value;
    case "htmlTag":
      if (!isAllowedHtmlTag(value.trim())) {
        errors.push(
          fieldError(
            kind,
            field,
            "expected an allowlisted HTML tag (h1–h6, p, div, aside, section, blockquote, span)",
          ),
        );
        return undefined;
      }
      return value.trim();
    case "textAlign":
      if (!isSafeTextAlign(value)) {
        errors.push(
          fieldError(kind, field, "expected left, center, or justify"),
        );
        return undefined;
      }
      return value.trim().toLowerCase();
    default:
      return undefined;
  }
}

/**
 * Best-effort parse: keep valid kind entries, collect errors for the rest.
 * Partial kind objects only include fields that passed (so resolveStyles
 * merge does not overwrite defaults with empty strings).
 */
export function sanitizeStyles(data: unknown): {
  styles: StyleMap;
  errors: ValidationError[];
} {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return {
      styles: {},
      errors: [{ path: "/", message: "styles must be a JSON object" }],
    };
  }

  const errors: ValidationError[] = [];
  const styles: StyleMap = {};

  for (const [kind, rawStyle] of Object.entries(
    data as Record<string, unknown>,
  )) {
    if (!KIND_ID_PATTERN.test(kind)) {
      errors.push({ path: `/${kind}`, message: "invalid kind name" });
      continue;
    }
    if (
      rawStyle === null ||
      typeof rawStyle !== "object" ||
      Array.isArray(rawStyle)
    ) {
      errors.push({
        path: `/${kind}`,
        message: "kind style must be an object",
      });
      continue;
    }

    const entry: Record<string, string> = {};

    for (const [field, value] of Object.entries(
      rawStyle as Record<string, unknown>,
    )) {
      if (!ALLOWED_FIELDS.has(field)) {
        errors.push({
          path: `/${kind}/${field}`,
          message: "unknown style field",
        });
        continue;
      }
      const safe = validateField(kind, field, value, errors);
      if (safe === undefined) continue;
      entry[field] = safe;
    }

    if (Object.keys(entry).length === 0) {
      errors.push({
        path: `/${kind}`,
        message: "kind style has no valid fields",
      });
      continue;
    }

    styles[kind] = entry as KindStyle;
  }

  return { styles, errors };
}

/**
 * Strict style-map validation (same shape as prayer `validate`).
 * Fails if any kind/field is invalid — use before persisting styles.
 */
export function validateStyles(data: unknown): StyleValidationResult {
  const { styles, errors } = sanitizeStyles(data);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, styles };
}
