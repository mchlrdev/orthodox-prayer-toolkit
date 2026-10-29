import { useEffect, useState } from "react";
import { getToolkitApi } from "../api";
import type { ModelStatus } from "../../electron/modelStore";

/** Live status of the Built-in model (pushed from the main process while it downloads). */
export function useBuiltInModel(active: boolean): ModelStatus | null {
  const [status, setStatus] = useState<ModelStatus | null>(null);
  useEffect(() => {
    if (!active) return;
    const api = getToolkitApi();
    let cancelled = false;
    const unsub = api.onModelStatus((next) => {
      if (!cancelled) setStatus(next);
    });
    void api.getModelStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [active]);
  return status;
}
