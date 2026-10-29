import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { modelSize, type ModelEntry, type ModelFile } from "./modelCatalog";

/**
 * The Built-in model on disk: `<root>/<id>/<version>/`. A file downloads to
 * `<name>.part` (resumed with a Range request after Cancel or a restart), is
 * checked against its sha256 and then renamed; `installed.json` marks a
 * complete version. Installing a version deletes the older ones.
 */

export type ModelState =
  | "absent"
  | "paused"
  | "downloading"
  | "verifying"
  | "installed"
  | "error"
  /** Browser dev: no download; a stand-in model answers instead. */
  | "stand-in";

export type ModelStatus = {
  model: { name: string; version: string; size: number };
  state: ModelState;
  /** Bytes of this version on disk (complete files plus partial downloads). */
  received: number;
  /** While downloading. */
  bytesPerSecond?: number;
  /** An older installed version: the app update brought a new model. */
  previousVersion?: string;
  /** For `error`. */
  message?: string;
};

export type ModelStore = {
  status: () => ModelStatus;
  /** Download (or resume) the model; resolves when done, cancelled or failed. */
  download: () => Promise<void>;
  /** Stop the download; the partial files stay for resuming. */
  cancel: () => void;
  /** Delete every version and partial download. */
  remove: () => void;
  /** Absolute paths of the installed files, or null. */
  installedFiles: () => string[] | null;
};

const MARKER = "installed.json";
const PROGRESS_EVERY_MS = 250;

/** A failure that retrying will not fix (checksum, HTTP status, disk space). */
export class ModelDownloadError extends Error {}

