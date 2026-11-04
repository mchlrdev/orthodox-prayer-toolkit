/**
 * Chat plan: what one instruction in the Chat pane asks for, as data. The
 * wording settles most of it by fixed rules (action, speaker, kind, quoted
 * words, a reference to the previous answer); the Built-in model only fills
 * what is left, in one answer constrained to {@link chatPlanSchema}. The
 * changes for a plan are built here, with a reason for every block that is
 * left as it was.
 */
import type { ChatAction, ChatView } from "./chatDecisions.js";
import { chatActions, sectionNumbers } from "./chatDecisions.js";
import {
  draftBlockContent,
  draftBlockPlainText,
  draftBlockVisible,
  type DraftBlock,
  type ImportDraft,
  type ImportOp,
} from "./importDraft.js";
import {
  readerKindOf,
  inlineNoteRanges,
  labelPrefixEnd,
  speakerForLabel,
  speakerLabelAt,
  speakerNameOps,
} from "./importDecisions.js";
import { kindAllowsSpeaker } from "./kinds.js";
import { kindDisplayLabel, KIND_PRESETS } from "./types.js";
import { SPEAKER_PRESETS, speakerDisplayLabel } from "./speakers.js";

/** One earlier exchange in the chat, for follow-ups ("entferne das", "nochmal"). */
export type ChatTurn = {
  instruction: string;
  action: ChatAction | null;
  /** Blocks the answer was about. */
  blocks: string[];
  /** What the assistant answered or did, one line. */
  summary: string;
  /** The plan it carried out ("nochmal" repeats it). */
  plan?: ChatPlan;
  /** It changed the Import draft (and can be undone). */
  changed?: boolean;
};

export type ChatPlan = {
  action?: ChatAction;
  kind?: string;
  speaker?: string;
  /** Words the action is about: an inline annotation, words to delete, a passage to find. */
  quote?: string;
  /** For `editText`: what replaces `quote`. */
  replacement?: string;
  /** For `setTitle`: the title as typed (else the target section's text). */
  title?: string;
  /** The instruction means the previous answer's blocks ("das", "dort", "nein, Leser"). */
  followUp?: boolean;
  /** "Nein, …", "ich meinte …": the previous answer is undone first. */
  correct?: boolean;
  /** "nochmal": the previous plan again. */
  again?: boolean;
  /** The request was taken back in the same message ("…, ne doch nicht"). */
  cancel?: boolean;
  /** "and 8 too" after a merge: the previous blocks plus the ones named. */
  extend?: boolean;
  /** Something the chat cannot do; the reply says how instead (see {@link cannotDo}). */
  cannot?: string;
  /** "warum?": explain the previous answer. */
  explain?: boolean;
  /** "Was steht in Zeile 2?": read the section back. */
  readBack?: boolean;
  /** For `removeSpeaker`: only blocks with this speaker ("den Priester weg, Leser bleibt"). */
  onlySpeaker?: string;
  /** Words of the instruction that may name the target ("Kommentare", "dreimal"). */
  words?: string[];
  /** Typed text naming the target section ("Kondakion" in "Kondakion auch"). */
  subject?: string;
  /** The user named the sections (numbers, a selection or quoted words), not just described them. */
  explicit?: boolean;
  /** Section numbers, from the model. */
  sections?: number[];
};

// ---------------------------------------------------------------------------
// Rules on the wording

