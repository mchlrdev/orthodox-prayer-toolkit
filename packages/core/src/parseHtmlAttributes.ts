/**
 * Parse a space-separated HTML attribute string into a map.
 * Rejects event handlers (`on*`) and `style`.
 */
export type ParseHtmlAttributesResult =
  | { ok: true; attributes: Record<string, string> }
  | { ok: false; errors: string[] };

const ATTR_NAME = /^[A-Za-z_:][\w:.-]*$/;
const TOKEN =
  /([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function isForbiddenName(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower === "style") return 'attribute "style" is not allowed';
  if (lower.startsWith("on")) return `event handler attribute "${name}" is not allowed`;
  return null;
}

export function parseHtmlAttributes(input: string): ParseHtmlAttributesResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: true, attributes: {} };
  }

  const errors: string[] = [];
  const attributes: Record<string, string> = {};
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(trimmed)) !== null) {
    if (match.index > lastIndex) {
      const gap = trimmed.slice(lastIndex, match.index).trim();
      if (gap.length > 0) {
        errors.push(`unexpected token "${gap}"`);
      }
    }
    lastIndex = TOKEN.lastIndex;

    const name = match[1]!;
    if (!ATTR_NAME.test(name)) {
      errors.push(`invalid attribute name "${name}"`);
      continue;
    }
    const forbidden = isForbiddenName(name);
    if (forbidden) {
      errors.push(forbidden);
      continue;
    }

    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes[name] = value;
  }

  const trailing = trimmed.slice(lastIndex).trim();
  if (trailing.length > 0) {
    errors.push(`unexpected token "${trailing}"`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, attributes };
}
