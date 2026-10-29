import { speakerForLabel, type DecisionBatch, type DecisionItem } from "@orthodox-prayer-toolkit/core";
import type { DecisionRuntime } from "./decisionRuntime";

/**
 * Stand-in for the Built-in model (browser dev, tests): fixed rules instead
 * of a model, answering the same Decisions the same way (one probability per
 * option). Rules hit with 0.8; the fallback answer is 0.6, so it shows as
 * uncertain.
 */

const FURNITURE = /(drucken|impressum|datenschutz|copyright|©|^seite \d+$|^\d+$)/iu;
const INSTRUCTION = /^(dann|danach|hierauf|darauf|stehend|kniend|dreimal|zweimal|zwölfmal|vierzigmal|\p{L}+mal\b)/iu;
const GENRE = /(ton|troparion|tropar|kontakion|psalm|ikos|stichera|irmos|kanon|hymnus|ode|lied|exapostilarion|theotokion)/iu;

function choose(batch: DecisionBatch, item: DecisionItem): [string, number] {
  const text = item.text.replace(/^\([^)]*\)\s*/, "");
  switch (batch.kind) {
    case "role": {
      if (FURNITURE.test(text)) return ["exclude", 0.8];
      const words = text.split(/\s+/).length;
      if (INSTRUCTION.test(text) && words <= 6) return ["annotation", 0.8];
      if (words <= 8 && !/[.,;:!?…]$/u.test(text)) return ["heading", 0.8];
      return ["verse", 0.6];
    }
    case "prefix": {
      const label = item.prefix?.label ?? "";
      if (speakerForLabel(label)) return ["speaker", 0.8];
      if (GENRE.test(label)) return ["heading", 0.8];
      if (INSTRUCTION.test(label)) return ["note", 0.8];
      return ["text", 0.6];
    }
    case "speaker":
      return ["other", 0.6];
    case "pair":
      return ["same", 0.8];
  }
}

/** One-hot-ish answer: `p` for the chosen option, the rest shared. */
export function answerFor(batch: DecisionBatch, choice: string, p: number): number[] {
  const index = batch.options.findIndex((o) => o.id === choice);
  const rest = (1 - p) / Math.max(1, batch.options.length - 1);
  return batch.options.map((_, i) => (i === index ? p : rest));
}

export function standInRuntime(
  override?: (batch: DecisionBatch, item: DecisionItem) => [string, number] | undefined,
): DecisionRuntime {
  return {
    async decide(batch, prompt, onItem, signal) {
      for (let i = prompt.first; i < prompt.first + prompt.count; i++) {
        if (signal.aborted) return;
        const item = batch.items[i]!;
        const [choice, p] = override?.(batch, item) ?? choose(batch, item);
        onItem(i, answerFor(batch, choice, p));
        // Let the window paint between answers, like the real model.
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}