const QUOTES = /[„“"»«‚‘]([^„“"»«‚‘’”]{1,200})[“”"«»‘’]/gu;
const PAREN = /\([^()\n]{1,40}\)|\[[^[\]\n]{1,40}\]/u;
const SAY_WORD = /(spricht|sprechen|gesprochen|sagt|sagen|liest|lesen|singt|singen|ruft|\bsays?\b|\breads?\b|\bsings?\b|spoken)/iu;
const SPEAKER_NOUN = /(speaker|sprecher)/iu;
const SPEAKER_WORD = new RegExp(`${SPEAKER_NOUN.source}|${SAY_WORD.source}`, "iu");
const REMOVE_WORD = /(entfern|lösch|streich|\bweg\b|wegmach|\braus\b|herausnehm|remove|delete|\bdrop\b|\bstrip\b|\bcut\b|\bskip\b|get rid|убер|удали|убрать)/iu;
const LABEL_WORD = /(label|präfix|prefix|bezeichnung|\bwort\b|wörter|\bwords?\b)/iu;
const NOTE_WORD = /(anmerkung|annotation|rubrik|regieanweisung|anweisung|notiz|\bnote\b|instruction|rubric)/iu;
const INLINE_WORD = /(inline|im (vers|text|absatz|satz)|innerhalb|mitten|markier|\bmark\b|teil de[sr]|within|inside|\bbit\b)/iu;
const EXCLUDE_WORD = /(gehör\w* nicht|nicht dazu|nicht teil|kein teil|weglassen|auslassen|ausschließen|lass\b.*\bweg|raus damit|exclude|leave\b.*\bout|not part|doesn'?t belong|does not belong|skip|не часть|не относится|не нужн)/iu;
/** "… ist nicht das Gebet": leave out, unless the sentence names a kind ("an instruction, not the prayer itself"). */
const EXCLUDE_WEAK = /((ist|sind) nicht (das|zum) gebet|not the prayer|nicht teil des gebets)/iu;
const INCLUDE_WORD = /(wieder (rein|herein|aufnehmen|einschließen|dazu)|doch (wieder )?rein|zurückholen|einschließen|\binclude\b|take .* back|put .* back|bring .* back|restore)/iu;
const EDIT_WORD = /(tippfehler|typo|korrigier|\bcorrect\b|ersetz|replace|\bstatt\b|instead|ist falsch geschrieben|falsch geschrieben)/iu;
const REPLACE_WORD = /(durch|\bmit\b|\bwith\b|\bby\b|\bzu\b|\bto\b|\bin\b)/iu;
const MERGE_WORD = /(gehör\w* zusammen|zusammenfüg|zusammenführ|zusammenlegen|verbinde|vereinen|ein(en)? abschnitt (machen|draus)|\bmerge|\bjoin|belong together|combine)/iu;
const TITLE_WORD = /\b(titel|title)\b/iu;
const UNDO = /^\s*((bitte\s+)?rückgängig|undo|zurück|mach(\s+(das|es))?\s+rückgängig|revert|undo that|(oops|hoppla|ups|oh)[,!.\s]+.*\b(wieder|zurück|back|undo|rückgängig))\s*[.!]*\s*$/iu;
const AGAIN = /^\s*(nochmal|noch\s*mal|noch einmal|again|repeat|wiederhol\w*|do it again)\s*[.!]*\s*$/iu;
const CORRECTION = /^\s*(nein|no|nope|ne|nee|falsch|wrong|ich meinte|i meant|nicht das|not that|doch nicht|нет|όχι)(?![\p{L}])/iu;
const WHY = /^\s*(warum|wieso|weshalb|why)\s+(hast du|hast|did you|have you|did|machst du)\b/iu;
const READ_BACK = /\b(was steht|what does .* say|what is in|zeig mir)\b/iu;
const QUESTION = /(\?\s*$|[;;]\s*$|^(was|wie|warum|wieso|weshalb|wer|wo|welche[rsmn]?|what|how|why|who|where|which|что|как|почему|кто|где|τι|πώς)(?![\p{L}])|übersetz|translate|erklär|explain|переведи)/iu;
const REFERENCE =
  /\b(das|dies|diese[nmrs]?|dort|ebenso|auch|ebenfalls|genauso|gleiche[nm]?|dasselbe|it|this|that|these|those|there|them|same|also|too)\b/iu;
/** A new selection is meant ("das hier", "this one"), not the previous answer's blocks. */
const HERE = /\b(hier|this one|this here|dieser? hier|das hier)\b/iu;
const ALL_WORD = /\b(alle[nms]? (abschnitte|zeilen|blöcke)|allen abschnitten|überall|bei allem|bei allen|everything|everywhere|all (the )?sections|every section|jede[nmrs]? (abschnitt|zeile))\b/iu;
const TOP_WORD = /(\b(oben|ganz oben|am anfang|zu beginn|at the top|on top|first line|beginning|at the start|am start)\b|сверху|вверху)/iu;
/** "Samstag und alles danach": from there to the end. */
const REST = /\b(alles (danach|darunter|dahinter|weitere)|und den rest|everything (after|below)( it)?|and the rest|all the rest)\b/iu;
/** Also the next section ("ode 1 und den vers darunter"). */
const BELOW = /\b(darunter|danach|dahinter|below|after it|the next one|den nächsten|dem nächsten|the one under)\b/iu;
/** Requests the chat cannot carry out, with where it is done instead. */
const CANNOT: Array<[RegExp, string]> = [
  [/(sprache hinzu|zweite sprache|weitere sprache|add (a |another |the )?(second )?language|übersetzung hinzu|add (the )?(greek|english|german|russian)|neben(an|dran)? setzen|next to it)/iu,
    "I cannot add a language from the chat. Use Add language in the import (from another text or a column of the source)."],
  [/(schriftart|schrift größer|font|farbe|colou?r|fett|kursiv|bold|italic|größe der schrift)/iu,
    "Fonts, sizes and colours are not part of the prayer; they belong to the kind styles in Library settings → Kinds."],
  [/(vorlesen|abspielen|anhören|audio|play (this|it)|read (it )?aloud|sound)/iu, "I cannot play or read anything aloud."],
  [/(pdf|speicher|exportier|save (it|this|as)|export|e-?mail|verschick|senden|send it|drucken|print)/iu,
    "I cannot save, export, print or send. Save to library is the button above the editor; export is in the prayer's menu once it is saved."],
  [/(ton auf|tone to|set the tone|töne als|glas auf)/iu, "I cannot set a tone from the chat; it is a field in Prayer settings after saving."],
  [/(teil\w* .*\bauf\b|aufteilen|aufspalten|in (einzelne|zwei) (zeilen|abschnitte|teile)|trennen|split|separate (it|them|this|the)|break .* into)/iu,
    "To split a section, put the cursor where the new one should start and press Enter in the editor. A speaker label at the start of a line (\"Wir: Amen.\") is split off by itself on import."],
  [/(ans ende setzen|hinzufügen|dazuschreiben|ergänz|add (an? )?(amen|line|verse)|insert|einfügen)/iu,
    "I do not add liturgical text. Type it in the editor where it belongs."],
];

/** What the chat cannot do, as the honest reply; undefined when it can. */
export function cannotDo(instruction: string): string | undefined {
  return CANNOT.find(([re]) => re.test(instruction))?.[1];
}

/** "Kondakion auch", "After the Meal too": the previous change, on what this names. */
const ALSO = /\b(auch|too|genauso|ebenso|ebenfalls|also|as well|gleich|тоже|также)(?![\p{L}])/iu;
const ALSO_ALL = new RegExp(ALSO.source, "giu");
const END_WORD = /(\b(am ende|ganz unten|unten|am schluss|at the end|at the bottom|footer|fußzeile)\b|внизу)/iu;
/** "… wait no …" inside one message: what comes after counts. */
const SELF_CORRECTION = /\b(wait,? no|no wait|nein doch|ne,? doch|nee,? doch|doch nicht|oder doch|eigentlich|actually|ich meine|i mean|sorry|warte,? ne|warte,? nein|ne,? warte|nein,? warte|nee,? warte)\b/giu;
/** "…, ne doch nicht, lass se getrennt": the request is taken back in the same message. */
const CANCEL = /\b(doch nicht|lass (es |se |sie |das )?(so|getrennt|wie es ist)|never ?mind|vergiss es|forget it|keep (it|them) (as is|separate)|leave it as it is|nicht machen)\b/iu;
/** Words describing how it is now ("steht komisch als Vers"), not what it should be. */
const CURRENT = /\b(steht|stehen|ist gerade|ist jetzt|ist noch|is currently|currently|shows as|showing as|wurde|war)\b[^,.;!?]*/giu;

const KIND_WORDS: Array<[RegExp, string]> = [
  [/(unterüberschrift|zwischenüberschrift|subheading|sub-heading|kleine überschrift|kleinere überschrift|kleinere|small heading|smaller heading|überschrift\w*,? (aber )?kleine?r?\b|heading,? (but )?small(er)?)/iu, "subheading"],
  [/((?<!unter|zwischen)überschrift|(?<!sub-?)heading|\btitel\b|\btitle\b)/iu, "heading"],
  [NOTE_WORD, "annotation"],
  [/(\bvers\b|\bverse\b|\bverses\b|gebetstext|\bgesprochen|\bgesungen|\bspoken\b|\bsung\b|gebet selbst|prayer itself)/iu, "verse"],
];
const NEGATED = /\b(kein|keine|keinen|nicht|not|no|isn'?t|is not)\s+(eine?n?\s+|a\s+|an\s+)?(\S+(?:\s+\S+){0,2})/giu;

/** Labels and nouns that name a speaker in an instruction ("Leser", "reader", "Chor"). */
const SPEAKER_NOUNS: Record<string, string> = {
  bischof: "bishop", bishop: "bishop",
  priester: "priest", priest: "priest", pfarrer: "priest", иерей: "priest", священник: "priest",
  diakon: "deacon", deacon: "deacon", диакон: "deacon",
  leser: "reader", lektor: "reader", reader: "reader", vorleser: "reader", чтец: "reader",
  kantor: "cantor", cantor: "cantor", sänger: "cantor", psaltis: "cantor", psalmist: "cantor", chanter: "cantor",
  chor: "choir", choir: "choir", хор: "choir", лик: "choir",
  volk: "people", people: "people", gemeinde: "people", congregation: "people", люди: "people",
  alle: "all", all: "all", everyone: "all", everybody: "all",
  wir: "people", we: "people",
};

const STOP = new Set(
  `abschnitt abschnitte zeile zeilen section sections line lines block blocks bitte please mach mache machen make kannst could would sollte sollen
  ist sind sein wird werden auch noch nicht nein dann denn aber oder und also eine einer einen eines der die das dem den des hier dort oben unten ende
  ganze ganzen alles allem nur mehr wieder doch schon jetzt gleich speaker sprecher titel title heading überschrift vers verse anweisung
  annotation rubrik weglassen lassen leave this that these those with without from have mercy`.split(/\s+/u),
);

function quotesOf(instruction: string): string[] {
  return [...instruction.matchAll(QUOTES)].map((m) => m[1]!.trim()).filter(Boolean);
}

function withoutQuotes(instruction: string): string {
  return instruction.replace(QUOTES, " ");
}

/** A speaker named outside quotes; "all" only next to "Speaker" or a say-word ("sagen alle"). */
function speakerInWords(text: string, custom: readonly string[]): string | undefined {
  const words = text.toLowerCase().split(/[^\p{L}\d_-]+/u).filter(Boolean);
  let found: string | undefined;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (custom.includes(word) && !SPEAKER_NOUNS[word]) {
      found = word;
      continue;
    }
    for (const form of [word, word.replace(/(en|es|s|n)$/u, "")]) {
      const id = SPEAKER_NOUNS[form];
      if (!id) continue;
      const near = [words[i - 1], words[i - 2], words[i + 1], words[i + 2]].filter(Boolean).join(" ");
      const sayNear = /(speaker|sprecher|sagt|sagen|gesagt|singt|singen|says|say|said|sing|sung|beten|spricht|sprechen)/u.test(near);
      if ((id === "all" || form === "wir" || form === "we") && !sayNear) continue;
      // "nicht der Priester": not this one.
      if (/^(nicht|not|kein|keine|no)$/u.test(words[i - 1] ?? "") || /^(nicht|not)$/u.test(words[i - 2] ?? "")) continue;
      // The last one named wins ("das Volk? nein der Chor").
      found = id;
      break;
    }
  }
  return found;
}

/** The kind the wording asks for: the last one named, a negated one turned around ("kein Titel" → verse). */
function kindInWords(raw: string): string | undefined {
  // "im Vers" says where, "steht als Vers" says how it is now: neither is the kind wanted.
  const text = raw.replace(/\b(im|in the|inside the|innerhalb des|within the) (vers|verse|text)\b/giu, " ").replace(CURRENT, " ");
  const negated = new Set<string>();
  for (const m of text.matchAll(NEGATED)) {
    for (const [re, kind] of KIND_WORDS) if (re.test(m[3]!)) negated.add(kind);
  }
  const hits: Array<{ kind: string; at: number; end: number }> = [];
  for (const [re, kind] of KIND_WORDS) {
    if (negated.has(kind)) continue;
    for (const m of text.matchAll(new RegExp(re.source, "giu"))) hits.push({ kind, at: m.index!, end: m.index! + m[0].length });
  }
  // "kleinere Überschrift" holds "Überschrift": the longer phrase counts.
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.at <= h.at && o.end >= h.end && o.end - o.at > h.end - h.at));
  const last = kept.sort((a, b) => a.at - b.at).at(-1);
  if (last) return last.kind;
  if (negated.has("heading") || negated.has("subheading") || negated.has("annotation")) return "verse";
  if (negated.has("verse")) return "annotation";
  return undefined;
}

