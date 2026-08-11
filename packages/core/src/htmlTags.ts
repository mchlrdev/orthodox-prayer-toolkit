/** Allowed HTML element names for kind→tag maps and wrappers. */
export const HTML_TAG_ALLOWLIST = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "div",
  "aside",
  "section",
  "blockquote",
  "span",
] as const;

export type HtmlTag = (typeof HTML_TAG_ALLOWLIST)[number];

const ALLOWED = new Set<string>(HTML_TAG_ALLOWLIST);

/** Wrapper root may also be `article` (default). */
export const HTML_WRAPPER_TAG_ALLOWLIST = [
  "article",
  ...HTML_TAG_ALLOWLIST,
] as const;

export type HtmlWrapperTag = (typeof HTML_WRAPPER_TAG_ALLOWLIST)[number];

const WRAPPER_ALLOWED = new Set<string>(HTML_WRAPPER_TAG_ALLOWLIST);

export function isAllowedHtmlTag(tag: string): tag is HtmlTag {
  return ALLOWED.has(tag);
}

export function isAllowedWrapperTag(tag: string): tag is HtmlWrapperTag {
  return WRAPPER_ALLOWED.has(tag);
}

/** Resolve a kind tag map entry; unknown/missing → `div`. */
export function resolveHtmlTag(tag: string | undefined): HtmlTag {
  if (tag && isAllowedHtmlTag(tag)) return tag;
  return "div";
}

/** Resolve wrapper tag; unknown/missing → `article`. */
export function resolveWrapperTag(tag: string | undefined): HtmlWrapperTag {
  if (tag && isAllowedWrapperTag(tag)) return tag;
  return "article";
}