const NETWORK_RETRIES = 3;

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function createModelStore(options: {
  root: string;
  entry: ModelEntry;
  fetch?: typeof fetch;
  /** Called on every change of the status (progress at most every 250 ms). */
  onChange?: (status: ModelStatus) => void;
  /** Free bytes where the model goes; defaults to the disk's free space. */
  freeSpace?: (dir: string) => number;
  /** Pause before resuming after a dropped connection (grows per attempt). */
  retryDelayMs?: number;
}): ModelStore {
  const { root, entry } = options;
  const doFetch = options.fetch ?? fetch;
  const modelDir = join(root, entry.id);
  const versionDir = join(modelDir, entry.version);
  const total = modelSize(entry);
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const freeSpace =
    options.freeSpace ??
    ((dir: string) => {
      const s = statfsSync(dir);
      return s.bavail * s.bsize;
    });

  let running: { abort: AbortController; done: Promise<void> } | null = null;
  let live: Pick<ModelStatus, "state" | "bytesPerSecond" | "message"> | null = null;
  let liveReceived = 0;

  const isInstalled = () => existsSync(join(versionDir, MARKER));

  function onDisk(): number {
    return entry.files.reduce((sum, f) => {
      const done = fileSize(join(versionDir, f.name));
      return sum + (done > 0 ? done : fileSize(join(versionDir, `${f.name}.part`)));
    }, 0);
  }

  function previousVersion(): string | undefined {
    if (!existsSync(modelDir)) return undefined;
    return readdirSync(modelDir).find(
      (v) => v !== entry.version && existsSync(join(modelDir, v, MARKER)),
    );
  }

  function status(): ModelStatus {
    const base = {
      model: { name: entry.name, version: entry.version, size: total },
      previousVersion: isInstalled() ? undefined : previousVersion(),
    };
    if (live) return { ...base, ...live, received: liveReceived };
    if (isInstalled()) return { ...base, state: "installed", received: total };
    const received = onDisk();
    return { ...base, state: received > 0 ? "paused" : "absent", received };
  }

  const emit = () => options.onChange?.(status());

  async function fetchFile(
    file: ModelFile,
    signal: AbortSignal,
    progress: (n: number) => void,
    verifying: () => void,
  ) {
    const done = join(versionDir, file.name);
    if (existsSync(done)) return;
    const part = `${done}.part`;
    let offset = fileSize(part);
    if (offset > file.size) {
      rmSync(part, { force: true });
      offset = 0;
    }
    if (offset < file.size) {
      const res = await doFetch(file.url, {
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
        signal,
      });
      if (res.status === 200) {
        // The server ignored the Range: start this file again.
        progress(-offset);
        offset = 0;
      } else if (res.status !== 206) {
        throw new ModelDownloadError(`The download failed (HTTP ${res.status}). Try again later.`);
      }
      if (!res.body) throw new Error("The download failed (empty answer).");
      const counter = new Transform({
        transform(chunk: Buffer, _enc, next) {
          progress(chunk.length);
          next(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
        counter,
        createWriteStream(part, { flags: offset > 0 ? "a" : "w" }),
        { signal },
      );
    }
    verifying();
    if (fileSize(part) !== file.size || (await sha256Of(part)) !== file.sha256) {
      rmSync(part, { force: true });
      throw new ModelDownloadError(
        "The download was damaged (checksum mismatch) and was discarded. Download it again.",
      );
    }
    renameSync(part, done);
  }

  async function run(abort: AbortController): Promise<void> {
    mkdirSync(versionDir, { recursive: true });
    liveReceived = onDisk();
    const needed = total - liveReceived;
    if (freeSpace(versionDir) < needed + 200e6) {
      throw new ModelDownloadError(`Not enough disk space: the model needs ${gb(needed)} more.`);
    }
    live = { state: "downloading", bytesPerSecond: 0 };
    emit();

    let lastEmit = 0;
    let windowStart = Date.now();
    let windowBytes = 0;
    const progress = (n: number) => {
      liveReceived += n;
      windowBytes += Math.max(n, 0);
      const now = Date.now();
      if (now - lastEmit < PROGRESS_EVERY_MS) return;
      const elapsed = (now - windowStart) / 1000;
      if (elapsed >= 1 && live) {
        live = { state: "downloading", bytesPerSecond: windowBytes / elapsed };
        windowStart = now;
        windowBytes = 0;
      }
      lastEmit = now;
      emit();
    };

    for (const file of entry.files) {
      live = { state: "downloading", bytesPerSecond: live?.bytesPerSecond ?? 0 };
      for (let attempt = 0; ; attempt++) {
        const before = onDisk();
        try {
          await fetchFile(file, abort.signal, progress, () => {
            live = { state: "verifying" };
            emit();
          });
          break;
        } catch (error) {
          // A dropped connection: resume from the partial file a few times.
          if (abort.signal.aborted || error instanceof ModelDownloadError || attempt >= NETWORK_RETRIES) {
            throw error;
          }
          liveReceived = onDisk();
          // Only failures in a row without progress count against the limit.
          if (liveReceived > before) attempt = 0;
          await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
          if (abort.signal.aborted) throw error;
        }
      }
    }
    writeFileSync(
      join(versionDir, MARKER),
      `${JSON.stringify({ id: entry.id, version: entry.version, files: entry.files.map((f) => f.name) }, null, 2)}\n`,
    );
    for (const v of readdirSync(modelDir)) {
      if (v !== entry.version) rmSync(join(modelDir, v), { recursive: true, force: true });
    }
  }

  return {
    status,
    download() {
      if (running) return running.done;
      if (isInstalled()) return Promise.resolve();
      const abort = new AbortController();
      const done = run(abort)
        .then(() => {
          live = null;
        })
        .catch((error: unknown) => {
          live = abort.signal.aborted
            ? null
            : {
                state: "error",
                message:
                  error instanceof ModelDownloadError
                    ? error.message
                    : `The connection was interrupted (${error instanceof Error ? error.message : String(error)}). Try again to continue where it stopped.`,
              };
          liveReceived = onDisk();
        })
        .finally(() => {
          running = null;
          emit();
        });
      running = { abort, done };
      return done;
    },
    cancel() {
      running?.abort.abort();
    },
    remove() {
      running?.abort.abort();
      live = null;
      rmSync(modelDir, { recursive: true, force: true });
      emit();
    },
    installedFiles() {
      return isInstalled() ? entry.files.map((f) => join(versionDir, f.name)) : null;
    },
  };
}
