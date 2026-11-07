/**
 * Decisions: the questions the Built-in model answers for the first draft.
 * Each question has a fixed set of options; the model's answer is the
 * probability of each option (read from one evaluation, no free text). This
 * module owns the questions as data, the prompt text and how answers become
 * Import operations. Rules follow the `encode-prayer` skill.
 */
import {
  applyImportOps,
  draftBlockPlainText,
  draftBlockVisible,
  type DraftBlock,
  type ImportDraft,
  type ImportOp,
  type ImportOrigin,
} from "./importDraft.js";
import type { SegmentLook } from "./importSource.js";
import { isValidSpeakerId, presetSpeakerName, SPEAKER_PRESETS } from "./speakers.js";

export type DecisionKind = "role" | "prefix" | "speaker" | "pair" | "action" | "choice" | "scope" | "target";

export type DecisionOption = { id: string; label: string };

/** One thing to decide about one block. */
export type DecisionItem = {
  block: string;
  /** What the model reads for this item (one line). */
  text: string;
  /** For `prefix`: the label before the colon and where the words start. */
  prefix?: { label: string; end: number; next: number };
};

/** One question asked about many blocks in a row (the model reads them all once). */
export type DecisionBatch = {
  kind: DecisionKind;
  /** Variant key the item texts come from. */
  variant: string;
  question: string;
  options: DecisionOption[];
  /** Worked examples shown before the items: text → option id. */
  examples?: Array<[string, string]>;
  /** The editor's own rules in plain words (Library memory hints). */
  hints?: string[];
  items: DecisionItem[];
};

/** Answer for one item: probability per option, in option order (sums to 1). */
export type DecisionAnswer = number[];

/**
 * Below this probability a model decision is shown as uncertain (and is
 * shown first by "n to check"). Calibrated on the test set (Nov 2026):
 * answers at 0.9–1.0 were right 92% of the time, at 0.8–0.9 75%, below that
 * about half.
 */
export const UNCERTAIN_BELOW = 0.85;

const LETTERS = "ABCDEFGHIJKLMNOP";

const ROLE_OPTIONS: DecisionOption[] = [
  { id: "heading", label: "heading: names the item that follows (“Ostertroparion im 5. Ton”, “Psalm 50”)" },
  { id: "subheading", label: "subheading: a second heading level below a heading" },
  { id: "annotation", label: "annotation: an instruction with no spoken words of its own (“Dann dreimal:”, “Stehend.”)" },
  { id: "verse", label: "verse: words that are said or sung, including doxologies, Amen and “Herr, erbarme Dich!”" },
  { id: "exclude", label: "not part of the prayer: site navigation, page numbers, copyright, “print this page”" },
];

const SPEAKER_NAMES: Record<string, string> = {
  bishop: "the bishop",
  priest: "the priest",
  deacon: "the deacon",
  reader: "the reader",
  cantor: "the cantor",
  choir: "the choir",
  people: "the people",
  all: "everyone",
};

const PREFIX_OPTIONS: DecisionOption[] = [
  { id: "heading", label: "a hymn or genre label naming what follows (Troparion, Kontakion, Psalm)" },
  { id: "note", label: "an instruction how or how often to say it (Dann vierzigmal, Stehend)" },
  { id: "speaker", label: "who speaks (Priester, Diakon, Chor, Volk)" },
  { id: "text", label: "the start of the spoken words themselves" },
];

const SPEAKER_OPTIONS: DecisionOption[] = [
  ...SPEAKER_PRESETS.map((id) => ({ id, label: SPEAKER_NAMES[id]! })),
  { id: "other", label: "someone else" },
];

/** Speaker labels as printed (lower case) → preset id; others go to the model. */
const SPEAKER_LABEL_LIST: Record<string, string[]> = {
  // One- or two-letter labels some books use ("P:", "D:", "L:", "Ch:"); only ever matched as "X:" at a line start.
  bishop: ["bischof", "bishop", "архиерей", "епископ", "владыка", "αρχιερευς", "επισκοπος", "episcopul", "arhiereul", "епископ", "архијереј"],
  priest: ["priester", "priest", "pfarrer", "иерей", "священник", "ιερευς", "preotul", "preot", "свештеник", "јереј", "celebrant"],
  deacon: ["diakon", "deacon", "диакон", "διακονος", "diaconul", "diacon", "ђакон", "протодиакон", "protodiakon", "protodeacon"],
  reader: ["leser", "lektor", "vorleser", "reader", "чтец", "αναγνωστης", "citetul", "citeţul", "читач"],
  cantor: ["kantor", "cantor", "psalmist", "psalmsänger", "sänger", "vorsänger", "chanter", "псаломщик", "певец", "ψαλτης", "psaltul", "cantaretul", "cântăreţul", "cântărețul", "strana", "појац"],
  choir: ["chor", "choir", "хор", "лик", "χορος", "corul", "хор"],
  people: ["volk", "people", "gemeinde", "wir", "люди", "народ", "λαος", "poporul", "credinciosii", "народ"],
  all: ["alle", "all", "все", "παντες", "toti", "toţi", "toți", "сви"],
};

