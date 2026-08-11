import { toRuns, type InlineContent } from "./textRuns.js";
import {
  resolveHtmlTag,
  resolveWrapperTag,
  type HtmlTag,
} from "./htmlTags.js";
import type { Prayer, Translation } from "./types.js";

export type ExportHtmlOptions = {
  lang: string;
  variant: string;
  /** kind → HTML tag; missing or disallowed values become `div`. */
  tagMap?: Record<string, string>;
  wrapper?: {
    enabled: boolean;
    /** Default `article`. */
    tag?: string;
    /** User attributes; override auto-meta keys when present. */
    attributes?: Record<string, string>;
  };
  /**
   * When true, blocks without a translation for the chosen variant are kept
   * as empty elements with `data-kind`. Default / absent: omit them.
   */
  includeBlocksWithoutTranslation?: boolean;
};

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/'/g, "&#39;");
}

function renderInline(content: InlineContent): string {
  return toRuns(content)
    .map((run) => {
      const escaped = escapeText(run.v);
      if (run.t === "note") {
        return `<span data-kind="annotation">${escaped}</span>`;
      }
      return escaped;
    })
    .join("");
}

function renderPayload(tr: Translation): string {
  if (Array.isArray(tr.lines)) {
    return tr.lines.map((line) => renderInline(line)).join("<br>");
  }
  if (tr.text !== undefined) {
    return renderInline(tr.text);
  }
  return "";
}

function openTag(tag: HtmlTag | string, attrs: Record<string, string>): string {
  const parts = [tag];
  for (const [key, value] of Object.entries(attrs)) {
    parts.push(`${key}="${escapeAttr(value)}"`);
  }
  return `<${parts.join(" ")}>`;
}

function autoMetaAttrs(
  prayer: Prayer,
  lang: string,
  variant: string,
  meta: NonNullable<Prayer["variants"][number]>,
): Record<string, string> {
  const attrs: Record<string, string> = {
    lang,
    "data-lang": lang,
    "data-variant": variant,
    "data-title": meta.title,
    "data-license": meta.license,
    "data-source": meta.source,
    "data-type": prayer.type,
  };

  if (prayer.book !== undefined) attrs["data-book"] = prayer.book;
  if (prayer.occasion !== undefined) attrs["data-occasion"] = prayer.occasion;
  if (prayer.tone !== undefined && prayer.tone !== null) {
    attrs["data-tone"] = String(prayer.tone);
  }

  return attrs;
}

const ATTR_META_ORDER = [
  "lang",
  "data-lang",
  "data-variant",
  "data-title",
  "data-license",
  "data-source",
  "data-type",
  "data-book",
  "data-occasion",
  "data-tone",
] as const;

function orderedAttrs(attrs: Record<string, string>): Record<string, string> {
  const ordered: Record<string, string> = {};
  for (const key of ATTR_META_ORDER) {
    if (attrs[key] !== undefined) ordered[key] = attrs[key]!;
  }
  for (const key of Object.keys(attrs).sort()) {
    if (!(key in ordered)) ordered[key] = attrs[key]!;
  }
  return ordered;
}

/**
 * Export a single language/variant as a semantic HTML fragment (no CSS).
 * Blocks without a translation for the chosen variant are omitted
 * unless `includeBlocksWithoutTranslation` is true.
 */
export function exportHtml(
  prayer: Prayer,
  options: ExportHtmlOptions,
): string {
  const {
    lang,
    variant,
    tagMap = {},
    wrapper,
    includeBlocksWithoutTranslation,
  } = options;

  // Ensure variant exists even when wrapper is off (consistent with exportVariant).
  const meta = prayer.variants.find(
    (v) => v.lang === lang && v.variant === variant,
  );
  if (!meta) {
    throw new Error(
      `Variant not found: lang="${lang}" variant="${variant}"`,
    );
  }

  const includeEmpty = includeBlocksWithoutTranslation === true;
  const elements: string[] = [];
  for (const block of prayer.structure) {
    const tr = block.translations.find(
      (t) => t.lang === lang && t.variant === variant,
    );
    if (!tr && !includeEmpty) continue;

    const tag = resolveHtmlTag(tagMap[block.kind]);
    const inner = tr ? renderPayload(tr) : "";
    elements.push(
      `${openTag(tag, { "data-kind": block.kind })}${inner}</${tag}>`,
    );
  }

  const fragment = elements.length === 0 ? "" : `${elements.join("\n")}\n`;

  if (!wrapper?.enabled) {
    return fragment;
  }

  const rootTag = resolveWrapperTag(wrapper.tag);
  const attrs = orderedAttrs({
    ...autoMetaAttrs(prayer, lang, variant, meta),
    ...(wrapper.attributes ?? {}),
  });
  // Never emit prayer/block ids on the wrapper.
  delete attrs["data-id"];
  delete attrs.id;

  const inner = fragment.endsWith("\n") ? fragment.slice(0, -1) : fragment;
  return `${openTag(rootTag, attrs)}${inner}</${rootTag}>\n`;
}
