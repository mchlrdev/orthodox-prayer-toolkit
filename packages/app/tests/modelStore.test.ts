import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelEntry } from "../electron/modelCatalog";
import { createModelStore, type ModelStatus } from "../electron/modelStore";

const WEIGHTS = Buffer.alloc(300_000, 7);
const VISION = Buffer.from("vision projector");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A file host that honours Range requests and can stall mid-file. */
function startHost(files: Record<string, Buffer>, options: { ignoreRange?: boolean; stallAfter?: number; dropAfter?: number } = {}) {
  let dropped = 0;
  const ranges: (string | undefined)[] = [];
  const server: Server = createServer((req, res) => {
    const body = files[req.url!.slice(1)];
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    ranges.push(req.headers.range);
    const match = /bytes=(\d+)-/.exec(req.headers.range ?? "");
    const start = match && !options.ignoreRange ? Number(match[1]) : 0;
    res.writeHead(match && !options.ignoreRange ? 206 : 200, { "Content-Length": body.length - start });
    const slice = body.subarray(start);
    if (options.dropAfter !== undefined && start === 0 && dropped++ < 1) {
      res.write(slice.subarray(0, options.dropAfter), () => res.destroy());
      return;
    }
    if (options.stallAfter !== undefined && start === 0) {
      res.write(slice.subarray(0, options.stallAfter));
      return; // never ends: the test cancels
    }
    res.end(slice);
  });
  return new Promise<{ url: string; ranges: typeof ranges; close: () => void }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        ranges,
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      });
    });
  });
}

function entry(url: string, version = "1", weights = WEIGHTS): ModelEntry {
  return {
    id: "test-model",
    name: "Test model",
    version,
    files: [
      { name: "weights.gguf", url: `${url}/weights.gguf`, sha256: sha(weights), size: weights.length },
      { name: "vision.gguf", url: `${url}/vision.gguf`, sha256: sha(VISION), size: VISION.length },
    ],
  };
}

let root: string;
let host: Awaited<ReturnType<typeof startHost>> | null = null;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "opt-model-"));
});
afterEach(() => {
  host?.close();
  host = null;
  rmSync(root, { recursive: true, force: true });
});