/** "Der Chor singt dreimal: das ist eine Anweisung": a kind named after the speaker word, no "Sprecher" — the kind is meant. */
function kindAfterSpeaker(text: string): boolean {
  if (SPEAKER_NOUN.test(text)) return false;
  const lower = text.toLowerCase();
  const speakerAt = Math.min(...Object.keys(SPEAKER_NOUNS).map((w) => {
    const m = new RegExp(`(^|[^\\p{L}])${w}`, "iu").exec(lower);
    return m ? m.index : Infinity;
  }));
  if (!Number.isFinite(speakerAt)) return false;
  return KIND_WORDS.some(([re]) => {
    const m = new RegExp(re.source, "giu");
    return [...lower.matchAll(m)].some((x) => x.index! > speakerAt && /\b(ist|is|sind|are)\b/iu.test(lower.slice(speakerAt, x.index!)));
  });
}

/** Content words of an instruction that may name a section ("Kommentare", "dreimal"). */
function contentWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\d]+/u)
        .filter((w) => (w.length >= 5 || w === "menü" || w === "menu") && !STOP.has(w) && !SPEAKER_NOUNS[w] && !KIND_WORDS.some(([re]) => re.test(w)) && !REMOVE_WORD.test(w)),
    ),
  ];
}

/**
 * What the wording settles without the model. `previous` is the last answer
 * in the conversation: a short correction ("Nein, Leser.") repeats its action
 * on its blocks after undoing it, "nochmal" repeats it, "warum?" explains it.
 */
