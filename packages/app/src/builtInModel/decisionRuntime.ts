import type { DecisionBatch, DecisionPrompt } from "@orthodox-prayer-toolkit/core";
import { getToolkitApi } from "../api";

/** Answers Decisions: the Built-in model (desktop) or the stand-in model. */
export type DecisionRuntime = {
  decide: (
    batch: DecisionBatch,
    prompt: DecisionPrompt,
    onItem: (index: number, probabilities: number[]) => void,
    signal: AbortSignal,
  ) => Promise<void>;
};

let nextJob = 1;

/** The Built-in model in its own process (via the main process). */
export function builtInModelRuntime(): DecisionRuntime {
  return {
    decide(_batch, prompt, onItem, signal) {
      const api = getToolkitApi();
      const job = nextJob++;
      return new Promise<void>((resolve, reject) => {
        const unsub = api.onDecision((message) => {
          if (message.job !== job) return;
          if (message.type === "item") onItem(message.index, message.probabilities);
          else {
            unsub();
            signal.removeEventListener("abort", onAbort);
            if (message.type === "done") resolve();
            else reject(new Error(message.message));
          }
        });
        const onAbort = () => void api.cancelDecision(job);
        signal.addEventListener("abort", onAbort);
        api.startDecision(job, prompt).catch((error: unknown) => {
          unsub();
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
  };
}
