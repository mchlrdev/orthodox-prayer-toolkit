import type { ColorSchemePreference } from "./appearancePrefs";

/** Map our preference to Mantine's color scheme API (`auto` = system). */
export function toMantineColorScheme(
  pref: ColorSchemePreference,
): "light" | "dark" | "auto" {
  return pref === "system" ? "auto" : pref;
}
