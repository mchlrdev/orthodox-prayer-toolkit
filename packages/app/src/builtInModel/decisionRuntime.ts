import type { DecisionBatch, DecisionPrompt } from "@orthodox-prayer-toolkit/core";
import type { GenerateRequest, ModelWorkerMessage } from "../../electron/preload";
import { getToolkitApi } from "../api";

/** Answers Decisions and writes free text: the Built-in model (desktop) or the stand-in model. */
export type DecisionRuntime = {
  decide: (
    batch: DecisionBatch,
    prompt: DecisionPrompt,
    onItem: (index: number, probabilities: number[]) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Free text: chat answers, translations, explicit text changes. */
  generate: (request: GenerateRequest, onText: (chunk: string) => void, signal: AbortSignal) => Promise<string>;
};

let nextJob = 1;

/** Run one job in the model process and follow its messages until it ends. */
function job(
  start: (id: number) => Promise<void>,
  onMessage: (message: ModelWorkerMessage) => void,
  signal: AbortSignal,
): Promise<string> {
  const api = getToolkitApi();
  const id = nextJob++;
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => void api.cancelDecision(id);
    const unsub = api.onDecision((message) => {
      if (message.job !== id) return;
      if (message.type === "item" || message.type === "text") {
        onMessage(message);
        return;
      }
      unsub();
      signal.removeEventListener("abort", onAbort);
      if (message.type === "done") resolve(message.text ?? "");
      else reject(new Error(message.message));
    });
    signal.addEventListener("abort", onAbort);
    start(id).catch((error: unknown) => {
      unsub();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

/** The Built-in model in its own process (via the main process). */
export function builtInModelRuntime(): DecisionRuntime {
  const api = getToolkitApi();
  return {
    async decide(_batch, prompt, onItem, signal) {
      await job(
        (id) => api.startDecision(id, prompt),
        (m) => {
          if (m.type === "item") onItem(m.index, m.probabilities);
        },
        signal,
      );
    },
    generate(request, onText, signal) {
      return job(
        (id) => api.startGenerate(id, request),
        (m) => {
          if (m.type === "text") onText(m.text);
        },
        signal,
      );
    },
  };
}
