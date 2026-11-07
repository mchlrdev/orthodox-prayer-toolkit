import { decisionItemPrefix, type DecisionPrompt } from "@orthodox-prayer-toolkit/core";
import type { Llama, LlamaContext, LlamaContextSequence, LlamaModel, Token } from "node-llama-cpp";
import { usedGpuFromLog, type ModelDevice } from "./modelDevice.ts";

/**
 * Decisions on a GGUF model with node-llama-cpp. The model reads the prompt
 * once; then, item by item, the runtime appends "n=" and reads the
 * probability of each option letter as the next token. The likeliest letter
 * is appended before the next item, so the model sees its earlier answers.
 * No text is generated.
 *
 * Runs in the model process (modelWorker.ts) and in the measurement script.
 */

export type Decider = {
  decide: (
    prompt: DecisionPrompt,
    onItem: (index: number, probabilities: number[]) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
  /**
   * Free text (chat answers, translations, an explicit text change). Greedy,
   * stops at the end of the answer or after `maxTokens`.
   */
  generate: (
    request: { system: string; user: string; maxTokens?: number; json?: object },
    onText: (text: string) => void,
    signal?: AbortSignal,
  ) => Promise<string>;
  /** Where this model runs. */
  device: ModelDevice;
  dispose: () => Promise<void>;
};

/** Qwen chat format with thinking switched off. */
function chatPrompt(system: string, user: string): string {
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}

type Runtime = { llama: Llama; usedGpus: () => string[]; forgetUsedGpus: () => void };
let runtime: Promise<Runtime> | null = null;

/**
 * The process's one runtime; its log tells which GPUs llama.cpp picked (nothing
 * else reports that). One only: a second instance in a process no longer gets
 * the log. It holds little memory, the model is what gets disposed.
 */
function startLlama(): Promise<Runtime> {
  runtime ??= (async () => {
    const { getLlama, LlamaLogLevel } = await import("node-llama-cpp");
    let used: string[] = [];
    const llama = await getLlama({
      logLevel: LlamaLogLevel.info,
      logger: (level, message) => {
        const gpu = usedGpuFromLog(message);
        if (gpu && !used.includes(gpu)) used.push(gpu);
        if (level === LlamaLogLevel.error || level === LlamaLogLevel.fatal) console.error(message);
      },
    });
    return { llama, usedGpus: () => used, forgetUsedGpus: () => { used = []; } };
  })();
  runtime.catch(() => {
    runtime = null;
  });
  return runtime;
}

const backendOf = (llama: Pick<Llama, "gpu">) => llama.gpu || null;

/**
 * Open the model where it fits: as many layers on the GPU as leave room for
 * the context (a small GPU takes only some), else all on the CPU.
 */
export async function openModel(
  llama: Pick<Llama, "gpu" | "loadModel" | "getGpuDeviceNames" | "getVramState">,
  modelPath: string,
  contextSize: number,
  usedGpus: () => string[],
): Promise<{ model: LlamaModel; context: LlamaContext; device: ModelDevice }> {
  const listed = await llama.getGpuDeviceNames().catch(() => []);
  const gpusOr = (used: string[]) => (used.length > 0 ? used : listed);

  const attempt = async (gpuLayers: Parameters<Llama["loadModel"]>[0]["gpuLayers"]) => {
    const model = await llama.loadModel({ modelPath, gpuLayers });
    try {
      return { model, context: await model.createContext({ contextSize }) };
    } catch (error) {
      await model.dispose().catch(() => {});
      throw error;
    }
  };

  let gpuError: unknown = null;
  let tried: string[] = [];
  if (llama.gpu) {
    try {
      const opened = await attempt({ fitContext: { contextSize } });
      const { gpuLayers } = opened.model;
      const placement = gpuLayers === 0 ? "cpu" : gpuLayers < opened.model.fileInsights.totalLayers ? "partial" : "gpu";
      return {
        ...opened,
        device: { placement, backend: backendOf(llama), gpus: gpusOr([...usedGpus()]), listed, fallback: gpuLayers === 0, loaded: true },
      };
    } catch (error) {
      // Too little GPU memory, or a driver that refuses.
      gpuError = error;
      tried = gpusOr([...usedGpus()]);
    }
  }
  try {
    const opened = await attempt(0);
    return {
      ...opened,
      device: { placement: "cpu", backend: backendOf(llama), gpus: tried, listed, fallback: gpuError !== null, loaded: true },
    };
  } catch (cpuError) {
    const why = gpuError ?? cpuError;
    const vram = llama.gpu ? await llama.getVramState().catch(() => null) : null;
    const free = vram ? `, ${Math.round(vram.free / 2 ** 20)} of ${Math.round(vram.total / 2 ** 20)} MB free` : "";
    const gpu = tried.length > 0 ? `on ${tried.join(", ")}${free}, and on the CPU` : "on the CPU";
    throw new Error(`${why instanceof Error ? why.message : String(why)} (${gpu}). Close other apps and try again.`);
  }
}

/**
 * What a load would pick, without loading the weights: reads only the
 * vocabulary, so llama.cpp names its GPUs. Cannot tell yet whether they have
 * enough memory.
 */
export async function probeDevice(modelPath: string): Promise<ModelDevice> {
  const { llama, usedGpus, forgetUsedGpus } = await startLlama();
  const listed = await llama.getGpuDeviceNames().catch(() => []);
  if (!llama.gpu) return { placement: "cpu", backend: null, gpus: [], listed, fallback: false, loaded: false };
  forgetUsedGpus();
  const model = await llama.loadModel({ modelPath, vocabOnly: true });
  await model.dispose();
  const used = usedGpus();
  return { placement: "gpu", backend: backendOf(llama), gpus: used.length > 0 ? used : listed, listed, fallback: false, loaded: false };
}

export async function createDecider(modelPath: string, contextSize = 8192): Promise<Decider> {
  const { LlamaGrammarEvaluationState } = await import("node-llama-cpp");
  const { llama, usedGpus, forgetUsedGpus } = await startLlama();
  forgetUsedGpus();
  const { model, context, device } = await openModel(llama, modelPath, contextSize, usedGpus);
  const sequence: LlamaContextSequence = context.getSequence();

  /**
   * Keep what the sequence already holds of `input` (the rules, options and
   * examples shared by every prompt of a batch) and return the rest to
   * evaluate. At least the last token is left, so its next-token
   * probabilities can be read. Same tokens, same results, less work.
   */
  async function reuse(input: Token[]): Promise<Token[]> {
    const held = sequence.contextTokens;
    let common = 0;
    const max = Math.min(held.length, input.length - 1);
    while (common < max && held[common] === input[common]) common++;
    if (common === 0) await sequence.clearHistory();
    else if (common < held.length) await sequence.eraseContextTokenRanges([{ start: common, end: held.length }]);
    return input.slice(common);
  }

  return {
    device,
    async decide(prompt, onItem, signal) {
      const letters = prompt.letters.map((l) => {
        const tokens = model.tokenize(l);
        if (tokens.length !== 1) throw new Error(`Option letter "${l}" is not one token`);
        return tokens[0]!;
      });
      let input: Token[] = await reuse([
        ...model.tokenize(chatPrompt(prompt.system, prompt.user), true),
        ...model.tokenize(decisionItemPrefix(0)),
      ]);
      for (let i = 0; i < prompt.count; i++) {
        if (signal?.aborted) return;
        const out = await sequence.controlledEvaluate([
          ...input.slice(0, -1),
          [input.at(-1)!, { generateNext: { probabilities: true } }],
        ]);
        const probabilities = out.at(-1)?.next?.probabilities;
        if (!probabilities) throw new Error("The model returned no probabilities");
        const raw = letters.map((t) => probabilities.get(t) ?? 0);
        const sum = raw.reduce((a, b) => a + b, 0);
        const answer = sum > 0 ? raw.map((p) => p / sum) : raw.map(() => 1 / raw.length);
        onItem(prompt.first + i, answer);
        let best = 0;
        for (let k = 1; k < answer.length; k++) if (answer[k]! > answer[best]!) best = k;
        input = [letters[best]!, ...model.tokenize(`\n${decisionItemPrefix(i + 1)}`)];
      }
    },
    async generate(request, onText, signal) {
      const tokens = await reuse(model.tokenize(chatPrompt(request.system, request.user), true));
      const out: Token[] = [];
      let text = "";
      const grammar = request.json
        ? new LlamaGrammarEvaluationState({
            model,
            // The schema comes from Core (chatPlanSchema); its shape is checked there.
            grammar: await llama.createGrammarForJsonSchema(request.json as never),
          })
        : undefined;
      for await (const token of sequence.evaluate(tokens, { temperature: 0, grammarEvaluationState: grammar })) {
        if (signal?.aborted || model.isEogToken(token)) break;
        out.push(token);
        const next = model.detokenize(out);
        if (next.includes("<|im_end|>")) break;
        if (next.length > text.length) {
          onText(next.slice(text.length));
          text = next;
        }
        if (out.length >= (request.maxTokens ?? 600)) break;
      }
      return text.trim();
    },
    async dispose() {
      await context.dispose();
      await model.dispose();
    },
  };
}
