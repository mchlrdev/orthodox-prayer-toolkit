import {
  exportHtml,
  exportLayoutDocx,
  exportLayoutDocxParallel,
  exportLayoutRtf,
  exportVariant,
  parseHtmlAttributes,
  type ParallelSpeakerExportOptions,
  type Prayer,
  type SpeakerExportOptions,
  type StyleMap,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import type { ExportFormat, LayoutFormat } from "../exportPrefs";
import type { ActiveVariant } from "../variant";

export type { ExportFormat };

/** True when any block carries a speaker (gates the Speakers export UI). */
export function prayerHasSpeakers(prayer: Prayer): boolean {
  return prayer.structure.some(
    (b) => typeof b.speaker === "string" && b.speaker.length > 0,
  );
}

export type SeparatorPreset = "colon" | "dot" | "none" | "custom";

/** Preset → separator string handed to Core (core adds the single space). */
export function separatorFromPreset(
  preset: Exclude<SeparatorPreset, "custom">,
): string {
  return preset === "colon" ? ": " : preset === "dot" ? ". " : "";
}

/** Which preset a stored separator corresponds to (anything else is custom). */
export function presetFromSeparator(separator: string): SeparatorPreset {
  if (separator === ": ") return "colon";
  if (separator === ". ") return "dot";
  if (separator === "") return "none";
  return "custom";
}

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
  speakers?: Partial<SpeakerExportOptions>;
};

export type ParallelExportRequest = {
  columns: [ActiveVariant, ActiveVariant];
  /** Empty string → bare kind / note style names. */
  prefixStem: string;
  /** Empty middle column so Word can drag the gap. */
  gutterColumn?: boolean;
  /** Empty column after Speaker (Own column). Default on. */
  speakerGutterColumn?: boolean;
  speakers?: Partial<ParallelSpeakerExportOptions>;
};

export type ExportOptions = {
  includeBlocksWithoutTranslation?: boolean;
  styles?: StyleMap;
  html?: HtmlExportRequest;
  /** Speaker options for HTML export (ignored when the prayer has none). */
  speakers?: Partial<SpeakerExportOptions>;
  layout?: LayoutExportRequest;
  parallel?: ParallelExportRequest;
};

/** Flat-JSON, HTML, Layout, or two-column Word table export via the save dialog. */
export async function exportPrayerVariant(
  api: PrayerToolkitApi,
  prayer: Prayer,
  variant: ActiveVariant,
  format: ExportFormat = "flat-json",
  options: ExportOptions = {},
): Promise<string | null> {
  const includeBlocksWithoutTranslation =
    options.includeBlocksWithoutTranslation === true;

  const hasSpeakers = prayerHasSpeakers(prayer);

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
      styles: options.styles,
      includeBlocksWithoutTranslation,
      ...(hasSpeakers && options.speakers
        ? { speakers: options.speakers }
        : {}),
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

  if (format === "docx-parallel") {
    const parallel = options.parallel;
    if (!parallel) {
      throw new Error("Word table export settings are required");
    }
    const [left, right] = parallel.columns;
    // Always skip rows with no text in either column; empty cells already
    // keep alignment when only one language is missing.
    const content = await exportLayoutDocxParallel(prayer, {
      columns: [
        { lang: left.lang, variant: left.variant },
        { lang: right.lang, variant: right.variant },
      ],
      prefixStem: parallel.prefixStem,
      styles: options.styles,
      gutterColumn: parallel.gutterColumn !== false,
      speakerGutterColumn: parallel.speakerGutterColumn !== false,
      ...(hasSpeakers && parallel.speakers
        ? { speakers: parallel.speakers }
        : {}),
    });
    const name = `${prayer.id}.${left.lang}.${left.variant}.${right.lang}.${right.variant}.docx`;
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
      styles: options.styles,
      ...(hasSpeakers && layout.speakers
        ? { speakers: layout.speakers }
        : {}),
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
