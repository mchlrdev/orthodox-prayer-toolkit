import type { StyleMap } from "./types.js";
import { LEGACY_STYLE_FIELDS, sanitizeStyles } from "./validateStyles.js";

export { LEGACY_STYLE_FIELDS };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Legacy tokens per kind in a raw `styles.json` object (empty once migrated). */
export function legacyStyleFields(
  raw: unknown,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (!isPlainObject(raw)) return out;
  for (const [kind, style] of Object.entries(raw)) {
    if (!isPlainObject(style)) continue;
    const tokens: Record<string, unknown> = {};
    for (const field of LEGACY_STYLE_FIELDS) {
      if (field in style) tokens[field] = style[field];
    }
    if (Object.keys(tokens).length > 0) out[kind] = tokens;
  }
  return out;
}

export function hasLegacyStyleFields(raw: unknown): boolean {
  return Object.keys(legacyStyleFields(raw)).length > 0;
}

export type StylesFileOptions = {
  /** Kinds whose style is removed on purpose (only legacy tokens survive). */
  remove?: Iterable<string>;
};

/**
 * The object to write to `styles.json` after an edit: the edited (validated)
 * `styles` merged back over the raw file so nothing the app cannot read is
 * lost. Per kind, fields that are valid in the raw file follow the edit (set,
 * changed, or dropped when the edited entry omits them); every other raw
 * field — legacy tokens, unknown or invalid fields — stays untouched unless
 * the edit sets it. Raw entries the edit does not mention (incl. invalid
 * kinds) stay as they are; new kinds are appended. A kind in `remove` keeps
 * only its legacy tokens (migration still needs them).
 *
 * `raw` undefined = no file yet. Any other non-object `raw` (invalid JSON,
 * an array, a number, …) throws: rewriting it would lose the file's content.
 */
export function stylesFileObject(
  styles: StyleMap,
  raw: unknown,
  options: StylesFileOptions = {},
): Record<string, unknown> {
  if (raw === undefined) return { ...styles };
  if (!isPlainObject(raw)) {
    throw new Error("styles.json is not a JSON object; refusing to overwrite it");
  }
  const remove = new Set(options.remove ?? []);
  const readable = sanitizeStyles(raw).styles;
  const out: Record<string, unknown> = {};
  for (const [kind, rawStyle] of Object.entries(raw)) {
    const edited = styles[kind];
    if (!isPlainObject(rawStyle)) {
      if (edited && !remove.has(kind)) out[kind] = { ...edited };
      else if (!remove.has(kind)) out[kind] = rawStyle;
      continue;
    }
    if (remove.has(kind)) {
      const tokens = Object.fromEntries(
        Object.entries(rawStyle).filter(([f]) => LEGACY_STYLE_FIELDS.has(f)),
      );
      if (Object.keys(tokens).length > 0) out[kind] = tokens;
      continue;
    }
    if (!edited) {
      out[kind] = rawStyle;
      continue;
    }
    const valid = readable[kind] ?? {};
    const entry: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(rawStyle)) {
      if (field in edited) entry[field] = edited[field as keyof typeof edited];
      else if (!(field in valid)) entry[field] = value;
    }
    for (const [field, value] of Object.entries(edited)) {
      if (!(field in entry)) entry[field] = value;
    }
    out[kind] = entry;
  }
  for (const [kind, style] of Object.entries(styles)) {
    if (!(kind in out) && !Object.hasOwn(raw, kind) && !remove.has(kind)) {
      out[kind] = { ...style };
    }
  }
  return out;
}

/**
 * Raw styles with every legacy token removed (entries left empty are dropped).
 * `null` when there is nothing to strip.
 */
export function stripLegacyStyleFields(
  raw: unknown,
): Record<string, unknown> | null {
  if (!isPlainObject(raw)) return null;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [kind, style] of Object.entries(raw)) {
    if (
      !isPlainObject(style) ||
      !Object.keys(style).some((f) => LEGACY_STYLE_FIELDS.has(f))
    ) {
      next[kind] = style;
      continue;
    }
    changed = true;
    const kept = Object.fromEntries(
      Object.entries(style).filter(([f]) => !LEGACY_STYLE_FIELDS.has(f)),
    );
    if (Object.keys(kept).length > 0) next[kind] = kept;
  }
  return changed ? next : null;
}

/**
 * Move the entry of kind `from` to `to` in a style map (sanitized or raw
 * `styles.json` object). Same map when `from` has no entry. Throws when `to`
 * already has one: a kind rename never merges styles.
 */
export function renameStyleKey<T>(
  map: Record<string, T>,
  from: string,
  to: string,
): Record<string, T> {
  if (from === to || !Object.hasOwn(map, from)) return map;
  if (Object.hasOwn(map, to)) {
    throw new Error(`Kind style “${to}” already exists`);
  }
  const { [from]: entry, ...rest } = map;
  return { ...rest, [to]: entry as T };
}

/** Drop the entry of `kind`; same map when it has none. */
export function removeStyleKey<T>(
  map: Record<string, T>,
  kind: string,
): Record<string, T> {
  if (!Object.hasOwn(map, kind)) return map;
  const { [kind]: _removed, ...rest } = map;
  return rest;
}
