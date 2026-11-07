/**
 * Reading settings for the editor only (App settings): how wide a column gets
 * and which font and size each language shows in. Never in the Prayer JSON,
 * styles.json or an export.
 */

export type ColumnWidth = "narrow" | "medium" | "wide";

export const DEFAULT_COLUMN_WIDTH: ColumnWidth = "medium";

/** In em of the editor text size, so the line length stays when the text grows. */
const COLUMN_WIDTH_EM: Record<ColumnWidth, number> = { narrow: 32, medium: 44, wide: 64 };

export function columnWidthCss(width: ColumnWidth): string {
  return `${COLUMN_WIDTH_EM[width]}em`;
}

export function isColumnWidth(value: unknown): value is ColumnWidth {
  return value === "narrow" || value === "medium" || value === "wide";
}

export type LanguageFont = {
  /** Font installed on this computer; none = the Prayer font. */
  family?: string;
  /** Size in percent of the editor text size. */
  size: number;
};

export type LanguageFonts = Record<string, LanguageFont>;

export const LANGUAGE_FONT_SIZE_MIN = 50;
export const LANGUAGE_FONT_SIZE_MAX = 250;

function clampSize(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.min(LANGUAGE_FONT_SIZE_MAX, Math.max(LANGUAGE_FONT_SIZE_MIN, Math.round(n)));
}

/** What localStorage holds, without anything broken. */
export function readLanguageFonts(value: unknown): LanguageFonts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fonts: LanguageFonts = {};
  for (const [lang, raw] of Object.entries(value)) {
    if (!isLangCode(lang) || !raw || typeof raw !== "object") continue;
    const { family, size } = raw as { family?: unknown; size?: unknown };
    fonts[lang] = {
      ...(typeof family === "string" && family.trim() ? { family: family.trim() } : {}),
      size: clampSize(size),
    };
  }
  return fonts;
}

function isLangCode(lang: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(lang);
}

/** A quoted CSS string; font names are free text, the rule must stay one rule. */
function cssString(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&").replace(/[\n\r\f<>{}]/g, " ")}"`;
}

/** The rules for one language: the cell sets the size (Kind sizes are em), the text the font. */
export function languageFontCss(fonts: LanguageFonts): string {
  const rules: string[] = [];
  for (const [lang, font] of Object.entries(fonts)) {
    if (!isLangCode(lang)) continue;
    const cell = `.split-cell[data-lang="${lang}"]`;
    if (font.size !== 100) rules.push(`${cell} { font-size: ${clampSize(font.size)}%; }`);
    if (font.family) rules.push(`${cell} .inline-content { font-family: ${cssString(font.family)}, var(--opt-prayer-font); }`);
  }
  return rules.join("\n");
}

/** Languages liturgical text comes in, with a line to try a font on. */
const SAMPLES: Record<string, string> = {
  am: "እግዚኦ ተሣሃለነ",
  ar: "يا رب ارحم",
  cop: "Ⲕⲩⲣⲓⲉ ⲉⲗⲉⲏⲥⲟⲛ",
  cu: "Гдⷭ҇и помилꙋй",
  de: "Herr, erbarme dich",
  el: "Κύριε ἐλέησον",
  en: "Lord, have mercy",
  fa: "خداوندا رحم کن",
  fr: "Seigneur, aie pitié",
  he: "אדוני רחם",
  hy: "Տէր, ողորմեա",
  ka: "უფალო, შეგვიწყალენ",
  ro: "Doamne, miluiește",
  ru: "Господи, помилуй",
  sr: "Господе, помилуј",
  syr: "ܡܪܝܐ ܪܚܡ ܥܠܝܢ",
  uk: "Господи, помилуй",
};

export const SAMPLE_LANGUAGES = Object.keys(SAMPLES);

export function languageSample(lang: string): string {
  return SAMPLES[lang] ?? SAMPLES[lang.split("-")[0]!] ?? "Lord, have mercy";
}
