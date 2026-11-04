import type { ActiveVariant } from "./variant";

let names: Intl.DisplayNames | null | undefined;

/** "German" for "de"; the code itself when the platform does not know it. */
export function languageName(lang: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(["en"], { type: "language" });
    } catch {
      names = null;
    }
  }
  try {
    const name = names?.of(lang);
    return name && name.toLowerCase() !== lang.toLowerCase() ? name : lang;
  } catch {
    return lang;
  }
}

/** "German", or "German (Kyiv)" when the edition is not the standard one. */
export function variantName(v: ActiveVariant): string {
  const name = languageName(v.lang);
  return v.variant && v.variant !== "standard" ? `${name} (${v.variant})` : name;
}
