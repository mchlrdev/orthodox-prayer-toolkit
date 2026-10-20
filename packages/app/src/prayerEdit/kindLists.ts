import {
  isKindPreset,
  type KindDef,
  type KindStyle,
  type KindTemplate,
} from "@orthodox-prayer-toolkit/core";

/**
 * Library kinds offered when adding a kind to a list (a prayer's `kinds` or
 * a template's): custom kinds the library knows that are not listed yet,
 * sorted. A new id can still be typed.
 */
export function kindAddChoices(
  libraryKinds: Iterable<string>,
  listed: readonly KindDef[],
): string[] {
  const taken = new Set(listed.map((k) => k.id));
  return [...new Set(libraryKinds)]
    .filter((k) => !isKindPreset(k) && !taken.has(k))
    .sort((a, b) => a.localeCompare(b));
}

/** Kinds "Apply template" would add to a prayer (template order). */
export function templateMissingKinds(
  declared: readonly KindDef[] | undefined,
  template: KindTemplate,
): string[] {
  const have = new Set((declared ?? []).map((k) => k.id));
  return template.kinds.filter((k) => !have.has(k.id)).map((k) => k.id);
}

/** Speaker rule shown for a kind in a prayer (presets are fixed). */
export function kindSpeakerNote(kind: string): string | null {
  if (kind === "verse") return "Speakers: always allowed";
  if (isKindPreset(kind)) return "Speakers: never";
  return null;
}

/** Merge a partial style edit over the current style (no empty optional fields). */
export function patchKindStyle(
  current: KindStyle,
  partial: Partial<KindStyle>,
): KindStyle {
  const next: KindStyle = {
    ...current,
    ...partial,
    fontSize: partial.fontSize ?? current.fontSize,
    color: partial.color ?? current.color,
    fontWeight: partial.fontWeight ?? current.fontWeight,
    fontStyle: partial.fontStyle ?? current.fontStyle,
  };
  if (!next.htmlTag) delete next.htmlTag;
  if (!next.dir) delete next.dir;
  return next;
}
