import {
  exportHtml,
  exportLayoutDocx,
  exportLayoutRtf,
  exportVariant,
  parseHtmlAttributes,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import type { LayoutFormat } from "../exportPrefs";
import type { ActiveVariant } from "../variant";

export type ExportFormat = "flat-json" | "html" | "layout";

export type HtmlExportRequest = {
  tagMap: Record<string, string>;
  wrapperEnabled: boolean;
  wrapperTag: string;
  /** Raw attribute string; must already parse successfully. */
  wrapperAttributes: string;
};

export type LayoutExportRequest = {
  layoutFormat: LayoutFormat;
  /** Empty string → bare kind / note style names. */
  prefixStem: string;
};

export type ExportOptions = {
  includeBlocksWithoutTranslation?: boolean;
  html?: HtmlExportRequest;
  layout?: LayoutExportRequest;
};

/** Flat-JSON, HTML, or Layout export for one language/variant via the save dialog. */
export async function exportPrayerVariant(
  api: PrayerToolkitApi,
  prayer: Prayer,
  variant: ActiveVariant,
  format: ExportFormat = "flat-json",
  options: ExportOptions = {},
): Promise<string | null> {
  const includeBlocksWithoutTranslation =
    options.includeBlocksWithoutTranslation === true;

  if (format === "html") {
    const html = options.html;
    if (!html) {
      throw new Error("HTML export settings are required");
    }
    const parsed = parseHtmlAttributes(html.wrapperAttributes);
    if (!parsed.ok) {
      throw new Error(parsed.errors.join("; "));
    }
    const content = exportHtml(prayer, {
      lang: variant.lang,
      variant: variant.variant,
      tagMap: html.tagMap,
      includeBlocksWithoutTranslation,
      wrapper: html.wrapperEnabled
        ? {
            enabled: true,
            tag: html.wrapperTag,
            attributes: parsed.attributes,
          }
        : { enabled: false },
    });
    const name = `${prayer.id}.${variant.lang}.${variant.variant}.html`;
    return api.saveExport(name, content);
  }

  if (format === "layout") {
    const layout = options.layout;
    if (!layout) {
      throw new Error("Layout export settings are required");
    }
    const layoutOpts = {
      lang: variant.lang,
      variant: variant.variant,
      prefixStem: layout.prefixStem,
      includeBlocksWithoutTranslation,
    };
    if (layout.layoutFormat === "docx") {
      const content = await exportLayoutDocx(prayer, layoutOpts);
      const name = `${prayer.id}.${variant.lang}.${variant.variant}.docx`;
      return api.saveExport(name, content);
    }
    const content = exportLayoutRtf(prayer, layoutOpts);
    const name = `${prayer.id}.${variant.lang}.${variant.variant}.rtf`;
    return api.saveExport(name, content);
  }

  const flat = exportVariant(prayer, {
    lang: variant.lang,
    variant: variant.variant,
    includeBlocksWithoutTranslation,
  });
  const name = `${prayer.id}.${variant.lang}.${variant.variant}.flat.json`;
  return api.saveExport(name, `${JSON.stringify(flat, null, 2)}\n`);
}
