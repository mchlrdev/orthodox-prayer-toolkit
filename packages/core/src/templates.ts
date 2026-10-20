import {
  isKindPreset,
  type KindDef,
  type Prayer,
  type ValidationError,
} from "./types.js";
import { declareKinds, mergeKindDefs, renameKindDef, withKinds } from "./kinds.js";
import { normalizeFormatVersion } from "./formatVersion.js";
import { isValidKindId } from "./validateStyles.js";

/**
 * Library kind template (`.orthodox-prayer-toolkit/templates.json`): a named
 * set of custom kinds stamped into new prayers. Prayers keep no link to it.
 */
export type KindTemplate = {
  /** Slug, unique within the library. */
  id: string;
  /** Non-empty display label. */
  label: string;
  /** Same entry rules as `Prayer.kinds`; may be empty. */
  kinds: KindDef[];
};

/** Shape of `templates.json`. */
export type KindTemplatesFile = {
  templates: KindTemplate[];
};

export type TemplatesValidationResult =
  | { ok: true; templates: KindTemplate[] }
  | { ok: false; errors: ValidationError[] };

export const TEMPLATE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidTemplateId(id: string): boolean {
  return TEMPLATE_ID_PATTERN.test(id);
}

/**
 * Slug template id from a label (diacritics folded, `template` when nothing
 * is left), unique among `existing`: `hymns`, `hymns-2`, …
 */
export function templateIdFromLabel(
  label: string,
  existing: Iterable<string>,
): string {
  const taken = new Set(existing);
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "template";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeKindList(
  raw: unknown,
  path: string,
  errors: ValidationError[],
): KindDef[] {
  if (!Array.isArray(raw)) {
    errors.push({ path, message: "kinds must be an array" });
    return [];
  }
  const kinds: KindDef[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of raw.entries()) {
    const at = `${path}/${i}`;
    if (!isPlainObject(entry)) {
      errors.push({ path: at, message: "kind entry must be an object" });
      continue;
    }
    const extra = Object.keys(entry).find((k) => k !== "id" && k !== "speaker");
    if (extra !== undefined) {
      errors.push({ path: `${at}/${extra}`, message: `Unexpected property "${extra}"` });
      continue;
    }
    const { id, speaker } = entry;
    if (typeof id !== "string" || !isValidKindId(id)) {
      errors.push({ path: `${at}/id`, message: "invalid kind id" });
      continue;
    }
    if (isKindPreset(id)) {
      errors.push({ path: `${at}/id`, message: `Preset kind "${id}" must not be listed` });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ path: `${at}/id`, message: `Duplicate kind "${id}"` });
      continue;
    }
    if (speaker !== undefined && speaker !== true) {
      errors.push({ path: `${at}/speaker`, message: "speaker must be true or omitted" });
      continue;
    }
    seen.add(id);
    kinds.push(speaker ? { id, speaker: true } : { id });
  }
  return kinds;
}

/**
 * Best-effort parse of `templates.json`: keep valid templates and kind
 * entries, collect errors for the rest.
 */
export function sanitizeTemplates(data: unknown): {
  templates: KindTemplate[];
  errors: ValidationError[];
} {
  if (!isPlainObject(data) || !Array.isArray(data.templates)) {
    return {
      templates: [],
      errors: [{ path: "/templates", message: "templates must be an array" }],
    };
  }
  const errors: ValidationError[] = [];
  const templates: KindTemplate[] = [];
  const ids = new Set<string>();
  for (const [i, raw] of data.templates.entries()) {
    const at = `/templates/${i}`;
    if (!isPlainObject(raw)) {
      errors.push({ path: at, message: "template must be an object" });
      continue;
    }
    const extra = Object.keys(raw).find(
      (k) => k !== "id" && k !== "label" && k !== "kinds",
    );
    if (extra !== undefined) {
      errors.push({ path: `${at}/${extra}`, message: `Unexpected property "${extra}"` });
      continue;
    }
    const { id, label } = raw;
    if (typeof id !== "string" || !isValidTemplateId(id)) {
      errors.push({ path: `${at}/id`, message: "invalid template id" });
      continue;
    }
    if (ids.has(id)) {
      errors.push({ path: `${at}/id`, message: `Duplicate template id "${id}"` });
      continue;
    }
    if (typeof label !== "string" || label.trim() === "") {
      errors.push({ path: `${at}/label`, message: "label must be a non-empty string" });
      continue;
    }
    ids.add(id);
    templates.push({ id, label, kinds: sanitizeKindList(raw.kinds, `${at}/kinds`, errors) });
  }
  return { templates, errors };
}

/**
 * Strict `templates.json` validation (same pattern as `validateStyles`).
 * Fails on any invalid entry — use before persisting.
 */
export function validateTemplates(data: unknown): TemplatesValidationResult {
  const { templates, errors } = sanitizeTemplates(data);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, templates };
}

/**
 * Stamp a template into a new prayer: its `kinds` become a copy of the
 * template's (omitted for no template or an empty one).
 */
export function stampTemplate(
  prayer: Prayer,
  template: KindTemplate | null | undefined,
): Prayer {
  const kinds = (template?.kinds ?? []).map((k) => ({ ...k }));
  return normalizeFormatVersion(withKinds(prayer, kinds));
}

/**
 * Apply a template to an existing prayer: additive merge — missing kinds
 * are appended in template order, existing entries stay unchanged.
 */
export function applyTemplate(prayer: Prayer, template: KindTemplate): Prayer {
  return declareKinds(prayer, template.kinds);
}

/** Rename a kind in every template (part of a library-wide kind rename). */
export function renameTemplateKind(
  templates: readonly KindTemplate[],
  from: string,
  to: string,
): KindTemplate[] {
  return templates.map((t) => {
    const kinds = renameKindDef(t.kinds, from, to);
    return kinds === t.kinds ? t : { ...t, kinds };
  });
}

/** Remove a kind from every template. */
export function removeTemplateKind(
  templates: readonly KindTemplate[],
  kind: string,
): KindTemplate[] {
  return templates.map((t) =>
    t.kinds.some((k) => k.id === kind)
      ? { ...t, kinds: t.kinds.filter((k) => k.id !== kind) }
      : t,
  );
}

/**
 * Template editor: append a kind to a template's list (presets, invalid ids
 * and ids already listed are ignored). Returns `template` when unchanged.
 */
export function addTemplateKind(template: KindTemplate, def: KindDef): KindTemplate {
  if (!isValidKindId(def.id)) return template;
  const kinds = mergeKindDefs(template.kinds, [def]);
  return kinds === template.kinds ? template : { ...template, kinds };
}

/** Template editor: set or clear the speaker flag of a listed kind. */
export function setTemplateKindSpeaker(
  template: KindTemplate,
  kind: string,
  allowed: boolean,
): KindTemplate {
  const current = template.kinds.find((k) => k.id === kind);
  if (!current || (current.speaker === true) === allowed) return template;
  return {
    ...template,
    kinds: template.kinds.map((k) =>
      k.id === kind ? (allowed ? { id: kind, speaker: true } : { id: kind }) : k,
    ),
  };
}

/** Template editor: move a listed kind one step up (-1) or down (1). */
export function moveTemplateKind(
  template: KindTemplate,
  kind: string,
  dir: -1 | 1,
): KindTemplate {
  const index = template.kinds.findIndex((k) => k.id === kind);
  const target = index + dir;
  if (index < 0 || target < 0 || target >= template.kinds.length) return template;
  const kinds = [...template.kinds];
  [kinds[index], kinds[target]] = [kinds[target]!, kinds[index]!];
  return { ...template, kinds };
}
