import type { DecisionPrompt } from "@orthodox-prayer-toolkit/core";
import { createDecider, type Decider } from "./modelRuntime";

/**
 * The Built-in model's own process (Electron utilityProcess): loads the model
 * on the first job and answers Decisions without blocking the window or the
 * main process. One job runs at a time.
 */

export type GenerateRequest = {
  system: string;
  user: string;
  maxTokens?: number;
  /** JSON schema the answer must follow (a grammar holds the model to it). */
  json?: object;
};

export type ModelWorkerRequest =
  | { type: "decide"; job: number; modelPath: string; prompt: DecisionPrompt }
  | { type: "generate"; job: number; modelPath: string; request: GenerateRequest }
  | { type: "cancel"; job: number };

export type ModelWorkerMessage =
  | { type: "item"; job: number; index: number; probabilities: number[] }
  | { type: "text"; job: number; text: string }
  | { type: "done"; job: number; text?: string }
  | { type: "error"; job: number; message: string };

const port = process.parentPort;
let loaded: { path: string; decider: Promise<Decider> } | null = null;
const cancelled = new Map<number, AbortController>();
let queue: Promise<void> = Promise.resolve();

const send = (message: ModelWorkerMessage) => port.postMessage(message);

function decider(path: string): Promise<Decider> {
  if (loaded?.path !== path) {
    const previous = loaded;
    loaded = { path, decider: (previous ? previous.decider.then((d) => d.dispose()) : Promise.resolve()).then(() => createDecider(path)) };
  }
  return loaded.decider;
}

port.on("message", ({ data }: { data: ModelWorkerRequest }) => {
  if (data.type === "cancel") {
    cancelled.get(data.job)?.abort();
    return;
  }
  const abort = new AbortController();
  cancelled.set(data.job, abort);
  queue = queue.then(async () => {
    try {
      if (abort.signal.aborted) return;
      const d = await decider(data.modelPath);
      if (data.type === "generate") {
        const text = await d.generate(
          data.request,
          (chunk) => send({ type: "text", job: data.job, text: chunk }),
          abort.signal,
        );
        send({ type: "done", job: data.job, text });
        return;
      }
      await d.decide(
        data.prompt,
        (index, probabilities) => send({ type: "item", job: data.job, index, probabilities }),
        abort.signal,
      );
      send({ type: "done", job: data.job });
    } catch (error) {
      send({ type: "error", job: data.job, message: error instanceof Error ? error.message : String(error) });
    } finally {
      cancelled.delete(data.job);
    }
  });
});
