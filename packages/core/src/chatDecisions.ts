/**
 * Decisions for instructions in the Chat pane. The Built-in model does not
 * plan freely: it picks the action, then the kind or speaker, the scope and
 * the target blocks, each from a fixed set of options. Free text only where
 * an action needs it (a chat answer, an explicit text change).
 */
import { speakerNamedIn, type DecisionBatch, type DecisionOption } from "./importDecisions.js";

/** Where the instruction was given. */
export type ChatView = "import" | "prayer" | "library";

export type ChatAction =
  | "setKind"
  | "setSpeaker"
  | "removeSpeaker"
  | "exclude"
  | "include"
  | "editText"
  | "answer";

const ACTIONS: Record<ChatAction, string> = {
  setKind: "change the kind (role) of paragraphs: heading, subheading, annotation, verse",
  setSpeaker: "give paragraphs a speaker (priest, deacon, choir, people, …)",
  removeSpeaker: "remove the speaker from paragraphs",
  exclude: "leave paragraphs out: they are not part of the prayer",
  include: "take left-out paragraphs back in",
  editText: "change the wording of paragraphs (correct a typo, replace a word)",
  answer: "answer a question, explain or translate in the chat, changing nothing",
};

const ACTION_EXAMPLES: Array<[string, ChatAction]> = [
  ["Abschnitt 4 ist eine Anmerkung.", "setKind"],
  ["„Priester:“ ist der Sprecher.", "setSpeaker"],
  ["Die Quellenangabe am Ende gehört nicht dazu.", "exclude"],
  ["Korrigiere den Tippfehler in Abschnitt 3.", "editText"],
  ["Was bedeutet Theotokion?", "answer"],
  ["Übersetze das ins Englische.", "answer"],
];

/** Actions that make sense in a view (exclude/include and text only in an import). */
export function chatActions(view: ChatView): ChatAction[] {
  return view === "import"
    ? ["setKind", "setSpeaker", "removeSpeaker", "exclude", "include", "editText", "answer"]
    : ["setKind", "setSpeaker", "removeSpeaker", "answer"];
}

function single(kind: DecisionBatch["kind"], question: string, options: DecisionOption[], text: string, examples?: Array<[string, string]>): DecisionBatch {
  return { kind, variant: "", question, options, examples, items: [{ block: "", text }] };
}

/** What does the instruction ask for? */
export function actionBatch(view: ChatView, instruction: string): DecisionBatch {
  const actions = chatActions(view);
  return single(
    "action",
    "What does the user's instruction ask for?",
    actions.map((id) => ({ id, label: ACTIONS[id] })),
    instruction,
    ACTION_EXAMPLES.filter(([, a]) => actions.includes(a)),
  );
}

/** Which of the given options (kinds, speakers) does the instruction name? */
export function choiceBatch(question: string, options: DecisionOption[], instruction: string): DecisionBatch {
  return single("choice", question, options, instruction);
}

/** This prayer only, or every prayer in the Library? */
export function scopeBatch(instruction: string): DecisionBatch {
  return single(
    "scope",
    "Does the instruction mean only the open prayer or every prayer in the library?",
    [
      { id: "this", label: "only the open prayer" },
      { id: "library", label: "every prayer in the library (“in allen Gebeten”, “überall”)" },
    ],
    instruction,
    [
      ["Gib in allen Gebeten „Amen.“ den Speaker Volk.", "library"],
      ["Abschnitt 2 ist eine Überschrift.", "this"],
    ],
  );
}

/**
 * The action when the wording leaves no doubt: "speaker"/"Sprecher" with a
 * known speaker sets it, with "remove"/"entfernen"/"ohne" removes it. Else
 * undefined (the model decides).
 */
export function plainAction(instruction: string): ChatAction | undefined {
  if (!/(speaker|sprecher)/iu.test(instruction)) return undefined;
  if (/(remove|entfern|ohne|kein|löschen|delete)/iu.test(instruction)) return "removeSpeaker";
  return speakerNamedIn(instruction.replace(/[„“"»«‚'][^„“"»«‚']*[“”"«»‘']/gu, "")) ? "setSpeaker" : undefined;
}

/** "library" when the wording plainly means every prayer ("in allen Gebeten"), else undefined. */
export function plainScope(instruction: string): "library" | undefined {
  return /(in allen|alle[nm]?\s+gebete|jede[mn]?\s+gebet|überall|ganzen?\s+library|every prayer|all prayers|whole library|everywhere)/iu.test(instruction)
    ? "library"
    : undefined;
}

/** For each paragraph: does the instruction apply to it? */
export function targetBatch(instruction: string, blocks: Array<{ block: string; text: string }>): DecisionBatch {
  return {
    kind: "target",
    variant: "",
    question: `Instruction: “${instruction}”\nDoes the instruction apply to each paragraph?`,
    options: [
      { id: "yes", label: "yes, the instruction is about this paragraph" },
      { id: "no", label: "no" },
    ],
    items: blocks.map((b) => ({ block: b.block, text: b.text.replace(/\s+/g, " ").slice(0, 200) })),
  };
}

/** A quoted passage in the instruction ("„Ehre sei dem Vater …“"), without a trailing ellipsis. */
export function quotedText(instruction: string): string | null {
  const m = /[„“"»«‚']([^„“"»«‚']{3,})[“”"«»‘']/u.exec(instruction);
  if (!m) return null;
  const text = m[1]!.replace(/\s*(…|\.\.\.)\s*$/u, "").replace(/:$/, "").trim();
  return text.length >= 3 ? text : null;
}

/** Paragraph numbers the instruction names ("Abschnitt 3 und 7", "sections 2-4"). */
export function sectionNumbers(instruction: string): number[] {
  const m = /\b(?:abschnitte?|abs\.|absatz|absätze|section|sections|paragraphs?|block|blöcke|blocks?)\s+((?:\d+\s*(?:[-–]\s*\d+)?\s*(?:,|und|and|&)?\s*)+)/iu.exec(instruction);
  if (!m) return [];
  const out: number[] = [];
  for (const part of m[1]!.split(/,|und|and|&/u)) {
    const range = /(\d+)\s*[-–]\s*(\d+)/u.exec(part);
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]) && n - Number(range[1]) < 200; n++) out.push(n);
    } else {
      const n = Number.parseInt(part.trim(), 10);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return [...new Set(out)];
}
