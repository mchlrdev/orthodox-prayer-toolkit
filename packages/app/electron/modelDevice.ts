/** Where the Built-in model runs. Pure, shared by the model process, main and the window. */

export type ModelDevice = {
  /** All layers on the GPU, some of them, or none. */
  placement: "gpu" | "partial" | "cpu";
  backend: "metal" | "cuda" | "vulkan" | null;
  /** The GPUs in use; on the CPU, the ones that were tried. */
  gpus: string[];
  /** Every GPU the runtime sees, used or not. */
  listed: string[];
  /** The GPU was tried and did not have enough memory (or refused). */
  fallback: boolean;
  /** False while this is only what a load would pick; the model is not loaded yet. */
  loaded: boolean;
};

/** A device plus the GPUs of this computer the model does not use. */
export type ModelDeviceInfo = ModelDevice & { others: string[] };

/** The GPU name in llama.cpp's "using device Vulkan0 (NVIDIA Quadro P620) (id) - 2048 MiB free". */
export function usedGpuFromLog(line: string): string | null {
  return /using device \S+ \((.+)\) \([^()]*\) - \d+ MiB free/.exec(line)?.[1] ?? null;
}

const sameGpu = (a: string, b: string) => {
  const [x, y] = [a, b].map((name) => name.toLowerCase().replace(/\((r|tm)\)|[^a-z0-9]+/g, ""));
  return x!.includes(y!) || y!.includes(x!);
};

/** Listed GPUs that are none of `used`, each once. Names differ a little between sources. */
export function otherGpus(used: string[], listed: string[]): string[] {
  const others: string[] = [];
  for (const name of listed) {
    if (![...used, ...others].some((known) => sameGpu(known, name))) others.push(name);
  }
  return others;
}