/** Lower case, accents off, a leading article dropped ("Der Priester", "Ὁ Ἱερεύς"). */
function labelKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(der|die|das|the|ο|η|οι)\s+/u, "")
    .replace(/\s*[([][^)\]]*[)\]]\s*$/u, "")
    .replace(/[.:)\]]+$/u, "")
    .trim();
}

/** Short forms some books print ("P:", "D:", "L:", "Ch:"); only as a label before a colon. */
const SPEAKER_ABBREVIATIONS: Record<string, string> = { p: "priest", pr: "priest", d: "deacon", l: "reader", ch: "choir", chr: "choir", v: "people", с: "priest", д: "deacon", х: "choir" };

/** Speaker labels as printed (normalized, see labelKey) → preset id; others go to the model. */
const SPEAKER_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SPEAKER_LABEL_LIST).flatMap(([id, labels]) => labels.map((l) => [labelKey(l), id]))),
  ...SPEAKER_ABBREVIATIONS,
};

const PAIR_OPTIONS: DecisionOption[] = [
  { id: "same", label: "the same passage in two languages" },
  { id: "different", label: "different passages" },
];

const RULES = `You sort the paragraphs of an Orthodox liturgical text for a prayer editor.
Classify by role, not by typeface: genre labels and instructions often look alike in print.
Spoken liturgical text is verse: the Gloria Patri ("Ehre sei dem Vater…"), "Jetzt und immerdar… Amen.", "Herr, erbarme Dich!", the Trisagion, Theotokia and hymns. A trailing colon does not make a doxology an instruction.
An instruction that only introduces a named hymn is an annotation. A description of what the priest, deacon or choir does ("Der Priester betet leise …", "The deacon censes …", "Диакон кадит …") is an annotation, even when it is long.
Greek, Church Slavonic or other languages inside the text are verse like the rest.`;

/** Worked examples for the role question, in the language of the source (German when there is none). */
const ROLE_EXAMPLES: Record<string, Array<[string, string]>> = {
  de: [
    ["Ostertroparion im 5. Ton", "heading"],
    ["Dann dreimal das Ostertroparion:", "annotation"],
    ["Der Diakon tritt vor die Königstür und spricht:", "annotation"],
    ["Ehre sei dem Vater und dem Sohne und dem Heiligen Geiste:", "verse"],
    ["Impressum · Seite drucken", "exclude"],
  ],
  en: [
    ["Troparion of the Resurrection, Tone 5", "heading"],
    ["Then thrice the paschal troparion:", "annotation"],
    ["The deacon stands before the holy doors and says:", "annotation"],
    ["Glory to the Father and to the Son and to the Holy Spirit:", "verse"],
    ["Home · Contact · Donate", "exclude"],
  ],
  ru: [
    ["Тропарь Пасхи, глас 5", "heading"],
    ["Затем трижды тропарь:", "annotation"],
    ["Диакон, став пред царскими вратами, возглашает:", "annotation"],
    ["Слава Отцу и Сыну и Святому Духу:", "verse"],
    ["Главная · Контакты · Поиск", "exclude"],
  ],
  el: [
    ["Ἀπολυτίκιον. Ἦχος πλ. α´", "heading"],
    ["Εἶτα τὸ τροπάριον ἐκ γ´:", "annotation"],
    ["Ὁ Διάκονος ἵσταται πρὸ τῆς ὡραίας πύλης καὶ λέγει:", "annotation"],
    ["Δόξα Πατρὶ καὶ Υἱῷ καὶ Ἁγίῳ Πνεύματι:", "verse"],
    ["Αρχική · Επικοινωνία", "exclude"],
  ],
  ro: [
    ["Troparul Învierii, glasul al 5-lea", "heading"],
    ["Apoi de trei ori troparul:", "annotation"],
    ["Diaconul stă în fața ușilor împărătești și zice:", "annotation"],
    ["Slavă Tatălui și Fiului și Sfântului Duh:", "verse"],
    ["Acasă · Contact", "exclude"],
  ],
};
ROLE_EXAMPLES.cu = ROLE_EXAMPLES.ru!;

function roleExamples(lang: string): Array<[string, string]> {
  return ROLE_EXAMPLES[lang.toLowerCase().split(/[-_]/)[0] ?? ""] ?? ROLE_EXAMPLES.de!;
}


/** Compact appearance for the model: "bold, 14pt, centered, style Heading 1". */
export function describeLook(look: SegmentLook): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(look)) {
    if (key === "column" || value === false || value === "") continue;
    if (value === true) parts.push(key);
    else if (key === "size" && typeof value === "number") parts.push(`${value}pt`);
    else if (String(value).length <= 24) parts.push(`${key} ${value}`);
  }
  return parts.join(", ");
}

