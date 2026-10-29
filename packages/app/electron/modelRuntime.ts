import { decisionItemPrefix, type DecisionPrompt } from "@orthodox-prayer-toolkit/core";
import type { Llama, LlamaContext, LlamaContextSequence, LlamaModel, Token } from "node-llama-cpp";

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
    request: { system: string; user: string; maxTokens?: number },
    onText: (text: string) => void,
    signal?: AbortSignal,
  ) => Promise<string>;
  dispose: () => Promise<void>;
};

/** Qwen chat format with thinking switched off. */
function chatPrompt(system: string, user: string): string {
  return `<|im_start|>system\n${system}<|im_end|>\n<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}

export async function createDecider(modelPath: string, contextSize = 8192): Promise<Decider> {
  const { getLlama } = await import("node-llama-cpp");
  const llama: Llama = await getLlama();
  const model: LlamaModel = await llama.loadModel({ modelPath });
  const context: LlamaContext = await model.createContext({ contextSize });
  const sequence: LlamaContextSequence = context.getSequence();

  return {
    async decide(prompt, onItem, signal) {
      const letters = prompt.letters.map((l) => {
        const tokens = model.tokenize(l);
        if (tokens.length !== 1) throw new Error(`Option letter "${l}" is not one token`);
        return tokens[0]!;
      });
      await sequence.clearHistory();
      let input: Token[] = [
        ...model.tokenize(chatPrompt(prompt.system, prompt.user), true),
        ...model.tokenize(decisionItemPrefix(0)),
      ];
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
      await sequence.clearHistory();
      const tokens = model.tokenize(chatPrompt(request.system, request.user), true);
      const out: Token[] = [];
      let text = "";
      for await (const token of sequence.evaluate(tokens, { temperature: 0 })) {
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
      await llama.dispose();
    },
  };
}