export function ruleChatPlan(
  instruction: string,
  view: ChatView,
  options: { previous?: ChatTurn; customSpeakers?: readonly string[]; lastChange?: ChatTurn } = {},
): ChatPlan {
  const plan: ChatPlan = {};
  const allowed = chatActions(view);
  const offer = (a: ChatAction) => (allowed.includes(a) ? a : undefined);
  const previous = options.previous;
  const quotes = quotesOf(instruction);
  const paren = PAREN.exec(withoutQuotes(instruction))?.[0];
  const raw = quotes[0] ?? paren;
  const quote = raw ? raw.replace(/\s*(…|\.\.\.)\s*$/u, "").replace(/(?<=\p{L}):$/u, "").trim() || undefined : undefined;
  if (quote) plan.quote = quote;
  const outside = withoutQuotes(instruction);
  // "make it a heading? wait no, a verse": the part after the last self-correction decides.
  const marks = [...outside.matchAll(SELF_CORRECTION)];
  const decisive = marks.length > 0 ? outside.slice(marks.at(-1)!.index! + marks.at(-1)![0].length) : outside;
  const custom = options.customSpeakers ?? [];
  plan.words = contentWords(outside);
  const subject = subjectOf(outside);

  if (UNDO.test(instruction) && offer("undo")) return { action: "undo" };
  // "Audio und Kommentare gehören nicht dazu" leaves things out; only a request to do it is refused.
  const cannot = cannotDo(withoutQuotes(instruction));
  if (cannot && !(quotes.length >= 2) && !EXCLUDE_WORD.test(outside) && !REMOVE_WORD.test(outside)) return { action: "answer", cannot };
  if (marks.length > 0 && (CANCEL.test(decisive) || /^\s*(lass|keep|leave)\b/iu.test(decisive)) && !kindInWords(decisive)) {
    return { action: "answer", cancel: true };
  }
  const lastChange = options.lastChange ?? previous;
  const again = lastChange?.plan?.action ? lastChange : previous?.plan?.action && previous.action !== "undo" && previous.action !== "answer" ? previous : undefined;
  if (AGAIN.test(instruction) && again) {
    return { ...again.plan, again: true, followUp: true };
  }
  if (WHY.test(outside) && previous) return { action: "answer", explain: true };
  if (READ_BACK.test(outside)) return { action: "answer", readBack: true };
  if (CORRECTION.test(outside) && previous?.changed) plan.correct = true;

  // A speaker word inside the passage the user names ("Der Chor singt dreimal: das ist eine Anweisung") is not the speaker.
  const named = subject && KIND_WORDS.some(([re]) => re.test(outside.slice(subject.length))) ? outside.slice(subject.length) : null;
  const speaker = named !== null ? speakerInWords(named, custom) :
    speakerInWords(decisive, custom) ??
    speakerInWords(outside, custom) ??
    (quote ? (speakerForLabel(quote.replace(/:$/u, "")) ?? (custom.includes(quote.toLowerCase()) ? quote.toLowerCase() : undefined)) : undefined);
  const kind = kindInWords(decisive) ?? kindInWords(named ?? outside);
  const removes = REMOVE_WORD.test(outside);
  const asks = QUESTION.test(outside.trim()) && !/\b(mach|make|setz|set|gib|give)\b/iu.test(outside);
  const titled = TITLE_WORD.test(outside) && /\b(ist|is|sei|=|soll|should)\b/iu.test(outside) && !/\b(kein|keine|not|no|nicht)\s+(der\s+|the\s+|a\s+)?(titel|title)/iu.test(outside);

  // "Himel ist falsch, muss Himmel sein" / "Himel is wrong, should be Himmel" (the last correction counts).
  const wrong = /((?:\S+\s+){0,2}\S+)\s+(?:ist|is)\s+(?:ein\s+|a\s+)?(?:falsch|wrong|tippfehler|typo)\b(.*)$/iu.exec(outside.trim());
  const fixedTo = wrong
    ? [...wrong[2]!.matchAll(/\b(?:mu?ss?|soll|sollte|should(?:\s+be)?|richtig(?:\s+ist)?|also|ich meine|i mean|sorry|nein|statt dessen|instead)\s+(?:es\s+|be\s+)?(?:heißen\s+|sein\s+)?[„"']?([\p{L}\p{M}'-]+)/giu)].at(-1)?.[1]
    : undefined;
  const shouldBe =
    /\bsteht\s+[„"]?([\p{L}\p{M}'-]+)[“"]?,?\s+(?:soll(?:te)?|muss)\s+(?:es\s+)?[„"]?([\p{L}\p{M}'-]+)[“"]?\s+(?:heißen|sein)\b/iu.exec(outside) ??
    /[„"]?([\p{L}\p{N}\p{M}'-]+(?:\s+[\p{L}\p{N}\p{M}'-]+)?)[“"]?\s+(?:should be|soll(?:te)? (?:sein|heißen)|muss (?:sein|heißen)|→|->)\s+[„"]?([\p{L}\p{N}\p{M}'-]+(?:\s+[\p{L}\p{N}\p{M}'-]+)?)[“"]?\s*[.!]?\s*$/iu.exec(outside);
  const bareFix = wrong && !fixedTo ? /^,?\s*[„"]?([\p{L}\p{M}'-]+)[“"]?\s*[.!]?\s*$/iu.exec(wrong[2]!)?.[1] : undefined;
  // "the prayer itself should be verses" names a kind, not new wording.
  const kindNamed = shouldBe ? KIND_WORDS.some(([re]) => re.test(shouldBe[2]!)) : false;
  if (shouldBe && !wrong && !kindNamed && offer("editText")) {
    plan.action = "editText";
    plan.quote = shouldBe[1]!;
    plan.replacement = shouldBe[2]!;
  } else if (wrong && (fixedTo || bareFix) && offer("editText")) {
    plan.action = "editText";
    // "in alle Weit is Tippfehler": the words before it place the typo; only the last word changes.
    const phrase = wrong[1]!.replace(/[„“"'.,:;]/gu, "").replace(/^(das wort|the word|in abschnitt \d+|abschnitt \d+)\s+/iu, "").trim();
    const words = phrase.split(/\s+/u);
    plan.quote = phrase;
    plan.replacement = [...words.slice(0, -1), (fixedTo ?? bareFix)!].join(" ");
  } else if (quotes.length >= 2 && (EDIT_WORD.test(outside) || REPLACE_WORD.test(outside)) && !removes) {
    plan.action = offer("editText");
    plan.quote = quotes[0];
    plan.replacement = quotes[1];
  } else if (titled && offer("setTitle")) {
    plan.action = "setTitle";
    // "Der Titel ist Das Vaterunser" / "title is Evening Prayers": the words after it.
    const typed =
      /\b(?:titel|title)\s*[,:]?\s*(?:also|nämlich|namely|i\.e\.)\s+(.+?)(?:\s+(?:nicht|not|und nicht)\b.*)?$/iu.exec(outside)?.[1] ??
      /\b(?:titel|title)\s+(?:ist|is|sei|soll\s+sein|should\s+be|=)\s*:?\s*(.+)$/iu.exec(outside)?.[1];
    const named = quotes[0] ?? typed?.replace(/[.!]+$/u, "").trim();
    if (named && !/^(das|this|that|es|it|der|die|the)(\s+(oben|hier|da|here|above|first one))?$/iu.test(named) && named.length <= 120) plan.title = named;
  } else if (MERGE_WORD.test(outside) && offer("merge")) {
    plan.action = "merge";
  } else if (removes && SPEAKER_NOUN.test(outside) && !LABEL_WORD.test(outside) && !quote) {
    plan.action = offer("removeSpeaker");
    // "den Priester-Sprecher weg, Leser soll bleiben": the first one named goes.
    const first = speakerInWords(decisive.split(/[,;]|\b(aber|but|und|and)\b/iu)[0] ?? decisive, custom);
    if (first && first !== "all") plan.onlySpeaker = first;
  } else if (INCLUDE_WORD.test(outside)) {
    plan.action = offer("include");
  } else if (removes && (quote || LABEL_WORD.test(outside)) && offer("removeText")) {
    plan.action = "removeText";
  } else if (EXCLUDE_WORD.test(outside) || (EXCLUDE_WEAK.test(outside) && !kind) || (removes && !asks)) {
    plan.action = offer("exclude");
  } else if (speaker && (SPEAKER_WORD.test(outside) || !kind) && !asks && !kindAfterSpeaker(outside)) {
    plan.action = offer("setSpeaker");
    plan.speaker = speaker;
  } else if (kind === "annotation" && (quote || INLINE_WORD.test(outside)) && offer("note")) {
    // Decided against the block's text later: the whole block → kind.
    plan.action = "note";
  } else if (kind && !asks) {
    plan.action = "setKind";
    plan.kind = kind;
  } else if (asks) {
    plan.action = "answer";
  } else if (EDIT_WORD.test(outside)) {
    plan.action = offer("editText");
  }
  if (plan.action === "setKind" && kind) plan.kind = kind;
  if (plan.action !== "setSpeaker") delete plan.speaker;
  if (plan.action === "setSpeaker") delete plan.kind;

  // "Kondakion auch", "und abschnitt 4 auch", "ich meinte nur Abschnitt 2": the previous change on what this names.
  if (!plan.action && previous?.plan?.action && previous.plan.action !== "answer" && (ALSO.test(outside) || CORRECTION.test(outside) || HERE.test(outside))) {
    const rest = outside.replace(ALSO_ALL, " ").replace(CORRECTION, " ").replace(/\b(und|and|nur|only|bitte|please|das|this|hier|here|in|the|one|der|die|that|eins)\b/giu, " ").replace(/\s+/g, " ").trim();
    const numbered = sectionNumbers(instruction).length > 0 || bareNumbers(instruction).length > 0;
    return {
      ...previous.plan,
      correct: plan.correct,
      followUp: false,
      words: [...new Set([...(previous.plan.words ?? []), ...(plan.words ?? [])])],
      extend: previous.plan.action === "merge" && /\b(auch|too|also|as well)\b/iu.test(outside),
      ...(rest && !numbered && !HERE.test(outside) ? { subject: rest } : {}),
    };
  }
  if (previous && previous.blocks.length > 0 && plan.action !== "answer") {
    const named = sectionNumbers(instruction).length > 0 || bareNumbers(instruction).length > 0 || Boolean(quote);
    const short = outside.trim().split(/\s+/u).length <= 6;
    if (!named && !HERE.test(outside) && (REFERENCE.test(outside) || short || plan.correct)) plan.followUp = true;
    // "Nein, Leser." after a speaker answer: the same action again.
    if (!plan.action && (plan.followUp || plan.correct) && previous.action) {
      if (speaker && (previous.action === "setSpeaker" || previous.action === "setKind" || previous.action === "removeSpeaker")) {
        plan.action = "setSpeaker";
        plan.speaker = speaker;
      } else if (kind && (previous.action === "setKind" || previous.action === "setSpeaker" || previous.action === "note")) {
        plan.action = "setKind";
        plan.kind = kind;
      } else if (plan.correct && previous.plan?.action) {
        // "ich meinte nur Abschnitt 2": the same change, on other blocks.
        return { ...previous.plan, correct: true, followUp: false, words: [...new Set([...(previous.plan.words ?? []), ...(plan.words ?? [])])] };
      }
    }
  }
  return plan;
}

/** The passage an instruction is about, when typed out: the text before "ist" / "is" / "sagt", or after "mach … zur". */
function subjectOf(outside: string): string | undefined {
  const t = outside.trim();
  const made = /^(?:kannst du\s+|can you\s+|bitte\s+|please\s+)?(?:mach|mache|make|set|setze?|turn)\s+(.+?)\s+(?:zur|zum|zu einer|zu einem|zu|into|to|a|an|as|als)\s/iu.exec(t)?.[1];
  const said =
    /^(.+?)\s+(?:ist|is|sind|are|=)\s/iu.exec(t)?.[1] ?? /^(.+?)\s+(?:sagt|says|singt|sings|liest|reads|gehör\w*|belongs?)\s/iu.exec(t)?.[1];
  const from = /\b(?:from|von|vom|bei|beim|for|für|on)\s+(?:the\s+|der\s+|dem\s+|den\s+)?(.+?)\s*[.!?]*$/iu.exec(t)?.[1];
  const raw = made ?? said ?? from;
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/^(nein|no|und|and|aber|but)[,\s]+/iu, "")
    .replace(/^(die zeile mit|der abschnitt mit|der teil mit|die stelle mit|das mit|the line with|the part with|the bit with|die zeile|der abschnitt|the line|the section)\s+/iu, "")
    .replace(/^(der|die|das|the)\s+/iu, "")
    .replace(/(…|\.\.\.)\s*$/u, "")
    .replace(/[:,;]?\s+(das|dies|this|that|es|it)$/iu, "")
    .replace(/\s+(zeilen|abschnitte|lines|sections|blocks|blöcke)$/iu, "")
    .trim();
  return /^(das|dies|this|that|it|es|er|sie|der|die|oben|unten)$/iu.test(cleaned) || cleaned.length < 3 ? undefined : cleaned;
}

/** What is left of a short instruction without command words ("troparion 2. ton kleinere überschrift" → "troparion 2. ton"). */
function residualOf(outside: string): string | undefined {
  let t = outside;
  for (const [re] of KIND_WORDS) t = t.replace(new RegExp(re.source, "giu"), " ");
  t = t
    .replace(new RegExp(REMOVE_WORD.source, "giu"), " ")
    .replace(/\b(ist|is|sind|are|ein|eine|einer|a|an|the|der|die|das|zur|zum|zu|mach|make|bitte|please|auch|too|also|nur|only|soll|should|sein|be|kein|keine|nicht|not)\b/giu, " ")
    .replace(/[?!.,;:]+\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  return t.length >= 4 && t.split(" ").length <= 8 ? t : undefined;
}

/** "Samstag und alles danach", "bei allem": the user means every one of them. */
export function meansAll(instruction: string): boolean {
  return REST.test(instruction) || ALL_WORD.test(withoutQuotes(instruction));
}

/** Numbers standing alone in a short message ("und 15 auch weg", "bei 3"), not counts ("40 mal"). */
export function bareNumbers(instruction: string): number[] {
  const text = withoutQuotes(instruction).replace(PAREN, " ");
  if (text.trim().split(/\s+/u).length > 12) return [];
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\d.,])(\d{1,3})(?![\d.,])(?!\s*(?:mal\b|x\b|×|times|\.|-?\s*ton|tone|ode|раз|ori\b|fois|veces|φορές))/giu)) {
    // "Ode 1", "Psalm 50", "Ton 4" name a hymn, not a section.
    if (/(ode|psalm|ps|ton|tone|kontakion|ikos|kathisma|stasis|stichos|ψαλμ\S*|глас|псалом)\s*$/iu.test(text.slice(0, m.index))) continue;
    // "Datum 24 August", "um 15 Uhr": a date or a time.
    const after = text.slice(m.index! + m[0].length);
    if (/^\s*(jan|feb|mär|mar|apr|mai|may|jun|jul|aug|sep|okt|oct|nov|dez|dec|янв|фев|мар|апр|мая|июн|июл|авг|сен|окт|ноя|дек|uhr|h\b|:)/iu.test(after) || /(datum|date|am|den|um)\s*$/iu.test(text.slice(0, m.index))) continue;
    out.push(Number(m[1]));
  }
  return out;
}

/** A section as the rules see it. */
export type ChatSection = { block: string; n: number; ns?: number[]; text: string; visible: boolean; speaker?: string; kind?: string };

/** Letters and digits only, for matching typed text against a section ("Troparion, 4.Ton" = "Troparion, 4. Ton"). */
const squash = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\d]+/gu, "");

