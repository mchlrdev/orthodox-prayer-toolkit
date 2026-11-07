import { useEffect, useState } from "react";
import { getToolkitApi } from "../api";
import type { ModelDeviceInfo } from "../../electron/modelDevice";
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

/** Where the Built-in model runs; updates when a load settles it. */
export function useModelDevice(active: boolean): ModelDeviceInfo | null {
  const [device, setDevice] = useState<ModelDeviceInfo | null>(null);
  useEffect(() => {
    if (!active) return;
    const api = getToolkitApi();
    let cancelled = false;
    const unsub = api.onModelDevice((next) => {
      if (!cancelled) setDevice(next);
    });
    void api.getModelDevice().then(
      (next) => {
        if (!cancelled && next) setDevice(next);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [active]);
  return device;
}
