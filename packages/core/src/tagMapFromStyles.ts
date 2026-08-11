import type { StyleMap } from "./types.js";
import { isAllowedHtmlTag } from "./htmlTags.js";

/** Build a kind→tag map from resolved styles (only allowlisted tags). */
export function tagMapFromStyles(styles: StyleMap): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [kind, style] of Object.entries(styles)) {
    const tag = style.htmlTag;
    if (tag && isAllowedHtmlTag(tag)) {
      map[kind] = tag;
    }
  }
  return map;
}