/**
 * The sections the wording names, without the model: numbers, chips, "bei
 * allem", only blocks of a named speaker, "oben"/"am Ende", the previous
 * answer's blocks for a follow-up, quoted words, the text before "ist"
 * ("Troparion, 4. Ton ist Überschrift"), a distinctive word ("die
 * Kommentare weg"). Null when only the model can tell.
 */
export function ruleTargets(
  instruction: string,
  plan: ChatPlan,
  sections: readonly ChatSection[],
  options: { chips?: readonly string[]; previous?: ChatTurn } = {},
): string[] | null {
  const visible = sections.filter((s) => s.visible);
  // Leaving out / taking back in also finds sections that are left out ("already left out").
  const pool = plan.action === "include" || plan.action === "exclude" ? sections : visible;
  const withNext = (ids: string[]) => {
    if (REST.test(instruction) && ids.length >= 1) {
      const at = visible.findIndex((s) => s.block === ids[0]);
      if (at >= 0) return visible.slice(at).map((s) => s.block);
    }
    if (!BELOW.test(instruction) || ids.length !== 1) return ids;
    const at = visible.findIndex((s) => s.block === ids[0]);
    return at >= 0 && visible[at + 1] ? [ids[0]!, visible[at + 1]!.block] : ids;
  };
  const last = Math.max(0, ...sections.map((s) => s.n)) || undefined;
  const numbers = [...new Set([...sectionNumbers(instruction, last), ...bareNumbers(instruction)])];
  if (numbers.length > 0) {
    const hits = sections.filter((s) => numbers.includes(s.n) || s.ns?.some((n) => numbers.includes(n)));
    // "and 8 too" after merging 6 and 7: 6 (now holding 7) and 8.
    const extra = plan.extend && options.previous ? options.previous.blocks.filter((b) => sections.some((s) => s.block === b)) : [];
    if (hits.length > 0) return withNext([...new Set([...extra, ...hits.map((s) => s.block)])]);
  }
  if (options.chips && options.chips.length > 0) return withNext([...options.chips]);
  // "das hier" without a selection: the user has to point at it.
  if (HERE.test(instruction)) return [];
  const outside = withoutQuotes(instruction);
  if (plan.onlySpeaker) return visible.filter((s) => s.speaker === plan.onlySpeaker).map((s) => s.block);
  if (ALL_WORD.test(outside) && !plan.quote) return visible.map((s) => s.block);
  // Several sections start the same ("Kondakion, 4. Ton" on every day): the next one after the previous answer, else the first.
  const order = sections.map((s) => s.block);
  const after = options.previous?.blocks.length ? Math.max(...options.previous.blocks.map((b) => order.indexOf(b))) : -1;
  const nearest = (hits: ChatSection[]) => [(hits.find((h) => order.indexOf(h.block) > after) ?? hits[0]!).block];
  const match = (text: string, max = 5): string[] | null => {
    const q = squash(text);
    if (q.length < 2) return null;
    const exact = pool.filter((s) => squash(s.text) === q);
    if (exact.length > 0) return exact.length > 1 && !ALL_WORD.test(instruction) && max < 99 && plan.subject ? nearest(exact) : exact.map((s) => s.block);
    const starts = q.length >= 3 ? pool.filter((s) => squash(s.text).startsWith(q)) : [];
    if (starts.length > 1 && max < 99 && !ALL_WORD.test(instruction)) return nearest(starts);
    if (starts.length > 0 && starts.length <= max) return starts.map((s) => s.block);
    const within = q.length >= 4 || (q.length === 3 && /\d/u.test(q)) ? pool.filter((s) => squash(s.text).includes(q)) : [];
    if (within.length > 0 && within.length <= max) return within.map((s) => s.block);
    return null;
  };
  if (plan.quote) {
    const q = squash(plan.quote);
    const hits = q.length >= 2 ? pool.filter((s) => squash(s.text).includes(q)) : [];
    if (hits.length > 0) {
      const exact = hits.filter((s) => squash(s.text) === q);
      // A follow-up keeps to the previous blocks when the quote is there.
      const prev = options.previous?.blocks ?? [];
      const inPrev = hits.filter((s) => prev.includes(s.block));
      return withNext((exact.length > 0 ? exact : plan.followUp && inPrev.length > 0 ? inPrev : hits).map((s) => s.block));
    }
  }
  let subject = plan.subject ?? subjectOf(outside) ?? residualOf(outside);
  // "der letzte Amen", "the first Amen": one of several.
  const pickOne = subject ? /^(?:der |die |das |the )?(letzte[nrs]?|last|erste[nrs]?|first)\s+/iu.exec(subject) : null;
  if (pickOne) subject = subject!.slice(pickOne[0].length);
  if (subject) {
    const hits = match(subject, pickOne ? 99 : 5);
    if (hits) return withNext(pickOne ? (/^(letzt|last)/iu.test(pickOne[1]!) ? hits.slice(-1) : hits.slice(0, 1)) : hits);
  }
  for (const word of plan.words ?? []) {
    const hits = pool.filter((s) => s.text.toLowerCase().includes(word));
    if (hits.length > 0 && hits.length <= 3) return withNext(hits.map((s) => s.block));
  }
  // Leaving out "oben"/"am Ende" looks at every section: chrome there may already be left out.
  if (TOP_WORD.test(outside)) return (plan.action === "exclude" ? sections : visible).slice(0, 1).map((s) => s.block);
  if (END_WORD.test(outside) && plan.action === "exclude") {
    const tail: string[] = [];
    for (let i = sections.length - 1; i >= 0 && (!sections[i]!.visible || sections[i]!.kind !== "verse"); i--) tail.unshift(sections[i]!.block);
    return tail;
  }
  if (END_WORD.test(outside)) {
    // The stuff at the end: the trailing sections that are not spoken text (menus, footers); never the prayer's last words.
    const tail: string[] = [];
    for (let i = visible.length - 1; i >= 0 && visible[i]!.kind !== "verse"; i--) tail.unshift(visible[i]!.block);
    if (plan.action !== "exclude") return visible.slice(-1).map((s) => s.block);
    // Nothing after the prayer looks like site chrome: never guess into the prayer.
    return tail;
  }
  for (const word of plan.words ?? []) {
    const hits = pool.filter((s) => s.text.toLowerCase().includes(word));
    if (hits.length > 0 && hits.length <= 3) return withNext(hits.map((s) => s.block));
  }
  if (plan.followUp && options.previous && options.previous.blocks.length > 0) return [...options.previous.blocks];
  return null;
}

