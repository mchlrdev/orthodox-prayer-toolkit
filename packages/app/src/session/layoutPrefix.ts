import {
  resolveLibraryStylePrefixStem,
  type LibraryManifest,
} from "@orthodox-prayer-toolkit/core";

/**
 * Effective Layout prefix stem for the Export modal.
 *
 * - Per-prayer prefs stem if the key is present (including empty → bare names)
 * - Else library → `opt` chain
 */
export function resolveExportPrefixStem(options: {
  prefsStem: string | undefined;
  hasPrefsStem: boolean;
  libraryManifest: LibraryManifest | null | undefined;
}): string {
  if (options.hasPrefsStem) {
    return options.prefsStem ?? "";
  }
  return resolveLibraryStylePrefixStem(
    options.libraryManifest?.stylePrefixStem,
  );
}
