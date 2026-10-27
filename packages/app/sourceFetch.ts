/**
 * Fetch a web page for the import (main process / dev server, not the
 * renderer: no CORS, no cookies). Only http(s), text responses, size-capped.
 */

export const SOURCE_FETCH_MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export type FetchedSource = {
  /** Final URL after redirects. */
  url: string;
  contentType: string;
  text: string;
};

export function isFetchableUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function fetchSource(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedSource> {
  if (!isFetchableUrl(raw)) throw new Error("Only http and https addresses can be imported");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(raw, {
      signal: controller.signal,
      redirect: "follow",
      credentials: "omit",
      headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9" },
    });
    if (!res.ok) throw new Error(`The page answered ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType && !/^(text\/|application\/xhtml)/i.test(contentType)) {
      throw new Error(`Not a web page (${contentType.split(";")[0]})`);
    }
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > SOURCE_FETCH_MAX_BYTES) throw new Error("The page is too large");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > SOURCE_FETCH_MAX_BYTES) throw new Error("The page is too large");
    const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim() ?? "utf-8";
    let text: string;
    try {
      text = new TextDecoder(charset).decode(buf);
    } catch {
      text = new TextDecoder("utf-8").decode(buf);
    }
    return { url: res.url || raw, contentType, text };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("The page took too long to answer");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
