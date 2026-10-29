import {
  decisionPrompts,
  decisionStep,
  firstDraftBatches,
  speakerBatch,
  type DecisionBatch,
  type DecisionItem,
  type DecisionKind,
  type DecisionStep,
  type ImportDraft,
} from "@orthodox-prayer-toolkit/core";
import type { DecisionRuntime } from "./decisionRuntime";

export type FirstDraftProgress = {
  done: number;
  total: number;
  /** Block the model is deciding about next. */
  pending: string | null;
};

/**
 * The Built-in model's first draft: asks the first-draft Decisions in order
 * (roles, "Label:" starts, unknown speakers, language pairs) and applies each
 * answer at once against the draft as it is then, so the user can keep
 * editing; their own decisions win (see `decisionStep`).
 */
export async function runFirstDraft(options: {
  draft: ImportDraft;
  runtime: DecisionRuntime;
  /** The live draft; null when the import was closed. */
  current: () => ImportDraft | null;
  apply: (step: DecisionStep) => void;
  onProgress?: (progress: FirstDraftProgress) => void;
  signal: AbortSignal;
  /** Ask only these questions (e.g. ["pair"] after adding a language). */
  only?: DecisionKind[];
}): Promise<void> {
  const { runtime, current, apply, onProgress, signal, only } = options;
  const batches = firstDraftBatches(options.draft).filter((b) => !only || only.includes(b.kind));
  let total = batches.reduce((n, b) => n + b.items.length, 0);
  let done = 0;

  async function ask(batch: DecisionBatch, onAnswer?: (item: DecisionItem, choice: string) => void) {
    for (const prompt of decisionPrompts(batch, 40)) {
      if (signal.aborted) return;
      onProgress?.({ done, total, pending: batch.items[prompt.first]?.block ?? null });
      await runtime.decide(
        batch,
        prompt,
        (index, probabilities) => {
          const draft = current();
          const item = batch.items[index];
          if (!draft || !item || signal.aborted) return;
          const step = decisionStep(draft, batch, item, probabilities);
          if (step) apply(step);
          let best = 0;
          for (let k = 1; k < probabilities.length; k++) if (probabilities[k]! > probabilities[best]!) best = k;
          onAnswer?.(item, batch.options[best]!.id);
          done += 1;
          onProgress?.({ done, total, pending: batch.items[index + 1]?.block ?? null });
        },
        signal,
      );
    }
  }

  for (const batch of batches) {
    if (signal.aborted) return;
    if (batch.kind !== "prefix") {
      await ask(batch);
      continue;
    }
    const speakers: DecisionItem[] = [];
    await ask(batch, (item, choice) => {
      if (choice === "speaker") speakers.push(item);
    });
    const follow = speakerBatch(batch, speakers);
    if (follow && !signal.aborted) {
      total += follow.items.length;
      await ask(follow);
    }
  }
}
