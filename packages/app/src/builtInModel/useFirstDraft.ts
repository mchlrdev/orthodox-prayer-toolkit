import { useCallback, useEffect, useRef, useState } from "react";
import type { DecisionKind, ImportOp, ImportOrigin, LibraryMemory } from "@orthodox-prayer-toolkit/core";
import { getToolkitApi, isBrowserDev } from "../api";
import type { useImportDraft } from "../importDraft/useImportDraft";
import { builtInModelRuntime, type DecisionRuntime } from "./decisionRuntime";
import { applyMemoryRules, applyReaderRules, runFirstDraft, type FirstDraftProgress } from "./firstDraft";
import { standInRuntime } from "./standInModel";

export type FirstDraft = {
  /** While the model works through the draft. */
  progress: FirstDraftProgress | null;
  error: string | null;
  /** Run the first draft on the open Import draft; rejects when no model is installed. */
  start: (options?: { only?: DecisionKind[] }) => Promise<void>;
  /**
   * After the user loads a Source: Library memory's fixed rules, then the
   * model when one is there; never throws.
   */
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

/**
 * The Built-in model's first draft on the Import draft, one undo step per
 * run (with Library memory's fixed rules first).
 */
export function useFirstDraft(
  importDraft: ReturnType<typeof useImportDraft>,
  memory: () => LibraryMemory,
): FirstDraft {
  const [progress, setProgress] = useState<FirstDraftProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const draftRef = useRef(importDraft);
  draftRef.current = importDraft;
  const memoryRef = useRef(memory);
  memoryRef.current = memory;

  /** Fixed rules from the memory; not after adding a language (`only`). */
  const applyRules = useCallback((coalesceKey: string, only?: DecisionKind[]) => {
    if (!draftRef.current.currentDraft() || only) return;
    const apply = (ops: ImportOp[], origin: ImportOrigin) =>
      draftRef.current.apply(ops, { origin, coalesceKey, coalesceAlways: true });
    applyReaderRules(draftRef.current.currentDraft()!, apply);
    // Memory (the user's own corrections) after the reader, so it wins.
    applyMemoryRules(draftRef.current.currentDraft()!, memoryRef.current(), apply);
  }, []);

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
    applyRules(coalesceKey, options.only);
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
        memory: memoryRef.current(),
        readerRules: false,
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
  }, [applyRules]);

  const startIfAvailable = useCallback(
    (options?: { only?: DecisionKind[] }) => {
      void availableRuntime().then((runtime) => {
        if (runtime) start(options).catch(() => undefined);
        else applyRules(`memory-${Date.now()}`, options?.only);
      });
    },
    [applyRules, start],
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
