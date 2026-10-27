export const AGENT_ACCESS_STORAGE_KEY = "orthodox-prayer-toolkit.agent-access";

/** Agent access is off until the user turns it on (app setting, not per Library). */
export function loadAgentAccessEnabled(): boolean {
  try {
    return localStorage.getItem(AGENT_ACCESS_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveAgentAccessEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(AGENT_ACCESS_STORAGE_KEY, "on");
    else localStorage.removeItem(AGENT_ACCESS_STORAGE_KEY);
  } catch {
    // Private mode / quota: the setting just does not stick.
  }
}
