import { readText, type Source } from "@orthodox-prayer-toolkit/core";
import { readHtml } from "./readHtml";

/** What the Import dialog collected: typed/pasted text, maybe its HTML. */
export type ImportInput = {
  text: string;
  /** HTML behind the text (clipboard or dropped file), when still unedited. */
  html: string | null;
  /** File name of a dropped file. */
  fileName: string | null;
};

export type ReadInputResult = {
  source: Source;
  /** Suggested Variant `source` (site or file) when the user gave none. */
  originHint: string | null;
};

type Fetch = (url: string) => Promise<{ url: string; contentType: string; text: string }>;

/** A single http(s) address and nothing else. */
export function inputUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function pageName(url: URL): string {
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.hostname}${path}`;
}

/** Pick the Reader: HTML (pasted, dropped or fetched) or plain text. */
export async function readImportInput(
  input: ImportInput,
  fetchSource: Fetch,
  /** Source id (`s2` … when the draft already has a Source). */
  options: { id?: string } = {},
): Promise<ReadInputResult> {
  const id = options.id !== undefined ? { id: options.id } : {};
  if (input.html !== null) {
    const name = input.fileName ?? "Pasted text";
    return { source: await readHtml(input.html, { ...id, name }), originHint: input.fileName };
  }
  const url = inputUrl(input.text);
  if (url) {
    const page = await fetchSource(url.href);
    const final = new URL(page.url || url.href);
    const name = pageName(final);
    const source = /^text\/plain/i.test(page.contentType)
      ? readText(page.text, { ...id, name })
      : await readHtml(page.text, { ...id, name });
    if (source.segments.length === 0) throw new Error("The page has no text");
    return { source, originHint: final.hostname };
  }
  return {
    source: readText(input.text, input.fileName ? { ...id, name: input.fileName } : id),
    originHint: input.fileName,
  };
}
