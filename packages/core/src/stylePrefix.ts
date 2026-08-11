/** App-constant fallback when library stem is empty/absent. */
export const DEFAULT_STYLE_PREFIX_STEM = "opt";

const STEM_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/** Empty or `[A-Za-z][A-Za-z0-9]*`. */
export function isValidStylePrefixStem(stem: string): boolean {
  return stem === "" || STEM_PATTERN.test(stem);
}

/**
 * Resolve the library → app-constant stem chain.
 * Empty/absent library stem falls through to `opt`.
 */
export function resolveLibraryStylePrefixStem(
  libraryStem: string | undefined | null,
): string {
  if (libraryStem !== undefined && libraryStem !== null && libraryStem !== "") {
    return libraryStem;
  }
  return DEFAULT_STYLE_PREFIX_STEM;
}

/** Paragraph/character style name: `{stem}_` + name, or bare name when stem empty. */
export function styleNameWithPrefix(stem: string, name: string): string {
  return stem === "" ? name : `${stem}_${name}`;
}
