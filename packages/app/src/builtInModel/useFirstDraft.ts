import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionKind } from "@orthodox-prayer-toolkit/core";
import { getToolkitApi, isBrowserDev } from "../api";
import type { useImportDraft } from "../importDraft/useImportDraft";
import { builtInModelRuntime, type DecisionRuntime } from "./decisionRuntime";
import { runFirstDraft, type FirstDraftProgress } from "./firstDraft";
import { standInRuntime } from "./standInModel";

export type FirstDraft = {
  /** While the model works through the draft. */
  progress: FirstDraftProgress | null;
  error: string | null;
  /** Run the first draft on the open Import draft; rejects when no model is installed. */
  start: (options?: { only?: DecisionKind[] }) => Promise<void>;
  /** Start only when a model is there (after the user loads a Source); never throws. */
  startIfAvailable: (options?: { only?: DecisionKind[] }) => void;
  stop: () => void;
  dismissError: () => void;
};

/** Browser dev: the stand-in model. Desktop: the Built-in model when installed. */
export async function availableRuntime(): Promise<DecisionRuntime | null> {
  if (isBrowserDev()) return standInRuntime();
  const status = await getToolkitApi().getModelStatus();
  return status.state === "installed" ? builtInModelRuntime() : null;
}

/** The Built-in model's first draft on the Import draft, one undo step per run. */
export function useFirstDraft(importDraft: ReturnType<typeof useImportDraft>): FirstDraft {
  const [progress, setProgress] = useState<FirstDraftProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef(importDraft);
  draftRef.current = importDraft;

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const start = useCallback(async (options: { only?: DecisionKind[] } = {}) => {
    const imp = draftRef.current;
    const draft = imp.currentDraft();
    if (!draft) throw new Error("No Import draft is open");
    const runtime = await availableRuntime();
    if (!runtime) throw new Error("The Built-in model is not installed (App settings → Built-in model)");
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const coalesceKey = `model-${Date.now()}`;
    setError(null);
    setProgress({ done: 0, total: 0, pending: null });
    try {
      await runFirstDraft({
        draft,
        runtime,
        current: () => draftRef.current.currentDraft(),
        apply: (step) =>
          draftRef.current.apply(step.ops, { origin: step.origin, coalesceKey, coalesceAlways: true }),
        onProgress: (p) => {
          if (!abort.signal.aborted) setProgress(p);
        },
        signal: abort.signal,
        only: options.only,
      });
    } catch (err) {
      if (!abort.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      }
    } finally {
      if (abortRef.current === abort) {
        abortRef.current = null;
        setProgress(null);
      }
    }
  }, []);

  const startIfAvailable = useCallback(
    (options?: { only?: DecisionKind[] }) => {
      void availableRuntime().then((runtime) => {
        if (runtime) start(options).catch(() => undefined);
      });
    },
    [start],
  );

  // Closing or saving the import stops the model.
  const open = importDraft.draft !== null;
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      setError(null);
    }
  }, [open]);

  return {
    progress,
    error,
    start,
    startIfAvailable,
    stop,
    dismissError: useCallback(() => setError(null), []),
  };
}