describe("Built-in model download", () => {
  it("downloads, checks and keeps the model; delete frees the space", async () => {
    host = await startHost({ "weights.gguf": WEIGHTS, "vision.gguf": VISION });
    const seen: ModelStatus["state"][] = [];
    const store = createModelStore({ root, entry: entry(host.url), onChange: (s) => seen.push(s.state) });
    expect(store.status()).toMatchObject({ state: "absent", received: 0, model: { size: WEIGHTS.length + VISION.length } });

    await store.download();
    expect(store.status()).toMatchObject({ state: "installed" });
    expect(seen).toContain("downloading");
    expect(seen).toContain("verifying");
    expect(store.installedFiles()?.map((p) => p.split("/").at(-1))).toEqual(["weights.gguf", "vision.gguf"]);

    // A new store (the app restarted) sees the installed model.
    expect(createModelStore({ root, entry: entry(host.url) }).status().state).toBe("installed");

    store.remove();
    expect(store.status().state).toBe("absent");
    expect(readdirSync(root)).toEqual([]);
  });

  it("cancel keeps the partial file; the next download resumes with a Range request", async () => {
    host = await startHost({ "weights.gguf": WEIGHTS, "vision.gguf": VISION }, { stallAfter: 100_000 });
    const store = createModelStore({ root, entry: entry(host.url) });
    // Cancel once the bytes are on disk (the counter runs ahead of the write).
    const part = join(root, "test-model", "1", "weights.gguf.part");
    const watch = setInterval(() => {
      if (existsSync(part) && statSync(part).size >= 100_000) store.cancel();
    }, 5);
    await store.download();
    clearInterval(watch);
    expect(store.status()).toMatchObject({ state: "paused", received: 100_000 });

    // After a restart: resume from byte 100000.
    host.close();
    host = await startHost({ "weights.gguf": WEIGHTS, "vision.gguf": VISION });
    const again = createModelStore({ root, entry: entry(host.url) });
    expect(again.status()).toMatchObject({ state: "paused", received: 100_000 });
    await again.download();
    expect(host.ranges[0]).toBe("bytes=100000-");
    expect(again.status().state).toBe("installed");
  });

  it("starts the file again when the server ignores the Range", async () => {
    host = await startHost({ "weights.gguf": WEIGHTS, "vision.gguf": VISION }, { ignoreRange: true });
    const dir = join(root, "test-model", "1");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "weights.gguf.part"), WEIGHTS.subarray(0, 5000));
    const store = createModelStore({ root, entry: entry(host.url) });
    await store.download();
    expect(store.status().state).toBe("installed");
  });

  it("a damaged download is discarded with a clear message", async () => {
    const damaged = Buffer.from(WEIGHTS);
    damaged[10] = 0;
    host = await startHost({ "weights.gguf": damaged, "vision.gguf": VISION });
    const store = createModelStore({ root, entry: entry(host.url) });
    await store.download();
    expect(store.status()).toMatchObject({ state: "error", received: 0 });
    expect(store.status().message).toMatch(/checksum/);
    expect(existsSync(join(root, "test-model", "1", "weights.gguf.part"))).toBe(false);
  });

  it("an installed version drops files the entry no longer lists", async () => {
    host = await startHost({ "weights.gguf": WEIGHTS, "vision.gguf": VISION });
    await createModelStore({ root, entry: entry(host.url) }).download();
    const lean = { ...entry(host.url), files: entry(host.url).files.filter((f) => f.name !== "vision.gguf") };
    const store = createModelStore({ root, entry: lean });
    expect(store.status().state).toBe("installed");
    expect(readdirSync(join(root, "test-model", "1")).sort()).toEqual(["installed.json", "weights.gguf"]);
  });

  it("refuses to start without enough disk space", async () => {
    host = await startHost({ "weights.gguf": WEIGHTS, "vision.gguf": VISION });
    const store = createModelStore({ root, entry: entry(host.url), freeSpace: () => 1000 });
    await store.download();
    expect(store.status()).toMatchObject({ state: "error", message: expect.stringMatching(/disk space/) });
    expect(host.ranges).toEqual([]);
  });

  it("an app update with a new model version offers it and replaces the old one", async () => {
    const newer = Buffer.alloc(200_000, 9);
    host = await startHost({ "weights.gguf": WEIGHTS, "vision.gguf": VISION });
    await createModelStore({ root, entry: entry(host.url, "1") }).download();
    host.close();

    host = await startHost({ "weights.gguf": newer, "vision.gguf": VISION });
    const store = createModelStore({ root, entry: entry(host.url, "2", newer) });
    expect(store.status()).toMatchObject({ state: "absent", previousVersion: "1" });
    await store.download();
    expect(store.status()).toMatchObject({ state: "installed", previousVersion: undefined });
    expect(readdirSync(join(root, "test-model"))).toEqual(["2"]);
  });

  it("resumes by itself after a dropped connection", async () => {
    host = await startHost({ "weights.gguf": WEIGHTS, "vision.gguf": VISION }, { dropAfter: 50_000 });
    const store = createModelStore({ root, entry: entry(host.url), retryDelayMs: 1 });
    await store.download();
    expect(store.status().state).toBe("installed");
    // weights (dropped), weights again, vision.
    expect(host.ranges).toHaveLength(3);
  });

  it("reports a missing file on the server", async () => {
    host = await startHost({ "vision.gguf": VISION });
    const store = createModelStore({ root, entry: entry(host.url) });
    await store.download();
    expect(store.status()).toMatchObject({ state: "error", message: expect.stringMatching(/HTTP 404/) });
  });
});
