import {
  sanitizeStyles,
  stylesFileObject,
  validateStyles,
  validateTemplates,
  type KindTemplate,
  type StyleMap,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import type { LibraryCatalog } from "../catalog";

/**
 * Library files that are not prayers but change how the library reads: an
 * external change to one of them rescans the library.
 */
export function isLibraryMetaPath(path: string): boolean {
  return (
    path === "manifest.json" ||
    path === ".orthodox-prayer-toolkit/styles.json" ||
    path === ".orthodox-prayer-toolkit/templates.json"
  );
}

export type StylesWrite =
  | { ok: true; catalog: LibraryCatalog }
  | { ok: false; errors: ValidationError[] };

/**
 * `styles.json` exists but is not a JSON object (invalid JSON, an array, …):
 * the app must not overwrite it, and the library migration must wait (its
 * legacy speaker tokens cannot be read).
 */
export function stylesFileUnreadable(catalog: LibraryCatalog): boolean {
  const raw = catalog.libraryStylesRaw;
  if (raw === undefined) return false;
  return raw === null || typeof raw !== "object" || Array.isArray(raw);
}

export const STYLES_UNREADABLE_MESSAGE =
  "styles.json is not a valid JSON object. Fix the file first.";

const STYLES_UNREADABLE: ValidationError = {
  path: "/",
  message: STYLES_UNREADABLE_MESSAGE,
};

/**
 * Validate the edited style map and write `styles.json`. Every app write goes
 * through here: Core `stylesFileObject` merges the edit back over the raw
 * file, so legacy tokens and entries / fields the app cannot read are never
 * lost. `raw` defaults to the catalog's raw file (pass a renamed one for
 * renames); `remove` drops kinds on purpose. Refuses while the file on disk
 * is not JSON (rewriting would lose it).
 */
export async function writeLibraryStylesFile(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  styles: StyleMap,
  options: { raw?: unknown; remove?: string[] } = {},
): Promise<StylesWrite> {
  if (stylesFileUnreadable(catalog)) return { ok: false, errors: [STYLES_UNREADABLE] };
  const checked = validateStyles(styles);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const raw = "raw" in options ? options.raw : catalog.libraryStylesRaw;
  const fileObject = stylesFileObject(checked.styles, raw, { remove: options.remove });
  await api.writeLibraryStyles(
    catalog.root,
    `${JSON.stringify(fileObject, null, 2)}\n`,
  );
  const reread = sanitizeStyles(fileObject);
  return {
    ok: true,
    catalog: {
      ...catalog,
      libraryStyles: reread.styles,
      styleErrors: reread.errors,
      libraryStylesRaw: fileObject,
    },
  };
}

export function templatesFileText(templates: readonly KindTemplate[]): string {
  return `${JSON.stringify({ templates }, null, 2)}\n`;
}

export type TemplatesWrite =
  | { ok: true; catalog: LibraryCatalog }
  | { ok: false; message: string };

/**
 * Validate and write `templates.json`. Refuses while the file on disk has
 * problems (rewriting would drop the entries the app could not read).
 */
export async function writeLibraryTemplatesFile(
  api: PrayerToolkitApi,
  catalog: LibraryCatalog,
  templates: readonly KindTemplate[],
): Promise<TemplatesWrite> {
  if (catalog.templateErrors.length > 0) {
    return {
      ok: false,
      message: "templates.json has errors. Fix the file first.",
    };
  }
  const fileObject = { templates };
  const checked = validateTemplates(fileObject);
  if (!checked.ok) {
    return {
      ok: false,
      message: checked.errors.map((e) => e.message).join(" · "),
    };
  }
  await api.writeLibraryTemplates(catalog.root, templatesFileText(checked.templates));
  return {
    ok: true,
    catalog: {
      ...catalog,
      templates: checked.templates,
      templateErrors: [],
      templatesRaw: { templates: checked.templates },
    },
  };
}
