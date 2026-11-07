import { describe, expect, it } from "vitest";
import { otherGpus, usedGpuFromLog, type ModelDeviceInfo } from "../electron/modelDevice";
import { openModel } from "../electron/modelRuntime";
import { modelDeviceLine, modelDeviceShort, modelOtherGpusLine } from "../src/builtInModel/modelStatusText";

describe("usedGpuFromLog", () => {
  it("reads the GPU from llama.cpp's log line", () => {
    expect(usedGpuFromLog("llama_prepare_model_devices: using device MTL0 (Apple M3) (unknown id) - 5414 MiB free")).toBe("Apple M3");
    expect(usedGpuFromLog("using device Vulkan0 (Intel(R) UHD Graphics 630) (0000:00:02.0) - 3200 MiB free")).toBe("Intel(R) UHD Graphics 630");
    expect(usedGpuFromLog("print_info: vocab_only = 1")).toBeNull();
  });
});

describe("otherGpus", () => {
  it("leaves out the GPU in use, also when spelled differently", () => {
    expect(otherGpus(["Intel(R) UHD Graphics 630"], ["Intel UHD Graphics 630", "NVIDIA Quadro P620"])).toEqual(["NVIDIA Quadro P620"]);
    expect(otherGpus(["NVIDIA Quadro P620"], ["Quadro P620", "NVIDIA Quadro P620"])).toEqual([]);
    expect(otherGpus([], ["NVIDIA Quadro P620", "NVIDIA Quadro P620"])).toEqual(["NVIDIA Quadro P620"]);
  });
});

type FakeModel = { gpuLayers: number; fileInsights: { totalLayers: number }; disposed: boolean };

/** A runtime whose context fails for the given layer settings. */
function fakeLlama(options: {
  gpu?: "vulkan" | false;
  offloaded?: number;
  contextFailsOnGpu?: boolean;
  contextFailsOnCpu?: boolean;
}) {
  const loads: unknown[] = [];
  const models: FakeModel[] = [];
  const llama = {
    gpu: options.gpu ?? "vulkan",
    getGpuDeviceNames: async () => ["Intel UHD", "NVIDIA Quadro P620"],
    getVramState: async () => ({ free: 500 * 2 ** 20, total: 4096 * 2 ** 20, used: 0, unifiedSize: 0 }),
    loadModel: async ({ gpuLayers }: { gpuLayers: unknown }) => {
      loads.push(gpuLayers);
      const onCpu = gpuLayers === 0;
      const model = {
        gpuLayers: onCpu ? 0 : (options.offloaded ?? 33),
        fileInsights: { totalLayers: 33 },
        disposed: false,
        createContext: async () => {
          if (onCpu ? options.contextFailsOnCpu : options.contextFailsOnGpu) throw new Error("Failed to create context");
          return {};
        },
        dispose: async () => {
          model.disposed = true;
        },
      };
      models.push(model);
      return model;
    },
  };
  return { llama: llama as never, loads, models };
}

const used = () => ["NVIDIA Quadro P620"];

describe("openModel", () => {
  it("names the GPU when all layers fit", async () => {
    const { llama, loads } = fakeLlama({});
    const { device } = await openModel(llama, "m.gguf", 8192, used);
    expect(device).toMatchObject({ placement: "gpu", backend: "vulkan", gpus: ["NVIDIA Quadro P620"], fallback: false, loaded: true });
    expect(loads).toEqual([{ fitContext: { contextSize: 8192 } }]);
  });

  it("reports a partial offload", async () => {
    const { device } = await openModel(fakeLlama({ offloaded: 12 }).llama, "m.gguf", 8192, used);
    expect(device).toMatchObject({ placement: "partial", fallback: false });
  });

  it("counts no layers fitting as a fallback to the CPU", async () => {
    const { device } = await openModel(fakeLlama({ offloaded: 0 }).llama, "m.gguf", 8192, used);
    expect(device).toMatchObject({ placement: "cpu", fallback: true, gpus: ["NVIDIA Quadro P620"] });
  });

  it("falls back to the CPU when the context does not fit on the GPU", async () => {
    const { llama, loads, models } = fakeLlama({ contextFailsOnGpu: true });
    const { device } = await openModel(llama, "m.gguf", 8192, used);
    expect(loads).toEqual([{ fitContext: { contextSize: 8192 } }, 0]);
    expect(models[0]!.disposed).toBe(true);
    expect(device).toMatchObject({ placement: "cpu", fallback: true, gpus: ["NVIDIA Quadro P620"], loaded: true });
  });

  it("goes straight to the CPU without GPU support", async () => {
    const { llama, loads } = fakeLlama({ gpu: false });
    const { device } = await openModel(llama, "m.gguf", 8192, () => []);
    expect(loads).toEqual([0]);
    expect(device).toMatchObject({ placement: "cpu", backend: null, gpus: [], fallback: false });
  });

  it("says what was tried when nothing works", async () => {
    const { llama, models } = fakeLlama({ contextFailsOnGpu: true, contextFailsOnCpu: true });
    await expect(openModel(llama, "m.gguf", 8192, used)).rejects.toThrow(
      "Failed to create context (on NVIDIA Quadro P620, 500 of 4096 MB free, and on the CPU). Close other apps and try again.",
    );
    expect(models.every((m) => m.disposed)).toBe(true);
  });
});

const device = (d: Partial<ModelDeviceInfo>): ModelDeviceInfo => ({
  placement: "gpu",
  backend: "vulkan",
  gpus: ["NVIDIA Quadro P620"],
  listed: [],
  fallback: false,
  loaded: true,
  others: [],
  ...d,
});

describe("device text", () => {
  it("names the GPU and any it leaves unused", () => {
    const d = device({ gpus: ["Intel UHD"], others: ["NVIDIA Quadro P620"] });
    expect(modelDeviceLine(d)).toBe("Runs on the GPU · Intel UHD");
    expect(modelOtherGpusLine(d)).toBe("Not used: NVIDIA Quadro P620");
    expect(modelOtherGpusLine(device({}))).toBeNull();
    expect(modelDeviceShort(d)).toBe("on Intel UHD");
  });

  it("speaks of the future before the model has loaded", () => {
    expect(modelDeviceLine(device({ loaded: false }))).toBe("Will run on the GPU · NVIDIA Quadro P620");
  });

  it("says why it is slower on the CPU", () => {
    expect(modelDeviceLine(device({ placement: "cpu", fallback: true }))).toBe(
      "Runs on the CPU, slower · too little memory on NVIDIA Quadro P620",
    );
    expect(modelDeviceLine(device({ placement: "cpu", gpus: [] }))).toBe("Runs on the CPU, slower · no usable GPU found");
    expect(modelDeviceLine(device({ placement: "partial" }))).toBe(
      "Runs partly on the GPU · NVIDIA Quadro P620 · the rest on the CPU, slower",
    );
    expect(modelDeviceShort(device({ placement: "cpu" }))).toBe("on the CPU, slower");
  });
});
