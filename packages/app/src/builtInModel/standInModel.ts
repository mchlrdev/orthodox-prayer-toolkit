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
  // The neighbours ("‹before: …›") are context for the model, not part of the paragraph.
  const text = item.text.replace(/\s*‹(before|after): [^›]*›/gu, "").replace(/^\([^)]*\)\s*/, "");
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
    case "action":
      return [chatAction(batch, text), 0.8];
    case "choice":
      return [chatChoice(batch, text), 0.8];
    case "scope":
      return [/(allen gebeten|alle gebete|überall|every prayer|all prayers|whole library)/iu.test(text) ? "library" : "this", 0.8];
    case "target":
      return ["no", 0.6];
  }
}

/** Keyword rules for the Chat pane's first question (what to do). */
function chatAction(batch: Pick<DecisionBatch, "options">, text: string): string {
  const offered = (id: string) => batch.options.some((o) => o.id === id);
  const rules: Array<[RegExp, string]> = [
    [/(gehört nicht|nicht dazu|weglassen|ausschließen|exclude|leave out|not part)/iu, "exclude"],
    [/(wieder (rein|aufnehmen|einschließen)|einschließen|include|take .* back)/iu, "include"],
    [/(tippfehler|typo|korrigier|correct|ersetze|replace)/iu, "editText"],
    [/(sprecher|speaker).*(entfern|weg|remove|ohne)|(entfern|remove).*(sprecher|speaker)/iu, "removeSpeaker"],
    [/(sprecher|speaker)/iu, "setSpeaker"],
    [/(überschrift|heading|anmerkung|annotation|rubrik|\bvers\b|\bverse\b|kind)/iu, "setKind"],
  ];
  for (const [re, id] of rules) if (re.test(text) && offered(id)) return id;
  return "answer";
}

const CHOICE_WORDS: Record<string, RegExp> = {
  subheading: /(unterüberschrift|subheading)/iu,
  heading: /((?<!unter)überschrift|(?<!sub)heading)/iu,
  annotation: /(anmerkung|annotation|rubrik|anweisung)/iu,
  verse: /(\bvers\b|\bverse\b)/iu,
  priest: /(priester|priest)/iu,
  deacon: /(diakon|deacon)/iu,
  bishop: /(bischof|bishop)/iu,
  reader: /(leser|reader)/iu,
  cantor: /(kantor|cantor|sänger)/iu,
  choir: /(chor|choir)/iu,
  people: /(volk|people)/iu,
  all: /(\balle\b|everyone)/iu,
};

/** The option the instruction names (first match), else the first option. */
function chatChoice(batch: DecisionBatch, text: string): string {
  const hit = batch.options.find((o) => (CHOICE_WORDS[o.id] ?? new RegExp(`\\b${o.id}\\b`, "iu")).test(text));
  return (hit ?? batch.options[0]!).id;
}

/** One-hot-ish answer: `p` for the chosen option, the rest shared. */
export function answerFor(batch: DecisionBatch, choice: string, p: number): number[] {
  const index = batch.options.findIndex((o) => o.id === choice);
  const rest = (1 - p) / Math.max(1, batch.options.length - 1);
  return batch.options.map((_, i) => (i === index ? p : rest));
}

export function standInRuntime(
  override?: (batch: DecisionBatch, item: DecisionItem) => [string, number] | undefined,
  standInText?: (user: string) => string | undefined,
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
    async generate(request, onText) {
      if (request.json) {
        // A chat plan: the action by keyword rules, the rest left to the caller's rules.
        const schema = request.json as { properties?: { action?: { enum?: string[] } } };
        const actions = schema.properties?.action?.enum ?? [];
        const instruction = /Instruction: (.*)$/su.exec(request.user)?.[1] ?? request.user;
        const action = chatAction({ options: actions.map((id) => ({ id, label: id })) }, instruction);
        const plan = JSON.stringify({ action, sections: [], kind: "none", speaker: "none", quote: "" });
        onText(plan);
        return plan;
      }
      const text = standInText?.(request.user) ?? `Stand-in model: no answer in browser dev. (${request.user.split("\n")[0]!.slice(0, 60)})`;
      onText(text);
      return text;
    },
  };
}
