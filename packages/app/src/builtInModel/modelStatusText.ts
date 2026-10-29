import type { ModelStatus } from "../../electron/modelStore";

export function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** "about 2 min left" from the current download speed, or null while unknown. */
export function timeLeft(status: ModelStatus): string | null {
  if (!status.bytesPerSecond) return null;
  const seconds = (status.model.size - status.received) / status.bytesPerSecond;
  if (seconds < 60) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} min left`;
  return `about ${Math.round(minutes / 60)} h left`;
}

/** The line under the model name in App settings. */
export function modelStatusLine(status: ModelStatus): string {
  const size = formatGb(status.model.size);
  const progress = `${formatGb(status.received)} of ${size}`;
  switch (status.state) {
    case "absent":
      return status.previousVersion ? `A new version is available · ${size}` : `${size} download`;
    case "downloading": {
      const left = timeLeft(status);
      return left ? `${progress} · ${left}` : progress;
    }
    case "paused":
      return `${progress} · paused`;
    case "verifying":
      return "Checking the download…";
    case "installed":
      return `Installed · ${size} · kept until the next model update`;
    case "error":
      return status.message ?? "The download failed.";
    case "stand-in":
      return "Stand-in model in browser dev. The desktop app downloads the real model.";
  }
}
