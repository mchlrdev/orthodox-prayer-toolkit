import { utilityProcess, type UtilityProcess } from "electron";
import type { DecisionPrompt } from "@orthodox-prayer-toolkit/core";
import type { ModelDevice } from "./modelDevice";
import type { GenerateRequest, ModelJobMessage, ModelWorkerMessage, ModelWorkerRequest } from "./modelWorker";

/** Unload the model (about 3 GB of memory) after this long without a job. */
const IDLE_MS = 3 * 60 * 1000;

type Listener = (message: ModelJobMessage) => void;

/**
 * Starts the model process on demand, forwards Decision jobs to it and
 * stops it when idle or when the model is deleted.
 */
export function createModelProcess(workerPath: string, onDevice: (device: ModelDevice) => void) {
  let child: UtilityProcess | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const running = new Map<number, Listener>();
  /** The last known device; a loaded model's stays after it unloads. */
  let device: ModelDevice | null = null;
  let probing: { promise: Promise<ModelDevice | null>; resolve: (device: ModelDevice | null) => void } | null = null;

  const settleProbe = (result: ModelDevice | null) => {
    probing?.resolve(result);
    probing = null;
  };

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
      if (message.type === "device") {
        const previous = device;
        if (message.device) device = message.device;
        settleProbe(device);
        if (device && device !== previous) onDevice(device);
        // Only asked where it would run: nothing to keep the process for.
        if (running.size === 0 && !device?.loaded) stop();
        return;
      }
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
      settleProbe(device);
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
    /** Where the model runs, or would run; no weights are loaded for this. */
    device(modelPath: string): Promise<ModelDevice | null> {
      if (device) return Promise.resolve(device);
      if (probing) return probing.promise;
      let resolve!: (result: ModelDevice | null) => void;
      const promise = new Promise<ModelDevice | null>((r) => {
        resolve = r;
      });
      probing = { promise, resolve };
      touch();
      start().postMessage({ type: "probe", modelPath } satisfies ModelWorkerRequest);
      return promise;
    },
    cancel(job: number) {
      child?.postMessage({ type: "cancel", job } satisfies ModelWorkerRequest);
    },
    stop,
  };
}
