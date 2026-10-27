import { useCallback, useEffect, useRef, useState } from "react";
import { getToolkitApi, isBrowserDev } from "../api";
import { loadAgentAccessEnabled, saveAgentAccessEnabled } from "../agentAccessPrefs";
import { handleAgentRequest, type ToolHost } from "./toolDirectory";

export type AgentAccess = {
  /** False in the browser dev build: the server lives in the desktop app. */
  available: boolean;
  enabled: boolean;
  /** Port while running. */
  port: number | null;
  error: string | null;
  setEnabled: (enabled: boolean) => void;
};

/** The prompt the user copies into their Agent. */
export function agentPrompt(port: number): string {
  return `Orthodox Prayer Toolkit is running locally. Read the tools at http://127.0.0.1:${port}/ and work only through these tools.`;
}

/**
 * Agent access in the app window: turns the local server on and off (the
 * setting is remembered) and answers its requests from the Tool directory.
 * `host` may change every render; requests always use the latest one.
 */
export function useAgentAccess(host: ToolHost): AgentAccess {
  const available = !isBrowserDev();
  const [enabled, setEnabledState] = useState(() => available && loadAgentAccessEnabled());
  const [port, setPort] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    getToolkitApi()
      .setAgentAccess(enabled)
      .then((p) => {
        if (cancelled) return;
        setPort(p);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPort(null);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [available, enabled]);

  useEffect(() => {
    if (!available) return;
    const api = getToolkitApi();
    return api.onAgentRequest((id, request) => {
      void handleAgentRequest(hostRef.current, request)
        .catch((err: unknown) => ({
          status: 500,
          body: { ok: false, error: err instanceof Error ? err.message : String(err) },
        }))
        .then((answer) => api.respondAgentRequest(id, answer));
    });
  }, [available]);

  const setEnabled = useCallback((next: boolean) => {
    saveAgentAccessEnabled(next);
    setEnabledState(next);
  }, []);

  return { available, enabled, port, error, setEnabled };
}
