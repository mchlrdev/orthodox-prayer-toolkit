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
  | "note"
  | "removeText"
  | "setTitle"
  | "merge"
  | "undo"
  | "answer";

const ACTIONS: Record<ChatAction, string> = {
  setKind: "change the kind (role) of paragraphs: heading, subheading, annotation, verse",
  setSpeaker: "give paragraphs a speaker (priest, deacon, choir, people, …)",
  removeSpeaker: "remove the speaker from paragraphs",
  exclude: "leave paragraphs out: they are not part of the prayer",
  include: "take left-out paragraphs back in",
  editText: "change the wording of paragraphs (correct a typo, replace a word)",
  note: "mark some words inside a paragraph as an inline annotation (“(dreimal)” within a verse)",
  removeText: "delete some words or a printed label (“Leser:”) from paragraphs",
  setTitle: "set the prayer's title (“das oben ist der Titel”, “der Titel ist …”)",
  merge: "join neighbouring paragraphs into one (“5 und 6 gehören zusammen”)",
  undo: "undo the last change",
  answer: "answer a question, explain or translate in the chat, changing nothing",
};

const ACTION_EXAMPLES: Array<[string, ChatAction]> = [
  ["Abschnitt 4 ist eine Anmerkung.", "setKind"],
  ["„Priester:“ ist der Sprecher.", "setSpeaker"],
  ["Die Quellenangabe am Ende gehört nicht dazu.", "exclude"],
  ["Korrigiere den Tippfehler in Abschnitt 3.", "editText"],
  ["„(dreimal)“ ist eine Anmerkung im Vers.", "note"],
  ["Entferne „Leser:“ am Anfang.", "removeText"],
  ["Was bedeutet Theotokion?", "answer"],
  ["Übersetze das ins Englische.", "answer"],
];

/** Actions that make sense in a view (exclude/include and text only in an import). */
export function chatActions(view: ChatView): ChatAction[] {
  return view === "import"
    ? ["setKind", "setSpeaker", "removeSpeaker", "exclude", "include", "editText", "note", "removeText", "setTitle", "merge", "undo", "answer"]
    : ["setKind", "setSpeaker", "removeSpeaker", "answer"];
}

function single(kind: DecisionBatch["kind"], question: string, options: DecisionOption[], text: string, examples?: Array<[string, string]>): DecisionBatch {
  return { kind, variant: "", question, options, examples, items: [{ block: "", text }] };
}

/** What does the instruction ask for? */
export function actionBatch(view: ChatView, instruction: string): DecisionBatch {
  // Undo only by an explicit "rückgängig" (see ruleChatPlan), never by a guess.
  const actions: ChatAction[] = chatActions(view).filter((a) => a !== "undo");
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

const UNIT = String.raw`(?:abschn\p{L}*|abs\.|absatz|absätze[n]?|zeilen?|nr\.?|nummern?|section|sections|paragraphs?|lines?|numbers?|no\.|blöcke|blocks?|#)`;
const LIST = String.raw`(\d+(?:\s*[-–]\s*\d+)?(?:\s*(?:,|und|and|&|bis|to)\s*#?\s*\d+(?:\s*[-–]\s*\d+)?)*)`;

function listNumbers(list: string): number[] {
  const out: number[] = [];
  for (const part of list.replace(/#/gu, "").split(/,|und|and|&/u)) {
    const range = /(\d+)\s*(?:[-–]|bis|to)\s*(\d+)/u.exec(part);
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]) && n - Number(range[1]) < 200; n++) out.push(n);
    } else {
      const n = Number.parseInt(part.trim(), 10);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

/**
 * Numbers of the source column the instruction names: "Abschnitt 3 und 7",
 * "Zeile 2", "#4", "Nr. 5", "sections 2-4", a leading "2 und 10 …", and
 * "die erste / letzte Zeile" (`last` = highest number shown). Quoted text is
 * ignored.
 */
export function sectionNumbers(instruction: string, last?: number): number[] {
  const text = instruction.replace(/[„“"»«‚'][^„“"»«‚']*[“”"«»‘']/gu, " ");
  const out: number[] = [];
  const named = new RegExp(String.raw`(?:^|[^\p{L}])${UNIT}\s*${LIST}`, "giu");
  for (const m of text.matchAll(named)) out.push(...listNumbers(m[1]!));
  // "2 und 10 gehören nicht dazu", but not "12 раз", "40 mal", "3x".
  const leading = new RegExp(String.raw`^\s*${LIST}(?![.\d])\s+(?!(?:mal|x|×|раз|times|ori|fois|φορές)(?![\p{L}]))\p{L}`, "iu").exec(text);
  if (out.length === 0 && leading) out.push(...listNumbers(leading[1]!));
  const unitWord = String.raw`\s+(?:zeile|abschnitt|absatz|line|section|paragraph|block)`;
  if (new RegExp(String.raw`\b(?:erste[nrms]?|first)${unitWord}`, "iu").test(text)) out.push(1);
  if (last !== undefined && new RegExp(String.raw`\b(?:letzte[nrms]?|last)${unitWord}`, "iu").test(text)) {
    out.push(last);
  }
  return [...new Set(out)];
}
