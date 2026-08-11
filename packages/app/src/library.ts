import {
  findIdCollisions,
  filenameMatchesId,
  indexKinds,
  indexVariants,
  isLibraryManifest,
  isPrayerFilename,
  normalizeLibraryManifest,
  prayerFilename,
  resolveDisplayTitle,
  sanitizeStyles,
  validate,
  type IdCollision,
  type IndexedVariant,
  type LibraryManifest,
  type Prayer,
  type StyleMap,
  type ValidationError,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../electron/preload";

export type LibraryEntry = {
  path: string;
  id: string | null;
  title: string | null;
  description: string | null;
  valid: boolean;
  errors: ValidationError[];
  filenameMismatch: boolean;
};

export type OpenedLibrary = {
  root: string;
  entries: LibraryEntry[];
  collisions: IdCollision[];
  kinds: string[];
  /** Unique lang/variant pairs found in valid prayers. */
  variants: IndexedVariant[];
  manifest: LibraryManifest | null;
  libraryStyles: StyleMap;
  /** Non-fatal style JSON problems (hostile/unknown fields stripped). */
  styleErrors: ValidationError[];
};

function parseJsonSafe(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function loadLibrary(
  root: string,
  api: PrayerToolkitApi,
): Promise<OpenedLibrary> {
  const files = await api.listJsonFiles(root);

  let manifest: LibraryManifest | null = null;
  if (files.includes("manifest.json")) {
    const raw = await api.readText(root, "manifest.json");
    const data = parseJsonSafe(raw);
    if (data && isLibraryManifest(data)) {
      manifest = normalizeLibraryManifest(data);
    }
  }

  let libraryStyles: StyleMap = {};
  let styleErrors: ValidationError[] = [];
  const stylesRaw = await api.readLibraryStyles(root);
  if (stylesRaw) {
    const parsed = parseJsonSafe(stylesRaw);
    if (parsed !== null) {
      const sanitized = sanitizeStyles(parsed);
      libraryStyles = sanitized.styles;
      styleErrors = sanitized.errors;
    } else {
      styleErrors = [{ path: "/", message: "Invalid styles JSON" }];
    }
  }

  const prayerFiles = files.filter(isPrayerFilename);
  const entries: LibraryEntry[] = [];
  const validPrayers: Prayer[] = [];
  const preferred = manifest?.defaultVariant ?? null;

  for (const path of prayerFiles) {
    const raw = await api.readText(root, path);
    const data = parseJsonSafe(raw);
    if (data === null) {
      entries.push({
        path,
        id: null,
        title: null,
        description: null,
        valid: false,
        errors: [{ path: "/", message: "Invalid JSON" }],
        filenameMismatch: false,
      });
      continue;
    }

    const result = validate(data);
    if (!result.ok) {
      const maybeId =
        typeof (data as { id?: unknown }).id === "string"
          ? (data as { id: string }).id
          : null;
      entries.push({
        path,
        id: maybeId,
        title: null,
        description: null,
        valid: false,
        errors: result.errors,
        filenameMismatch: maybeId ? !filenameMatchesId(path, maybeId) : false,
      });
      continue;
    }

    validPrayers.push(result.prayer);
    entries.push({
      path,
      id: result.prayer.id,
      title: resolveDisplayTitle(result.prayer, preferred),
      description: result.prayer.description ?? null,
      valid: true,
      errors: [],
      filenameMismatch: !filenameMatchesId(path, result.prayer.id),
    });
  }

  entries.sort((a, b) => (a.id ?? a.path).localeCompare(b.id ?? b.path));

  const collisions = findIdCollisions(
    entries.map((e) => ({ path: e.path, id: e.id })),
  );

  return {
    root,
    entries,
    collisions,
    kinds: indexKinds(validPrayers),
    variants: indexVariants(validPrayers),
    manifest,
    libraryStyles,
    styleErrors,
  };
}

export function emptyPrayer(id: string): Prayer {
  return {
    id,
    type: "prayer",
    tone: null,
    variants: [
      {
        lang: "de",
        variant: "standard",
        title: "Unbenannt",
        license: "unknown",
        source: "draft",
      },
    ],
    structure: [
      {
        id: "b1",
        kind: "verse",
        translations: [],
      },
    ],
  };
}

export { prayerFilename };