/** Section numbers as ranges: [3,4,5,9] → "3–5, 9". */
export function numberRanges(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j > i + 1 ? `${sorted[i]}–${sorted[j]}` : j === i + 1 ? `${sorted[i]}, ${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return parts.join(", ");
}

/** Reasons for unchanged sections, grouped: "sections 161–198 are already left out". */
export function groupSkips(skips: ReadonlyArray<{ n: number; reason: string }>): string {
  const by = new Map<string, number[]>();
  for (const s of skips) by.set(s.reason, [...(by.get(s.reason) ?? []), s.n]);
  return [...by]
    .map(([reason, ns]) => (ns.length === 1 && ns[0] === 0 ? reason : ns.length === 1 ? `section ${ns[0]} ${reason}` : `sections ${numberRanges(ns)} ${reason.replace(/^is /u, "are ").replace(/^has /u, "have ")}`))
    .join("; ");
}

// ---------------------------------------------------------------------------
// The model's part: one answer in a fixed JSON shape

export type ChatParagraph = { n: number; text: string; kind?: string; speaker?: string };

/** JSON schema the model's plan must follow (a grammar holds it to it). */
export function chatPlanSchema(view: ChatView, kinds: readonly string[], speakers: readonly string[]) {
  return {
    type: "object",
    properties: {
      // Undo only by the rules (an explicit "rückgängig").
      action: { enum: chatActions(view).filter((a) => a !== "undo") },
      sections: { type: "array", items: { type: "integer" } },
      kind: { enum: ["none", ...kinds] },
      speaker: { enum: ["none", ...speakers] },
      quote: { type: "string" },
    },
    required: ["action", "sections", "kind", "speaker", "quote"],
  } as const;
}

const PLAN_SYSTEM = `You turn an editor's instruction about an Orthodox liturgical text into a plan for a prayer editor. The text is split into numbered sections.
Actions:
- setKind: the role of whole sections (heading, subheading, annotation = an instruction with no spoken words, verse = spoken or sung words).
- setSpeaker: who says a section (priest, deacon, reader, choir, people …). A printed label like "Leser:" or "Priester:" at the start names the speaker; the editor removes it.
- removeSpeaker, exclude (not part of the prayer), include (take back in).
- note: some words inside a section are an instruction ("(dreimal)", "Verneigung"); put those exact words in quote.
- removeText: delete the quoted words or a printed label from sections.
- editText: change wording. setTitle: the prayer's title. merge: join neighbouring sections. undo: take back the last change.
- answer: a question; nothing changes.
Leaving out site menus, footers, comments or "the stuff at the end" is exclude.
Sections: the numbers the instruction is about; if it says "this", "that", "there" or corrects the previous answer, use the sections of the previous answer.
quote: exact words copied from a section, or "". kind / speaker: "none" unless the action needs one.`;

/**
 * The model's prompt for a plan: the conversation so far, the sections
 * (with kind and speaker) and the instruction. `known` is what the rules
 * already settled; the model is told to keep it.
 */
export function chatPlanRequest(options: {
  instruction: string;
  view: ChatView;
  history: readonly ChatTurn[];
  paragraphs: readonly ChatParagraph[];
  selected: readonly number[];
  known: ChatPlan;
  numberOf: (block: string) => number | undefined;
}): { system: string; user: string } {
  const { instruction, history, paragraphs, selected, known, numberOf } = options;
  const lines = paragraphs.map((p) => {
    const tags = [p.kind, p.speaker ? `speaker ${p.speaker}` : ""].filter(Boolean).join(", ");
    const flat = p.text.replace(/\s+/g, " ").trim();
    return `${p.n}. ${tags ? `[${tags}] ` : ""}${flat.length > 160 ? `${flat.slice(0, 159)}…` : flat}`;
  });
  let list = "";
  for (const line of lines) {
    if (list.length + line.length > 5000) {
      list += "…\n";
      break;
    }
    list += `${line}\n`;
  }
  const past = history.slice(-4).map((t) => {
    const ns = t.blocks.map(numberOf).filter((n): n is number => n !== undefined);
    return `User: ${t.instruction}\nEditor: ${t.summary}${ns.length ? ` (sections ${ns.join(", ")})` : ""}`;
  });
  const settled = Object.entries(known)
    .filter(([k, v]) => v !== undefined && k !== "followUp" && k !== "replacement")
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  const user = [
    `Sections:\n${list}`,
    past.length ? `Conversation so far:\n${past.join("\n")}` : "",
    selected.length ? `Selected sections: ${selected.join(", ")}` : "",
    settled.length ? `Already settled (keep): ${settled.join("; ")}` : "",
    `Instruction: ${instruction}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: PLAN_SYSTEM, user };
}

