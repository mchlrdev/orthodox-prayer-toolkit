import {
  CURRENT_FORMAT_VERSION,
  isKindPreset,
  type KindDef,
  type Prayer,
  type ValidationError,
} from "./types.js";
import { kindDefsUsedBy, mergeKindDefs, withKinds } from "./kinds.js";
import { applyFormatVersion } from "./formatVersion.js";
import { sanitizeTemplates, type KindTemplate } from "./templates.js";
import { isValidKindId } from "./validateStyles.js";
import { stripLegacyStyleFields } from "./styleFile.js";

/** Id of the template that collects a library's pre-migration custom kinds. */
export const LEGACY_KINDS_TEMPLATE_ID = "legacy-kinds";
const LEGACY_KINDS_TEMPLATE_LABEL = "Bisherige Kinds";

export type PrayerMigration = { prayer: Prayer; changed: boolean };

export type MigratePrayerOptions = {
  /** Raw `styles.json` content; its legacy `speaker: "true"` / `true` tokens set `speaker: true`. */
  styles?: unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Kinds whose raw style entry carries the legacy token `speaker: "true"` (or boolean `true`). */
function legacySpeakerKinds(styles: unknown): Set<string> {
  const kinds = new Set<string>();
  if (!isPlainObject(styles)) return kinds;
  for (const [kind, style] of Object.entries(styles)) {
    if (isPlainObject(style) && (style.speaker === "true" || style.speaker === true)) {
      kinds.add(kind);
    }
  }
  return kinds;
}

/** Only prayer-shaped input is migrated; anything else is left to `validate`. */
function isMigratable(data: Prayer): boolean {
  const p = data as unknown;
  if (!isPlainObject(p)) return false;
  if (!Array.isArray(p.structure) || !Array.isArray(p.variants)) return false;
  if (typeof p.formatVersion === "number" && p.formatVersion > CURRENT_FORMAT_VERSION) {
    return false;
  }
  if (p.kinds !== undefined) {
    if (!Array.isArray(p.kinds)) return false;
    if (!p.kinds.every((k) => isPlainObject(k) && typeof k.id === "string")) return false;
  }
  return p.structure.every((b) => isPlainObject(b) && typeof b.kind === "string");
}

/**
 * Bring a pre-`kinds` prayer to the current format. Pure, idempotent and
 * additive: declares every non-preset kind (with a valid id) used in
 * `structure` that `kinds` lacks (first appearance order; `speaker: true` from
 * the legacy style token or when a block of that kind has a speaker), drops an
 * empty `kinds`, then sets `formatVersion`. Existing entries stay unchanged. Blocks, texts, speakers and variants are never
 * touched. Safe on unvalidated JSON: malformed or newer-format input is
 * returned unchanged.
 */
export function migratePrayer(
  prayer: Prayer,
  options: MigratePrayerOptions = {},
): PrayerMigration {
  if (!isMigratable(prayer)) return { prayer, changed: false };
  const speakerKinds = legacySpeakerKinds(options.styles);
  const current = prayer.kinds ?? [];
  const kinds = mergeKindDefs(
    current,
    kindDefsUsedBy(prayer.structure, (kind) => speakerKinds.has(kind)),
  );
  // `kinds: []` is never written: drop it.
  const keep = kinds === current && prayer.kinds?.length !== 0;
  const next = applyFormatVersion(keep ? prayer : withKinds(prayer, kinds));
  return { prayer: next, changed: next !== prayer };
}

export type LibraryMigrationInput = {
  /** Prayers as read from disk (before in-memory migration). */
  prayers: readonly Prayer[];
  /** Raw `styles.json` content, possibly with legacy `speaker` tokens. */
  styles?: unknown;
  /** Raw `templates.json` content; omit when the file does not exist. */
  templates?: unknown;
};

export type LibraryMigrationPlan = {
  /** Same order as the input; write those with `changed`. */
  prayers: PrayerMigration[];
  /** Full template list incl. the new `legacy-kinds` template; `null` = unchanged. */
  templates: KindTemplate[] | null;
  /** Raw styles without legacy `speaker` tokens; `null` = unchanged. */
  styles: Record<string, unknown> | null;
  /**
   * Problems in the input `templates.json`. When non-empty, `templates` and
   * `styles` are `null` (nothing lossy is written; legacy tokens stay until
   * the file is fixed) and only prayers migrate.
   */
  templateErrors: ValidationError[];
  /** True when anything above needs writing. */
  needed: boolean;
};

/**
 * Plan the one-time library migration to per-prayer kinds (pure; the app
 * does the I/O). Write order: prayers, then `templates`, then `styles` —
 * the last only when every prayer write succeeded.
 *
 * The `legacy-kinds` template lists every custom kind the library knew
 * (declared or used in any prayer, plus style keys), sorted, with speaker
 * flags. It is only added while something else migrates (a prayer or legacy
 * style tokens), there is at least one such kind, and no template with that
 * id exists yet — so an already migrated library plans nothing. An invalid
 * `templates.json` is never rewritten (see `templateErrors`).
 */
export function planLibraryMigration(
  input: LibraryMigrationInput,
): LibraryMigrationPlan {
  const { styles } = input;
  const prayers = input.prayers.map((p) => migratePrayer(p, { styles }));
  const { templates, errors: templateErrors } =
    input.templates === undefined
      ? { templates: [], errors: [] }
      : sanitizeTemplates(input.templates);
  if (templateErrors.length > 0) {
    return {
      prayers,
      templates: null,
      styles: null,
      templateErrors,
      needed: prayers.some((p) => p.changed),
    };
  }

  const nextStyles = stripLegacyStyleFields(styles);
  const migrating = prayers.some((p) => p.changed) || nextStyles !== null;

  const speakerKinds = legacySpeakerKinds(styles);
  const known = new Map<string, boolean>();
  const note = (id: string, speaker: boolean): void => {
    if (isKindPreset(id) || !isValidKindId(id)) return;
    known.set(id, (known.get(id) ?? false) || speaker);
  };
  for (const { prayer } of prayers) {
    if (!isMigratable(prayer)) continue;
    for (const def of prayer.kinds ?? []) note(def.id, def.speaker === true);
  }
  if (isPlainObject(styles)) {
    for (const kind of Object.keys(styles)) note(kind, speakerKinds.has(kind));
  }

  let nextTemplates: KindTemplate[] | null = null;
  if (
    migrating &&
    known.size > 0 &&
    !templates.some((t) => t.id === LEGACY_KINDS_TEMPLATE_ID)
  ) {
    const kinds: KindDef[] = [...known.keys()]
      .sort((a, b) => a.localeCompare(b))
      .map((id) => (known.get(id) ? { id, speaker: true } : { id }));
    nextTemplates = [
      ...templates,
      { id: LEGACY_KINDS_TEMPLATE_ID, label: LEGACY_KINDS_TEMPLATE_LABEL, kinds },
    ];
  }

  return {
    prayers,
    templates: nextTemplates,
    styles: nextStyles,
    templateErrors,
    needed: migrating,
  };
}
