/**
 * Kind styles store rem (M = 1rem). The editor paints them as em against
 * the App settings base font size; HTML export keeps the stored rem.
 */
export function kindFontSizeToEditor(cssSize: string): string {
  const m = /^([\d.]+)\s*rem$/i.exec(cssSize.trim());
  if (!m?.[1]) return cssSize;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return cssSize;
  return `${n}em`;
}