/** The model's answer as a plan; unknown values are dropped. */
export function readChatPlan(
  raw: unknown,
  options: { view: ChatView; kinds: readonly string[]; speakers: readonly string[] },
): ChatPlan {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const plan: ChatPlan = {};
  if (typeof r.action === "string" && r.action !== "undo" && (chatActions(options.view) as string[]).includes(r.action)) {
    plan.action = r.action as ChatAction;
  }
  if (typeof r.kind === "string" && options.kinds.includes(r.kind)) plan.kind = r.kind;
  if (typeof r.speaker === "string" && options.speakers.includes(r.speaker)) plan.speaker = r.speaker;
  if (typeof r.quote === "string" && r.quote.trim()) plan.quote = r.quote.trim();
  if (Array.isArray(r.sections)) {
    plan.sections = [...new Set(r.sections.filter((n): n is number => Number.isInteger(n) && n > 0))];
  }
  return plan;
}

/** Rules win; the model fills the gaps. */
export function mergeChatPlans(rules: ChatPlan, model: ChatPlan): ChatPlan {
  const out: ChatPlan = { ...model };
  for (const [k, v] of Object.entries(rules)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** Kinds and speakers a plan may name in this draft. */
export function chatPlanOptions(draft: ImportDraft | null): { kinds: string[]; speakers: string[] } {
  const kinds = [...KIND_PRESETS, ...(draft?.kinds.map((k) => k.id) ?? [])];
  const custom = draft?.variants.flatMap((v) => Object.keys(v.speakers ?? {})) ?? [];
  return {
    kinds: [...new Set(kinds)],
    speakers: [...new Set([...SPEAKER_PRESETS, ...custom])],
  };
}

// ---------------------------------------------------------------------------
// Changes for a plan on the Import draft

export type ChatSkip = { block: string; reason: string };

function find(text: string, quote: string): { start: number; end: number } | null {
  const at = text.toLowerCase().indexOf(quote.toLowerCase());
  if (at >= 0) return { start: at, end: at + quote.length };
  // Same words with other spacing or line breaks.
  const words = quote.trim().split(/\s+/u).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return null;
  const m = new RegExp(words.join("\\s+"), "iu").exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** The inline annotations of a block, lower case. */
function noteTexts(draft: ImportDraft, block: DraftBlock, key: string): string[] {
  const content = draftBlockContent(draft, block, key);
  if (!content) return [];
  const lines = "lines" in content ? content.lines : [content.text];
  return lines.flatMap((l) => (typeof l === "string" ? [] : l.filter((r) => r.t === "note").map((r) => r.v.toLowerCase())));
}

function plainOf(draft: ImportDraft, block: DraftBlock, key: string): string {
  return draftBlockPlainText(draft, block, key);
}

/** A printed speaker name for `speaker` ("Leser" in "Leser: …") per Variant. */
function labelCuts(draft: ImportDraft, block: DraftBlock, speaker: string | null) {
  const cuts: Array<{ variant: string; end: number; label: string; names: boolean }> = [];
  for (const key of Object.keys(block.content)) {
    const label = speakerLabelAt(plainOf(draft, block, key));
    if (label) cuts.push({ variant: key, end: label.end, label: label.label, names: label.speaker === speaker });
  }
  return cuts;
}

/**
 * The Import operations for a plan on its blocks, and why blocks were left
 * as they were ("already Reader", "„(dreimal)“ is not in this section").
 * `editText` without a replacement needs the model's wording and is not
 * built here (see {@link editTextOps}).
 */
export function chatImportOps(
  draft: ImportDraft,
  plan: ChatPlan,
  blocks: readonly string[],
  speakerName: (id: string) => string = speakerDisplayLabel,
): { ops: ImportOp[]; skipped: ChatSkip[] } {
  const ops: ImportOp[] = [];
  const skipped: ChatSkip[] = [];
  const main = draft.variants[0]!.key;
  const targets = blocks.map((id) => draft.blocks.find((b) => b.id === id)).filter((b): b is DraftBlock => Boolean(b));
  const skip = (block: string, reason: string) => skipped.push({ block, reason });
  const segsOf = (b: DraftBlock) => [...new Set(Object.values(b.content).flat().flatMap((s) => ("seg" in s ? [s.seg] : [])))];

  // Naming a left-out section to change its kind or speaker brings it back in.
  if (plan.action === "setKind" || plan.action === "setSpeaker" || plan.action === "note") {
    const hidden = targets.filter((b) => !draftBlockVisible(draft, b)).flatMap((b) => segsOf(b));
    if (hidden.length > 0) ops.push({ op: "setExcluded", segments: [...new Set(hidden)], excluded: false });
  }
  switch (plan.action) {
    case "setTitle": {
      const first = targets[0];
      const title = (plan.title ?? (first ? plainOf(draft, first, main) : "")).replace(/\s+/g, " ").trim();
      if (!title) break;
      if (draft.variants[0]!.title === title) skip(plan.title ? "" : (first?.id ?? ""), plan.title ? `the title is already „${title}“` : "is already the title");
      else ops.push({ op: "setVariantMeta", variant: main, patch: { title } });
      // The title's own line is a heading.
      if (first && !plan.title && first.kind !== "heading") ops.push({ op: "setKind", target: { block: first.id }, kind: "heading" });
      break;
    }
    case "merge": {
      const order = draft.blocks.map((b) => b.id);
      const sorted = [...targets].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      if (sorted.length < 2) {
        if (sorted[0]) skip(sorted[0].id, "needs a second section to merge with (name both, e.g. “5 und 6”)");
        break;
      }
      // A heading names what follows: it stays its own section.
      // A genre label ("Troparion, 4. Ton") names the hymn below it: it is never merged into it.
      const genre = sorted.filter((b) => readerKindOf(plainOf(draft, b, main)) === "heading");
      if (genre.length > 0 && genre.length < sorted.length) {
        for (const b of genre) skip(b.id, "is a heading naming the hymn below; it stays a section of its own");
        break;
      }
      const visible = draft.blocks.filter((b) => draftBlockVisible(draft, b)).map((b) => b.id);
      const adjacent = sorted.every((b, i) => i === 0 || visible.indexOf(b.id) === visible.indexOf(sorted[i - 1]!.id) + 1);
      if (!adjacent) {
        for (const b of sorted) skip(b.id, "is not next to the others; only neighbouring sections can be merged");
        break;
      }
      for (let i = 1; i < sorted.length; i++) ops.push({ op: "merge", block: sorted[0]!.id });
      break;
    }
    case "setKind": {
      const kind = plan.kind;
      if (!kind) break;
      for (const b of targets) {
        // "die Zeile mit dreimal ist eine Anweisung": the bracketed instruction inside a verse, not the verse.
        if (kind === "annotation" && !plan.quote && b.kind === "verse") {
          const marked = noteTexts(draft, b, main);
          if ((plan.words ?? []).some((w) => marked.some((n) => n.includes(w)))) {
            skip(b.id, `already has „${marked.find((n) => (plan.words ?? []).some((w) => n.includes(w)))}“ marked as an instruction`);
            continue;
          }
          const text = plainOf(draft, b, main);
          const ranges = inlineNoteRanges(text).filter((r) =>
            (plan.words ?? []).some((w) => text.slice(r.start, r.end).toLowerCase().includes(w)),
          );
          if (ranges.length > 0) {
            for (const r of ranges) ops.push({ op: "setNote", block: b.id, variant: main, start: r.start, end: r.end, note: true });
            continue;
          }
        }
        // "„(dreimal)“ ist eine Anmerkung" about part of a verse: inline.
        if (kind === "annotation" && plan.quote) {
          const text = plainOf(draft, b, main);
          const hit = find(text, plan.quote);
          if (hit && text.slice(0, hit.start).trim() + text.slice(hit.end).trim() !== "") {
            ops.push({ op: "setNote", block: b.id, variant: main, start: hit.start, end: hit.end, note: true });
            continue;
          }
        }
        if (b.kind === kind) skip(b.id, `already ${kindDisplayLabel(kind)}`);
        else ops.push({ op: "setKind", target: { block: b.id }, kind });
      }
      break;
    }
    case "setSpeaker": {
      const speaker = plan.speaker;
      if (!speaker) break;
      const named: Record<string, string> = {};
      for (const b of targets) {
        // A heading among several targets is not spoken: keep it a heading.
        if (targets.length > 1 && (b.kind === "heading" || b.kind === "subheading")) {
          skip(b.id, "is a heading; headings have no speaker");
          continue;
        }
        if (!kindAllowsSpeaker(b.kind, draft)) ops.push({ op: "setKind", target: { block: b.id }, kind: "verse" });
        const cuts = labelCuts(draft, b, speaker);
        for (const cut of cuts) {
          ops.push({ op: "removeText", block: b.id, variant: cut.variant, start: 0, end: cut.end });
          if (cut.names && !named[cut.variant]) named[cut.variant] = cut.label;
        }
        if (b.speaker === speaker) {
          if (cuts.length === 0) skip(b.id, `already has the speaker ${speakerName(speaker)}`);
          continue;
        }
        ops.push({ op: "setSpeaker", block: b.id, speaker });
      }
      if (ops.length > 0) ops.push(...speakerNameOps(draft, speaker, named));
      break;
    }
    case "removeSpeaker":
      for (const b of targets) {
        if (plan.onlySpeaker && b.speaker !== plan.onlySpeaker) continue;
        if (b.speaker === undefined) skip(b.id, "has no speaker");
        else ops.push({ op: "setSpeaker", block: b.id, speaker: null });
      }
      break;
    case "exclude":
    case "include": {
      const leave = plan.action === "exclude";
      const segs: string[] = [];
      for (const b of targets) {
        // Described, not named: spoken text is never left out on a guess.
        const text = plainOf(draft, b, main).trim();
        if (leave && !plan.explicit && draftBlockVisible(draft, b) && b.kind === "verse" && text.length > 30 && /[.!?;:…»”"]$/u.test(text)) {
          skip(b.id, "looks like prayer text; name its number to leave it out");
          continue;
        }
        if (draftBlockVisible(draft, b) === leave) segs.push(...segsOf(b));
        else skip(b.id, leave ? "is already left out" : "is already in");
      }
      if (segs.length > 0) ops.push({ op: "setExcluded", segments: [...new Set(segs)], excluded: leave });
      break;
    }
    case "note":
      for (const b of targets) {
        const text = plainOf(draft, b, main);
        if (plan.quote) {
          const hit = find(text, plan.quote);
          if (!hit) {
            skip(b.id, `„${plan.quote}“ is not in this section`);
          } else if (text.slice(0, hit.start).trim() + text.slice(hit.end).trim() === "") {
            // The whole section: it is an annotation block.
            if (b.kind === "annotation") skip(b.id, "already Annotation");
            else ops.push({ op: "setKind", target: { block: b.id }, kind: "annotation" });
          } else {
            ops.push({ op: "setNote", block: b.id, variant: main, start: hit.start, end: hit.end, note: true });
          }
        } else {
          const ranges = inlineNoteRanges(text);
          if (ranges.length === 0) skip(b.id, "no bracketed instruction found; put the words in quotes");
          for (const r of ranges) ops.push({ op: "setNote", block: b.id, variant: main, start: r.start, end: r.end, note: true });
        }
      }
      break;
    case "removeText":
      for (const b of targets) {
        let any = false;
        for (const key of Object.keys(b.content)) {
          const text = plainOf(draft, b, key);
          if (plan.quote) {
            const hit = find(text, plan.quote);
            if (!hit) continue;
            // "Leser" at the start also takes its colon and the space after it.
            let end = hit.end;
            const rest = /^:?\s*/u.exec(text.slice(end))![0];
            if (hit.start === 0 || rest.startsWith(":")) end += rest.length;
            ops.push({ op: "removeText", block: b.id, variant: key, start: hit.start, end });
            any = true;
          } else {
            const end = labelPrefixEnd(text);
            if (end === 0) continue;
            ops.push({ op: "removeText", block: b.id, variant: key, start: 0, end });
            any = true;
          }
        }
        if (!any) {
          const label = plan.quote ? speakerForLabel(plan.quote) : undefined;
          skip(
            b.id,
            label && b.speaker
              ? `has no „${plan.quote}:“ any more; it became the speaker ${speakerName(b.speaker)}`
              : plan.quote
                ? `„${plan.quote}“ is not in this section`
                : "has no label at the start",
          );
        }
        // A printed speaker label that goes still names the speaker.
        const label = speakerLabelAt(plainOf(draft, b, main));
        if (any && label && b.speaker === undefined && (!plan.quote || find(label.label, plan.quote.replace(/:$/u, "")))) {
          if (!kindAllowsSpeaker(b.kind, draft)) ops.push({ op: "setKind", target: { block: b.id }, kind: "verse" });
          ops.push({ op: "setSpeaker", block: b.id, speaker: label.speaker });
          ops.push(...speakerNameOps(draft, label.speaker, { [main]: label.label }));
        }
      }
      break;
    case "editText":
      if (plan.quote && plan.replacement !== undefined) {
        for (const b of targets) {
          let any = false;
          for (const key of Object.keys(b.content)) {
            const text = plainOf(draft, b, key);
            const hit = find(text, plan.quote);
            if (!hit) continue;
            ops.push(...editTextOps(draft, b.id, key, text.slice(0, hit.start) + plan.replacement + text.slice(hit.end)));
            any = true;
          }
          if (!any) skip(b.id, `„${plan.quote}“ is not in this section`);
        }
      }
      break;
    default:
      break;
  }
  return { ops, skipped };
}

/** New wording for a block in one Variant (lines for verse). */
export function editTextOps(draft: ImportDraft, block: string, variant: string, text: string): ImportOp[] {
  const b = draft.blocks.find((x) => x.id === block);
  if (!b || text === plainOf(draft, b, variant)) return [];
  return [{ op: "setText", block, variant, content: b.kind === "verse" ? text.split("\n") : text }];
}

/** The plan in one line for the user: "Speaker Reader for 12", "Inline annotation „(dreimal)“ in 3". */
export function chatPlanSummary(plan: ChatPlan, sections: readonly number[], speakerName: (id: string) => string): string {
  const where = sections.length === 0 ? "" : sections.length === 1 ? ` in section ${sections[0]}` : ` in sections ${numberRanges(sections)}`;
  const q = plan.quote ? ` „${plan.quote}“` : "";
  switch (plan.action) {
    case "setKind":
      return `Kind ${plan.kind ? kindDisplayLabel(plan.kind) : "?"}${where}`;
    case "setSpeaker":
      return `Speaker ${plan.speaker ? speakerName(plan.speaker) : "?"}${where}`;
    case "removeSpeaker":
      return `No speaker${plan.onlySpeaker ? ` ${speakerName(plan.onlySpeaker)}` : ""}${where}`;
    case "exclude":
      return `Leave out${where.replace(" in ", " ")}`;
    case "include":
      return `Take back in${where.replace(" in ", " ")}`;
    case "note":
      return plan.quote ? `Inline annotation${q}${where}` : `Bracketed instructions as inline annotations${where}`;
    case "removeText":
      return plan.quote ? `Remove${q}${where.replace(" in ", " from ")}` : `Remove the printed label${where.replace(" in ", " from ")}`;
    case "setTitle":
      return plan.title ? `Title „${plan.title}“` : `Title from${where.replace(" in ", " ")}`;
    case "merge":
      return `Merge${where.replace(" in ", " ")}`;
    case "undo":
      return "Undo the last change";
    case "editText":
      return plan.replacement !== undefined ? `Replace${q} with „${plan.replacement}“${where}` : `Change the wording${where}`;
    default:
      return "Answer";
  }
}
