import { utilityProcess, type UtilityProcess } from "electron";
import type { DecisionPrompt } from "@orthodox-prayer-toolkit/core";
import type { GenerateRequest, ModelWorkerMessage, ModelWorkerRequest } from "./modelWorker";

/** Unload the model (about 3 GB of memory) after this long without a job. */
const IDLE_MS = 3 * 60 * 1000;

type Listener = (message: ModelWorkerMessage) => void;

/**
 * Starts the model process on demand, forwards Decision jobs to it and
 * stops it when idle or when the model is deleted.
 */
export function createModelProcess(workerPath: string) {
  let child: UtilityProcess | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const running = new Map<number, Listener>();

  const stop = () => {
    if (idle) clearTimeout(idle);
    idle = null;
    child?.kill();
    child = null;
  };

  const touch = () => {
    if (idle) clearTimeout(idle);
    idle = running.size === 0 ? setTimeout(stop, IDLE_MS) : null;
  };

  function start(): UtilityProcess {
    if (child) return child;
    const proc = utilityProcess.fork(workerPath, [], { serviceName: "Built-in model" });
    proc.on("message", (message: ModelWorkerMessage) => {
      const listener = running.get(message.job);
      if (!listener) return;
      if (message.type !== "item" && message.type !== "text") running.delete(message.job);
      listener(message);
      touch();
    });
    proc.on("exit", (code) => {
      if (child === proc) child = null;
      for (const [job, listener] of running) {
        listener({ type: "error", job, message: `The model process stopped (code ${code}).` });
      }
      running.clear();
    });
    child = proc;
    return proc;
  }

  return {
    decide(job: number, modelPath: string, prompt: DecisionPrompt, listener: Listener) {
      running.set(job, listener);
      touch();
      start().postMessage({ type: "decide", job, modelPath, prompt } satisfies ModelWorkerRequest);
    },
    generate(job: number, modelPath: string, request: GenerateRequest, listener: Listener) {
      running.set(job, listener);
      touch();
      start().postMessage({ type: "generate", job, modelPath, request } satisfies ModelWorkerRequest);
    },
    cancel(job: number) {
      child?.postMessage({ type: "cancel", job } satisfies ModelWorkerRequest);
    },
    stop,
  };
}