function oneLine(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function blockLook(draft: ImportDraft, block: DraftBlock, variant: string): string {
  const first = block.content[variant]?.find((s) => "seg" in s);
  if (!first || !("seg" in first)) return "";
  for (const source of draft.sources) {
    const seg = source.segments.find((s) => s.id === first.seg);
    if (seg) return describeLook(seg.look);
  }
  return "";
}

/** "Priester:" at the start: a label of up to ~6 words, then the words. */
// A period only after a digit ("im 4. Ton"), never as a sentence end.
const PREFIX_RE = /^([^\s:.!?;](?:[^:.!?;\n]|(?<=\d)\.){0,48}?):\s+(?=\S)/u;

/**
 * The first-draft questions for a fresh Import draft: the role of every
 * visible block, what a "Label:" at the start of a block is, and whether
 * blocks paired by order really are the same passage.
 */
export function firstDraftBatches(draft: ImportDraft): DecisionBatch[] {
  const main = draft.variants[0]!.key;
  const visible = draft.blocks.filter((b) => draftBlockVisible(draft, b) && b.content[main]);
  // A block with a speaker, or with a known speaker label, is spoken text:
  // the reader decides it (see readerRuleOps), the model is not asked.
  const open = visible.filter((b) => {
    const text = draftBlockPlainText(draft, b, main);
    return b.speaker === undefined && !speakerLabelAt(text) && !speakerRubricAt(text) && !readerKindOf(text);
  });
  const role: DecisionBatch = {
    kind: "role",
    variant: main,
    question: "Which role does each paragraph have?",
    options: ROLE_OPTIONS,
    examples: roleExamples(draft.variants[0]!.lang),
    // One line per paragraph. Measured on the test set (Nov 2026): quoting the neighbours made the
    // 4B model worse (role 94% → 89%), and a second look at unsure answers gained nothing.
    items: open.map((b) => {
      const look = blockLook(draft, b, main);
      const text = oneLine(draftBlockPlainText(draft, b, main));
      return { block: b.id, text: look ? `(${look}) ${text}` : text };
    }),
  };
  const prefix: DecisionBatch = {
    kind: "prefix",
    variant: main,
    question: "Each line starts with a quoted label before a colon. What is the label?",
    options: PREFIX_OPTIONS,
    examples: [
      ['"Diakon" → Diakon: Lasset uns beten zum Herrn.', "speaker"],
      ['"Troparion im 4. Ton" → Troparion im 4. Ton: Dein Märtyrer, o Herr …', "heading"],
      ['"Dann dreimal" → Dann dreimal: Herr, erbarme Dich!', "note"],
      ['"Herr" → Herr: erbarme Dich unser.', "text"],
    ],
    items: open.flatMap((b) => {
      const text = draftBlockPlainText(draft, b, main);
      const m = PREFIX_RE.exec(text);
      if (!m) return [];
      const label = m[1]!;
      return [
        {
          block: b.id,
          text: `"${label}" → ${oneLine(text, 160)}`,
          prefix: { label, end: label.length + 1, next: m[0].length },
        },
      ];
    }),
  };
  const batches = [role];
  if (prefix.items.length > 0) batches.push(prefix);
  const other = draft.variants[1]?.key;
  if (other) {
    const pairs = visible.filter((b) => b.content[other]);
    if (pairs.length > 0) {
      batches.push({
        kind: "pair",
        variant: main,
        question: "Is each pair the same passage in two languages?",
        options: PAIR_OPTIONS,
        items: pairs.map((b) => ({
          block: b.id,
          text: `${oneLine(draftBlockPlainText(draft, b, main), 120)} || ${oneLine(draftBlockPlainText(draft, b, other), 120)}`,
        })),
      });
    }
  }
  return batches;
}

/** A text that shows, in the main Variant only (a paired block cannot be cut for one language). */
function structureBlocks(draft: ImportDraft, main: string): DraftBlock[] {
  return draft.blocks.filter((b) => draftBlockVisible(draft, b) && b.content[main]);
}

const decidedByHuman = (b: DraftBlock) => b.origin.kind?.by === "human";

/** The preset a printed speaker label names ("Priester" → priest), if known. */
export function speakerForLabel(label: string): string | undefined {
  return SPEAKER_LABELS[labelKey(label)];
}

/**
 * A known speaker label at the start of a text ("Leser: Psalm 50 …"): the
 * label, its speaker and where the spoken words start. Null otherwise.
 */
export function speakerLabelAt(text: string): { label: string; speaker: string; end: number } | null {
  const m = PREFIX_RE.exec(text);
  if (!m) return null;
  const speaker = speakerForLabel(m[1]!);
  return speaker ? { label: m[1]!, speaker, end: m[0].length } : null;
}

/**
 * A rubric naming the speaker before the words ("Der Priester tritt vor den
 * Thron: Gesegnet …", "Священник, начиная каждение: Благословен …"): the
 * speaker and where the rubric (with its colon) ends. Null otherwise.
 */
export function speakerRubricAt(text: string): { speaker: string; end: number } | null {
  const m = /^([^:\n]{3,120}):\s+(?=\S)/u.exec(text);
  if (!m || speakerLabelAt(text)) return null;
  const words = labelKey(m[1]!).split(/[\s,]+/u).filter(Boolean);
  if (words.length < 2) return null;
  const speaker = words[0]!.length > 2 ? SPEAKER_LABELS[words[0]!] : undefined;
  // "Alle Engel …:", "Volk Gottes …:" open prayers; only clergy, reader, cantor and choir open a rubric.
  if (!speaker || speaker === "all" || speaker === "people") return null;
  return { speaker, end: m[1]!.length + 1 };
}

/** Any "Label: " at the start of a text (known or not): its end, or 0. */
export function labelPrefixEnd(text: string): number {
  return PREFIX_RE.exec(text)?.[0].length ?? 0;
}

const INLINE_NOTE_WORDS =
  /(\d+\s*(?:mal|x|×)\b|\b(?:x|×)\s*\d+|\p{L}*mal\b|dreimal|zweimal|stehend|kniend|verneig|verbeug|kreuzzeichen|bekreuzig|metanie|leise|laut|ekphonese|ausruf|times|thrice|twice|bow|standing|kneel|aloud|quietly|сугубо|трижды|дважды|поклон|раз\b|crossing|ori\b|ἐκ\s|ἐκ\b|ἐκ τρίτου|διάψαλμα|χαμηλοφώνως|ἐκφώνως|ثلاث)/iu;
/** "(3)", "(γ')", "(ιβ´)": a count in brackets; "(oder …)", "(или …)": an alternative to read instead. */
const INLINE_NOTE_SHAPES = /^[([]\s*(\d{1,3}|[\p{Script=Greek}]{1,3}\s*['´ʹ΄’]|(oder|or|или|ή|sau|ili|bzw\.?)\s.+|(für|for|in der|zur|во|в) .{2,40}(zeit|tage?n?|sonntage?n?|days?|sundays?|время|дни)\b.*)\s*[)\]]$/iu;
const BRACKETED = /\([^()\n]{1,60}\)|\[[^[\]\n]{1,60}\]/gu;

/**
 * Inline annotations in a text: bracketed instructions like "(dreimal)" or
 * "[Verneigung]" inside spoken words. Ranges in plain-text offsets; never
 * the whole text.
 */
export function inlineNoteRanges(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const m of text.matchAll(BRACKETED)) {
    if (!INLINE_NOTE_WORDS.test(m[0]) && !INLINE_NOTE_SHAPES.test(m[0])) continue;
    const start = m.index!;
    const end = start + m[0].length;
    if (text.slice(0, start).trim() === "" && text.slice(end).trim() === "") continue;
    out.push({ start, end });
  }
  return out;
}

/**
 * What the reader settles without the model, before the first draft: a
 * known speaker label at a block's start becomes the speaker (label cut, its
 * wording kept as the speaker's name in the Variant), bracketed instructions
 * inside the text become inline annotations. Blocks someone already decided
 * keep their speaker.
 */
export function readerRuleOps(draft: ImportDraft): ImportOp[] {
  const main = draft.variants[0];
  if (!main) return [];
  const joins = pageBreakJoinOps(draft);
  const joined = joins.length > 0 ? applyImportOps(draft, joins, { by: "reader" }) : null;
  const first = joined?.ok ? joined.draft : draft;
  const done = joined?.ok ? joins : [];
  const splits = lineSplitOps(first, main.key);
  if (splits.length > 0) {
    const split = applyImportOps(first, splits, { by: "reader" });
    if (split.ok) return [...done, ...splits, ...labelAndNoteOps(split.draft)];
  }
  return [...done, ...labelAndNoteOps(first)];
}

/**
 * A paragraph a page break cut apart: the next visible block starts the next
 * page in the same column and print, there is no sentence end above and a
 * small letter below. Fixed rule, not a Decision: on the test set (Nov 2026)
 * the model joined nearly anything that looked unfinished, also across the
 * columns of a two-language book. From the end, so a chain joins up.
 */
export function pageBreakJoinOps(draft: ImportDraft): ImportOp[] {
  const main = draft.variants[0]?.key;
  if (!main) return [];
  const segments = new Map(draft.sources.flatMap((source) => source.segments.map((seg) => [seg.id, seg] as const)));
  const edge = (b: DraftBlock, end: boolean) => {
    const spans = (b.content[main] ?? []).flatMap((s) => ("seg" in s ? [s.seg] : []));
    return segments.get((end ? spans.at(-1) : spans[0]) ?? "");
  };
  const visible = structureBlocks(draft, main);
  const ops: ImportOp[] = [];
  for (let i = visible.length - 2; i >= 0; i--) {
    const upper = visible[i]!;
    const lower = visible[i + 1]!;
    if (Object.keys(upper.content).length > 1 || Object.keys(lower.content).length > 1) continue;
    if (decidedByHuman(upper) || decidedByHuman(lower)) continue;
    const a = edge(upper, true);
    const b = edge(lower, false);
    if (!a?.area || !b?.area || b.area.page !== a.area.page + 1) continue;
    if (a.area.column !== b.area.column || a.group !== b.group) continue;
    const above = draftBlockPlainText(draft, upper, main).trim();
    const below = draftBlockPlainText(draft, lower, main).trim();
    if (/[.!?:;…»”")\]·]$/u.test(above) || !/^\p{Ll}/u.test(below)) continue;
    ops.push({ op: "merge", block: upper.id });
  }
  return ops;
}

const INSTRUCTION_START =
  /^(dann|danach|darauf|hierauf|anschließend|nun|und dann|der (priester|diakon|bischof|leser|chor|psalmist)|die (gläubigen|sänger)|then|after(wards)?|the (priest|deacon|reader|choir|people)|затем|потом|далее|и ныне|apoi|după aceea|preotul|diaconul)\b/iu;
const SAYS = /(spricht|sagt|singt|liest|ruft|betet|says|sings|reads|exclaims|глаголет|поет|читает|zice|cântă)\b[^:]*:$/iu;

/**
 * Where one paragraph of the page holds several blocks (lines joined by
 * <br>): before a line with a known speaker label, before a line that is
 * an instruction ("Anschließend liest …", "Then the priest …"), after an
 * instruction ending in a colon ("… spricht vor den königlichen Türen:"), and
 * around a genre label on a line of its own.
 */
export function lineSplitOffsets(text: string): number[] {
  const out: number[] = [];
  let at = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i > 0 && line.trim()) {
      const prev = lines[i - 1]!.trim();
      if (
        speakerLabelAt(line.trimStart()) ||
        INSTRUCTION_START.test(line.trimStart()) ||
        (SAYS.test(prev) && !speakerLabelAt(prev)) ||
        // "Troparion, 4. Ton" / "Psalm 50" on a line of its own names what follows.
        readerKindOf(line) === "heading" ||
        readerKindOf(prev) === "heading"
      ) {
        out.push(at);
      }
    }
    // "… von Ewigkeit zu Ewigkeit. L: Amen.": a label after a sentence end inside the line.
    for (const m of line.matchAll(/(?<=[.!?»”])\s+(?=([\p{L}]{1,12}):\s+\S)/gu)) {
      if (speakerForLabel(m[1]!)) out.push(at + m.index! + m[0].length);
    }
    at += line.length + 1;
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function lineSplitOps(draft: ImportDraft, v: string): ImportOp[] {
  const ops: ImportOp[] = [];
  for (const b of draft.blocks) {
    if (!draftBlockVisible(draft, b) || !b.content[v] || Object.keys(b.content).length > 1) continue;
    const text = draftBlockPlainText(draft, b, v);
    // From the end, so earlier offsets stay valid in the upper part.
    for (const at of lineSplitOffsets(text).reverse()) {
      if (text.slice(0, at).trim() && text.slice(at).trim()) ops.push({ op: "split", block: b.id, variant: v, at });
    }
  }
  return ops;
}

const GENRE =
  "(kondakion|kontakion|kondak|ikos|troparion|tropar|troparia|theotokion|theotokia|stavrotheotokion|irmos|heirmos|ode|stichera|stichiren|sticheron|prokimenon|prokeimenon|alleluia|halleluja|exapostilarion|svetilen|kathisma|kathismata|stasis|antiphon|psalm|psalmus|hymnus|hymn|canon|kanon|akathistos|akathist|ektenie|ektenia|litany|apolytikion|megalynarion|кондак|икос|тропарь|тропари|богородичен|ирмос|песнь|стихира|стихиры|прокимен|аллилуиа|светилен|кафизма|псалом|канон|акафист|ектения|κοντακιον|οικος|απολυτικιον|τροπαριον|θεοτοκιον|ειρμος|ωδη|ψαλμος|στιχηρα|προκειμενον|κανων|condac|icos|tropar|irmos|cântarea|psalmul)";
const TONE = "(ton|tone|tonus|глас|ηχος|glas|glasul|plagal|πλ\\.?)";
/** "2. Kondakion", "Ikos 3", "Troparion, 4. Ton", "Psalm 50", "Тропарь, глас 4", "ᾨδὴ α´": names what follows. */
const GENRE_HEADING = new RegExp(
  String.raw`^(?:[\dIVXLC]{1,4}\.?\s*|\p{L}{1,3}[´'ʹ΄]\s*)?${GENRE}(?![\p{L}])[\s,.:;–—-]*(?:(?:\d{1,3}|[IVXLC]{1,4}|\p{L}{1,3}[´'ʹ΄])\.?[\s,.:;–—-]*)?(?:(?:im\s+|in\s+the\s+|in\s+)?(?:\d{1,2}\.?\s*|\p{L}{1,3}[´'ʹ΄]\s*)?${TONE}\.?\s*(?:πλ\.?\s*|plagal\s+)?(?:\d{1,2}|[IVXLC]{1,4}|\p{L}{1,3}[´'ʹ΄])?\.?)?\s*(?:\([^)]{1,30}\))?\s*:?$`,
  "iu",
);
const ROLE_NOUN = /(priester|diakon|chor\b|psalmist|leser|sänger|kantor|bischof|zelebrant|priest\b|deacon|choir|reader|chanter|bishop|священник|диакон|хор\b|чтец|иерей|архиерей|ιερε[υύ]ς|διάκονος|preotul|diaconul)/iu;
const RUBRIC_VERB =
  /\b(betet|beten|spricht|sprechen|singt|singen|reicht|legt|weihräuchert|beräuchert|inzensiert|verneigt|verneigen|küßt|küsst|tritt|treten|steht|stehen|folgen|folgt|liest|trägt|tragen|macht|öffnet|schließt|geht|gehen|kehrt|nimmt|segnet|erhebt|wendet|weist|beginnt|says|reads|sings|prays|bows|censes|takes|stands|goes|enters|exits|makes|opens|closes|blesses|читает|глаголет|поет|поют|кадит|творит|возглашает|входит|выходит)\b/iu;
const RUBRIC_OPENER =
  /^(während|nachdem|darauf|danach|anschließend|hierauf|dann|sodann|am sonntag|an werktagen|in der übrigen zeit|vom schlafe|nach (dem|der|diesem|beendigung)|then|after (this|that|the)|while|затем|потом|после|и абие|apoi|după)\b/iu;
const QA = /^(frage|antwort|question|answer|вопрос|ответ)\s*:/iu;

/**
 * The kind the reader settles without the model: genre labels ("2. Kondakion",
 * "Troparion, 4. Ton") are headings; descriptions of what clergy or choir do
 * ("Der Priester betet leise das Gebet zur 1. Antiphon:", "Während der Chor
 * singt, …") and catechism questions are annotations. Undefined otherwise.
 */
export function readerKindOf(text: string): "heading" | "annotation" | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t.length > 400) return undefined;
  // Accents off for the genre words ("ᾨδὴ α´" = "ωδη α´").
  const bare = t.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  if (t.length <= 60 && GENRE_HEADING.test(bare)) return "heading";
  if (QA.test(t)) return "annotation";
  if (speakerLabelAt(t)) return undefined;
  const opener = RUBRIC_OPENER.test(t);
  if (ROLE_NOUN.test(t) && RUBRIC_VERB.test(t) && (opener || /^(der|die|das|the|priester|diakon|chor|psalmist|priest|deacon|choir|священник|диакон|хор|иерей)\b/iu.test(t))) {
    return "annotation";
  }
  if (opener && /:$/u.test(t) && t.length <= 120) return "annotation";
  return undefined;
}

/** A block that is only a speaker label ("Priester:", "DEACON", "ΙΕΡΕΥΣ (χαμηλοφώνως)"): its speaker. */
export function standaloneSpeakerLabel(text: string): string | undefined {
  const t = text.trim().replace(/[:.]$/u, "").trim();
  if (!t || t.length > 40 || /\n/u.test(t)) return undefined;
  return speakerForLabel(t);
}

function labelAndNoteOps(draft: ImportDraft): ImportOp[] {
  const main = draft.variants[0]!;
  const v = main.key;
  const ops: ImportOp[] = [];
  // "Priester:" on its own, the words in the next block: the next block gets the speaker.
  const visible = draft.blocks.filter((b) => draftBlockVisible(draft, b) && b.content[v]);
  const carried = new Map<string, { speaker: string; label: string }>();
  visible.forEach((b, i) => {
    const text = draftBlockPlainText(draft, b, v);
    const speaker = standaloneSpeakerLabel(text);
    const next = visible[i + 1];
    if (!speaker || !next || next.speaker !== undefined || standaloneSpeakerLabel(draftBlockPlainText(draft, next, v))) return;
    carried.set(next.id, { speaker, label: text.trim().replace(/[:.]$/u, "").replace(/\s*[([][^)\]]*[)\]]\s*$/u, "").trim() });
    const segs = (b.content[v] ?? []).flatMap((s) => ("seg" in s ? [s.seg] : []));
    if (segs.length > 0) ops.push({ op: "setExcluded", segments: segs, excluded: true });
  });
  let speakers = main.speakers;
  for (const b of draft.blocks) {
    if (!draftBlockVisible(draft, b) || !b.content[v]) continue;
    let text = draftBlockPlainText(draft, b, v);
    const carry = carried.get(b.id);
    if (carry && !speakerLabelAt(text)) {
      if (b.kind !== "verse") ops.push({ op: "setKind", target: { block: b.id }, kind: "verse" });
      ops.push({ op: "setSpeaker", block: b.id, speaker: carry.speaker });
      if (!speakers?.[carry.speaker] && carry.label.length > 2) speakers = { ...speakers, [carry.speaker]: { name: carry.label } };
    }
    const label = b.speaker === undefined && !carry ? speakerLabelAt(text) : null;
    const rubric = b.speaker === undefined && !carry && !label ? speakerRubricAt(text) : null;
    if (rubric) {
      // The rubric stays as an inline annotation; the words after it are the speaker's.
      if (b.kind !== "verse") ops.push({ op: "setKind", target: { block: b.id }, kind: "verse" });
      ops.push({ op: "setSpeaker", block: b.id, speaker: rubric.speaker });
      ops.push({ op: "setNote", block: b.id, variant: v, start: 0, end: rubric.end, note: true });
      if (!speakers?.[rubric.speaker]) {
        const name = presetSpeakerName(rubric.speaker, main.lang);
        if (name) speakers = { ...speakers, [rubric.speaker]: { name } };
      }
    }
    if (label) {
      if (b.kind !== "verse") ops.push({ op: "setKind", target: { block: b.id }, kind: "verse" });
      ops.push({ op: "removeText", block: b.id, variant: v, start: 0, end: label.end });
      ops.push({ op: "setSpeaker", block: b.id, speaker: label.speaker });
      if (!speakers?.[label.speaker]) {
        // "P:" is no name: the usual one in the language.
        const name = label.label.length > 2 ? label.label : (presetSpeakerName(label.speaker, main.lang) ?? label.label);
        speakers = { ...speakers, [label.speaker]: { name } };
      }
      text = text.slice(label.end);
    }
    for (const r of inlineNoteRanges(text)) {
      ops.push({ op: "setNote", block: b.id, variant: v, start: r.start, end: r.end, note: true });
    }
    // Genre headings and rubrics, unless someone already decided the kind.
    const kind = !label && !rubric && !carry && b.origin.kind?.by !== "human" && b.origin.kind?.by !== "memory" ? readerKindOf(text) : undefined;
    if (kind && b.kind !== kind) ops.push({ op: "setKind", target: { block: b.id }, kind });
  }
  if (speakers !== main.speakers) ops.push({ op: "setVariantMeta", variant: v, patch: { speakers } });
  return ops;
}

/**
 * Speaker names for every Variant that has none yet for `speaker`, in its
 * language ("Priester", "Priest" …). Null when nothing is missing.
 */
export function speakerNameOps(draft: ImportDraft, speaker: string, named?: Record<string, string>): ImportOp[] {
  const ops: ImportOp[] = [];
  for (const variant of draft.variants) {
    if (variant.speakers?.[speaker]) continue;
    const name = named?.[variant.key] ?? presetSpeakerName(speaker, variant.lang);
    if (!name) continue;
    ops.push({ op: "setVariantMeta", variant: variant.key, patch: { speakers: { ...variant.speakers, [speaker]: { name } } } });
  }
  return ops;
}

/**
 * A language paired to blocks that already have a speaker: its printed label
 * ("Priest: Christ is risen …") goes, and its name for the speaker is kept in
 * that Variant. Only labels that name the block's speaker; the text is never
 * retyped, the label is cut.
 */
export function pairedLabelOps(draft: ImportDraft, variant: string): ImportOp[] {
  const target = draft.variants.find((v) => v.key === variant);
  if (!target) return [];
  const ops: ImportOp[] = [];
  const names: Record<string, { name: string }> = {};
  for (const b of draft.blocks) {
    if (b.speaker === undefined || !b.content[variant] || Object.keys(b.content).length < 2) continue;
    const m = PREFIX_RE.exec(draftBlockPlainText(draft, b, variant));
    if (!m || speakerForLabel(m[1]!) !== b.speaker) continue;
    ops.push({ op: "removeText", block: b.id, variant, start: 0, end: m[0].length });
    if (!target.speakers?.[b.speaker] && !names[b.speaker]) names[b.speaker] = { name: m[1]! };
  }
  if (Object.keys(names).length > 0) {
    ops.push({ op: "setVariantMeta", variant, patch: { speakers: { ...target.speakers, ...names } } });
  }
  return ops;
}

/**
 * The preset a sentence names by a speaker word ("Abschnitt 5 hat den Speaker
 * Diakon" → deacon), first match. "All" is skipped: "in all prayers" is scope.
 */
export function speakerNamedIn(text: string): string | undefined {
  for (const word of labelKey(text).split(/[^\p{L}]+/u)) {
    for (const form of [word, word.replace(/(en|es|s|n)$/u, "")]) {
      const id = form.length > 2 ? SPEAKER_LABELS[form] : undefined;
      if (id && id !== "all") return id;
    }
  }
  return undefined;
}

/**
 * Follow-up for prefix items answered "who speaks" whose label is not a
 * known one: which speaker is it? Null when there is nothing to ask.
 */
export function speakerBatch(prefix: DecisionBatch, items: DecisionItem[]): DecisionBatch | null {
  const ask = items.filter((i) => i.prefix && !speakerForLabel(i.prefix.label));
  if (ask.length === 0) return null;
  return {
    kind: "speaker",
    variant: prefix.variant,
    question: "Who speaks, going by the quoted label?",
    options: SPEAKER_OPTIONS,
    examples: [
      ['"Protodiakon" → Protodiakon: Weisheit!', "deacon"],
      ['"Sänger" → Sänger: Amen.', "cantor"],
    ],
    items: ask,
  };
}

/** Text the model reads; the runtime adds the model's chat format around it. */
export type DecisionPrompt = {
  system: string;
  user: string;
  /** Option letters; the answer for item i is read right after `itemPrefix(i)`. */
  letters: string[];
  /** Index into `batch.items` of the prompt's first item. */
  first: number;
  count: number;
};

/** What the runtime appends before reading item i's answer letter. */
export function decisionItemPrefix(i: number): string {
  return `${i + 1}=`;
}

/** Prompts for a batch, at most `maxItems` items each (keeps the context small). */
export function decisionPrompts(batch: DecisionBatch, maxItems = 60): DecisionPrompt[] {
  const letters = batch.options.map((_, i) => LETTERS[i]!);
  const options = batch.options.map((o, i) => `${letters[i]}) ${o.label}`).join("\n");
  const prompts: DecisionPrompt[] = [];
  for (let first = 0; first < batch.items.length; first += maxItems) {
    const items = batch.items.slice(first, first + maxItems);
    const list = items.map((item, i) => `${i + 1}. ${item.text}`).join("\n");
    const letterOf = (id: string) => letters[batch.options.findIndex((o) => o.id === id)];
    const examples = batch.examples?.length
      ? `Examples:\n${batch.examples.map(([text, id]) => `${text} = ${letterOf(id)}`).join("\n")}\n\n`
      : "";
    const hints = batch.hints?.length ? `\nThe editor's own rules (follow them):\n${batch.hints.map((h) => `- ${h}`).join("\n")}` : "";
    prompts.push({
      system: RULES + hints,
      user: `${batch.question}\n${options}\n\n${examples}Items:\n${list}\n\nAnswer one line per item as "number=letter", in order.`,
      letters,
      first,
      count: items.length,
    });
  }
  return prompts;
}

/** Operations for one answer, with the model's confidence as origin. */
export type DecisionStep = {
  block: string;
  kind: DecisionKind;
  /** Chosen option id. */
  choice: string;
  ops: ImportOp[];
  origin: ImportOrigin;
};

function slugId(label: string): string | null {
  const id = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return isValidSpeakerId(id) ? id : null;
}

/**
 * The step for one answer, against the draft as it is now. Null when the
 * answer changes nothing or the block went away. Blocks someone else has
 * decided since the reader (human, agent, memory) keep their decision.
 */
export function decisionStep(
  draft: ImportDraft,
  batch: DecisionBatch,
  item: DecisionItem,
  answer: DecisionAnswer,
): DecisionStep | null {
  const block = draft.blocks.find((b) => b.id === item.block);
  if (!block) return null;
  let best = 0;
  for (let i = 1; i < answer.length; i++) if (answer[i]! > answer[best]!) best = i;
  const choice = batch.options[best]?.id;
  if (!choice) return null;
  const origin: ImportOrigin = { by: "model", confidence: Math.round(answer[best]! * 100) / 100 };
  const step = (ops: ImportOp[]): DecisionStep | null =>
    ops.length > 0 ? { block: block.id, kind: batch.kind, choice, ops, origin } : null;
  const decidedBySomeoneElse = (o: ImportOrigin | undefined) =>
    o !== undefined && o.by !== "reader" && o.by !== "model";
  const v = batch.variant;

  if (batch.kind === "role") {
    if (decidedBySomeoneElse(block.origin.kind)) return null;
    if (choice === "exclude") {
      const segs = (block.content[v] ?? []).flatMap((s) => ("seg" in s ? [s.seg] : []));
      return step(segs.length > 0 ? [{ op: "setExcluded", segments: [...new Set(segs)], excluded: true }] : []);
    }
    return step([{ op: "setKind", target: { block: block.id }, kind: choice }]);
  }

  if (batch.kind === "pair") {
    const other = draft.variants[1]?.key;
    if (choice !== "different" || !other || !block.content[other]) return null;
    return step([{ op: "unpairVariant", block: block.id, variant: other }]);
  }

  // prefix: the text must still start with the label.
  const p = item.prefix;
  if (!p || !draftBlockPlainText(draft, block, v).startsWith(`${p.label}:`)) return null;
  if (choice === "text") return null;
  if (choice === "heading") {
    if (decidedBySomeoneElse(block.origin.kind)) return null;
    const lower = `b${draft.nextBlock}`;
    // "Troparion im 4. Ton: Dein Märtyrer…" → heading without the colon, then verse.
    return step([
      { op: "removeText", block: block.id, variant: v, start: p.end - 1, end: p.next },
      { op: "split", block: block.id, variant: v, at: p.end - 1 },
      { op: "setKind", target: { block: block.id }, kind: "heading" },
      { op: "setKind", target: { block: lower }, kind: "verse" },
    ]);
  }
  if (choice === "note") {
    return step([
      ...(block.kind === "verse" ? [] : [{ op: "setKind" as const, target: { block: block.id }, kind: "verse" }]),
      { op: "setNote", block: block.id, variant: v, start: 0, end: p.end, note: true },
    ]);
  }
  // "speaker" (a known label) or the follow-up's choice of speaker.
  if (decidedBySomeoneElse(block.origin.speaker)) return null;
  const id =
    batch.kind === "prefix"
      ? speakerForLabel(p.label)
      : choice === "other"
        ? slugId(p.label)
        : choice;
  if (!id) return null;
  const variant = draft.variants.find((x) => x.key === v)!;
  const speakers = variant.speakers?.[id] ? variant.speakers : { ...variant.speakers, [id]: { name: p.label } };
  return step([
    ...(block.kind === "verse" ? [] : [{ op: "setKind" as const, target: { block: block.id }, kind: "verse" }]),
    { op: "removeText", block: block.id, variant: v, start: 0, end: p.next },
    { op: "setSpeaker", block: block.id, speaker: id },
    ...(speakers === variant.speakers ? [] : [{ op: "setVariantMeta" as const, variant: v, patch: { speakers } }]),
  ]);
}

/** A block's model decisions below {@link UNCERTAIN_BELOW}, for "uncertain first". */
export function uncertainDecisions(
  block: DraftBlock,
): Array<{ what: "kind" | "speaker"; confidence: number }> {
  const out: Array<{ what: "kind" | "speaker"; confidence: number }> = [];
  for (const what of ["kind", "speaker"] as const) {
    const o = block.origin[what];
    if (o?.by === "model" && o.confidence !== undefined && o.confidence < UNCERTAIN_BELOW) {
      out.push({ what, confidence: o.confidence });
    }
  }
  return out;
}
