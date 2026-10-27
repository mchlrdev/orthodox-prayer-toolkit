import {
  applyImportOps,
  draftBlockPlainText,
  draftBlockVisible,
  freeSourceId,
  importDraftToPrayer,
  KIND_PRESETS,
  validate,
  validateImportDraft,
  type DraftPrayerMeta,
  type DraftVariant,
  type ImportDraft,
  type ImportOp,
  type ImportOrigin,
  type Prayer,
  type Source,
} from "@orthodox-prayer-toolkit/core";
import { addColumnOps, addLanguageOps } from "../importDraft/editorOps";
import { groupLetters, segmentIndex } from "../importDraft/sourceView";
import { checkArgs, type ParamSchema } from "./schema";

/**
 * Tool directory: every Tool an external Agent (and later the Built-in
 * model) may call, with purpose, parameter schema and example. Tools act on
 * the running session through a {@link ToolHost}; Import draft changes are
 * Import operations with origin "agent", one undo step per call. Saving asks
 * the user in the app first.
 */

export type ActiveVariantRef = { lang: string; variant: string };

export type SourceInput = { text?: string; html?: string; url?: string; name?: string };

export type ToolHost = {
  appVersion: string;
  /** The open Library, or null when none is open. */
  library(): {
    entries: Array<{ id: string | null; title: string | null; path: string; valid: boolean; kinds: string[] }>;
    variants: ActiveVariantRef[];
  } | null;
  readPrayer(id: string): Promise<Prayer | null>;
  /** Run the Readers (text, HTML, web page) like the Import dialog does. */
  readSource(input: SourceInput, sourceId: string): Promise<{ source: Source; originHint: string | null }>;
  importDraft(): ImportDraft | null;
  startImport(input: { source: Source; origin: string; variant: ActiveVariantRef }): void;
  /** Apply as one undo step with origin "agent"; false when refused. */
  applyImportOps(ops: ImportOp[]): boolean;
  /** Ask the user in the app; resolves false when they decline. */
  confirm(request: { title: string; message: string; confirmLabel: string }): Promise<boolean>;
  /** Write a new prayer file (never overwrites); false when refused. */
  createPrayer(prayer: Prayer, variant: ActiveVariantRef): Promise<boolean>;
  /** Close the Import draft after it was saved. */
  closeImport(): void;
};

export class ToolError extends Error {}

const AGENT: ImportOrigin = { by: "agent" };

type Tool = {
  name: string;
  purpose: string;
  params: ParamSchema & { type: "object" };
  example: Record<string, unknown>;
  run: (host: ToolHost, args: Record<string, unknown>) => Promise<unknown>;
};

const SOURCE_PROPS: Record<string, ParamSchema> = {
  text: { type: "string", description: "Plain text; paragraphs separated by blank lines." },
  html: { type: "string", description: "An HTML page or fragment; its formatting forms style groups." },
  url: { type: "string", description: "An http(s) address; the app fetches and reads the page." },
  name: { type: "string", description: "Name shown for the Source (file name, site)." },
  origin: { type: "string", description: "Where the text is from (becomes the Variant's source)." },
  lang: { type: "string", description: "Language code, e.g. de, cu, en." },
  variant: { type: "string", description: "Edition within the language, e.g. standard." },
};

function sourceInput(args: Record<string, unknown>): SourceInput {
  const given = (["text", "html", "url"] as const).filter((k) => typeof args[k] === "string");
  if (given.length !== 1) throw new ToolError("Give exactly one of text, html or url");
  return {
    [given[0]!]: args[given[0]!] as string,
    ...(typeof args.name === "string" ? { name: args.name } : {}),
  };
}

function needDraft(host: ToolHost): ImportDraft {
  const draft = host.importDraft();
  if (!draft) throw new ToolError("No Import draft is open. Start one with import.start.");
  return draft;
}

/** The open Import draft as an Agent reads it: ids to use in Import operations. */
export function draftView(draft: ImportDraft) {
  const segments = segmentIndex(draft);
  const letters = groupLetters(draft);
  const excluded = new Set(draft.excluded);
  const validation = validateImportDraft(draft);
  return {
    variants: draft.variants.map(({ key, lang, variant, title }) => ({ key, lang, variant, title })),
    meta: draft.meta,
    kinds: [...KIND_PRESETS, ...draft.kinds.map((k) => k.id)],
    segments: draft.sources.flatMap((source) =>
      source.segments.map((seg) => ({
        id: seg.id,
        n: segments.get(seg.id)?.n,
        source: source.name,
        text: seg.text,
        look: seg.look,
        ...(seg.group ? { group: letters.get(seg.group) } : {}),
        ...(seg.marks ? { marks: seg.marks } : {}),
        ...(excluded.has(seg.id) ? { excluded: true } : {}),
      })),
    ),
    blocks: draft.blocks.map((block) => ({
      id: block.id,
      kind: block.kind,
      ...(block.speaker !== undefined ? { speaker: block.speaker } : {}),
      visible: draftBlockVisible(draft, block),
      text: Object.fromEntries(
        Object.keys(block.content).map((key) => [key, draftBlockPlainText(draft, block, key)]),
      ),
      segments: [
        ...new Set(Object.values(block.content).flat().flatMap((s) => ("seg" in s ? [s.seg] : []))),
      ],
      origin: block.origin.kind.by,
    })),
    valid: validation.ok,
    problems: validation.ok ? [] : validation.errors.map((e) => e.message),
  };
}

const TOOLS: Tool[] = [
  {
    name: "library.list",
    purpose:
      "List the prayers in the open Library (id, title, kinds) and its Variants. Read this first to follow the Library's conventions.",
    params: { type: "object", properties: {} },
    example: {},
    run: async (host) => {
      const library = host.library();
      if (!library) throw new ToolError("No Library is open in the app");
      return {
        prayers: library.entries.map(({ id, title, path, valid, kinds }) => ({ id, title, path, valid, kinds })),
        variants: library.variants,
        presetKinds: KIND_PRESETS,
      };
    },
  },
  {
    name: "prayer.read",
    purpose: "Read one prayer of the Library as Prayer JSON.",
    params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    example: { id: "ostergebete" },
    run: async (host, args) => {
      const prayer = await host.readPrayer(args.id as string);
      if (!prayer) throw new ToolError(`No prayer "${String(args.id)}" in the Library`);
      return prayer;
    },
  },
  {
    name: "prayer.validate",
    purpose: "Check Prayer JSON against the schema and rules; returns the problems.",
    params: {
      type: "object",
      properties: { prayer: { type: "object", additionalProperties: true } },
      required: ["prayer"],
    },
    example: { prayer: { id: "x", type: "prayer", variants: [], structure: [] } },
    run: async (_host, args) => {
      const result = validate(args.prayer);
      return {
        valid: result.ok,
        errors: result.ok ? [] : result.errors.map((e) => ({ path: e.path, message: e.message })),
        warnings: result.warnings.map((e) => ({ path: e.path, message: e.message })),
      };
    },
  },
  {
    name: "import.start",
    purpose:
      "Load a Source (text, HTML or a web address) into a new Import draft: one Verse block per paragraph. The user sees it in the app. Replacing an open draft asks the user first.",
    params: {
      type: "object",
      properties: SOURCE_PROPS,
      required: ["lang", "variant"],
    },
    example: {
      text: "Troparion im 5. Ton\n\nChristus ist erstanden von den Toten …",
      origin: "orthodoxe-gebete.de",
      lang: "de",
      variant: "standard",
    },
    run: async (host, args) => {
      const input = sourceInput(args);
      if (host.importDraft()) {
        const ok = await host.confirm({
          title: "Replace the import draft?",
          message: "An agent wants to start a new import. The open import draft and its changes are dropped.",
          confirmLabel: "Replace",
        });
        if (!ok) throw new ToolError("The user kept the open Import draft");
      }
      const { source, originHint } = await host.readSource(input, "s1");
      if (source.segments.length === 0) throw new ToolError("The Source has no text");
      host.startImport({
        source,
        origin: typeof args.origin === "string" ? args.origin : (originHint ?? ""),
        variant: { lang: args.lang as string, variant: args.variant as string },
      });
      return draftView(needDraft(host));
    },
  },
  {
    name: "import.read",
    purpose:
      "Read the open Import draft: Variants (keys), Source segments (id, text, look, style group), blocks (id, kind, speaker, text per Variant key, segments) and whether it is a valid prayer.",
    params: { type: "object", properties: {} },
    example: {},
    run: async (host) => draftView(needDraft(host)),
  },
  {
    name: "import.apply",
    purpose:
      'Apply Import operations to the open draft as one step (the user can undo it). Operations: setKind {target:{block}|{group}, kind}, split {block, variant, at}, merge {block, keep?}, deleteBlock {block}, setNote {block, variant, start, end, note}, setSpeaker {block, speaker|null}, removeText {block, variant, start, end}, setText {block, variant, content}, setExcluded {segments, excluded}, pairVariant {block, variant, from}, unpairVariant {block, variant}, moveBlock {block, to}, declareKind {kind:{id, speaker?}}, setPrayerMeta {patch}, setVariantMeta {variant, patch}. "variant" is a Variant key from import.read; offsets are in the block\'s plain text.',
    params: {
      type: "object",
      properties: {
        ops: { type: "array", items: { type: "object", additionalProperties: true } },
      },
      required: ["ops"],
    },
    example: {
      ops: [
        { op: "setKind", target: { block: "b1" }, kind: "heading" },
        { op: "setKind", target: { group: "s1-g2" }, kind: "annotation" },
      ],
    },
    run: async (host, args) => {
      const ops = args.ops as ImportOp[];
      if (ops.length === 0) throw new ToolError("ops is empty");
      const result = applyImportOps(needDraft(host), ops, AGENT);
      if (!result.ok) throw new ToolError(result.error);
      if (!host.applyImportOps(ops)) throw new ToolError("The draft changed meanwhile; read it again");
      return draftView(needDraft(host));
    },
  },
  {
    name: "import.addLanguage",
    purpose:
      "Add a second language to the open draft, paired with the blocks in order: from another text (text, html or url) or from a column of the Source (column: 0-based, e.g. 1 for the second column of a table or PDF).",
    params: {
      type: "object",
      properties: { ...SOURCE_PROPS, column: { type: "integer" } },
      required: ["lang", "variant"],
    },
    example: { text: "Христос воскресе из мертвых …", lang: "cu", variant: "standard", origin: "azbyka.ru" },
    run: async (host, args) => {
      const draft = needDraft(host);
      const variant = { lang: args.lang as string, variant: args.variant as string };
      const origin = typeof args.origin === "string" ? args.origin : "";
      let ops: ImportOp[];
      if (typeof args.column === "number") {
        ops = addColumnOps(draft, { column: args.column, origin, variant });
      } else {
        const { source, originHint } = await host.readSource(sourceInput(args), freeSourceId(draft));
        ops = addLanguageOps(draft, source, { ...variant, origin: origin || (originHint ?? "") });
      }
      const result = applyImportOps(draft, ops, AGENT);
      if (!result.ok) throw new ToolError(result.error);
      if (!host.applyImportOps(ops)) throw new ToolError("The draft changed meanwhile; read it again");
      return draftView(needDraft(host));
    },
  },
  {
    name: "import.save",
    purpose:
      "Save the open draft to the Library as a new prayer file {id}.json. The user confirms in the app; an existing id is never overwritten.",
    params: {
      type: "object",
      properties: {
        meta: {
          type: "object",
          description: "Prayer metadata: id (file name), type, tone, book, occasion, description.",
          additionalProperties: true,
        },
        variants: {
          type: "object",
          description: "Per Variant key: { title, license, source }.",
          additionalProperties: true,
        },
      },
      required: ["meta"],
    },
    example: {
      meta: { id: "ostertroparion", type: "troparion", tone: 5 },
      variants: { v1: { title: "Ostertroparion", license: "CC0", source: "orthodoxe-gebete.de" } },
    },
    run: async (host, args) => {
      const draft = needDraft(host);
      const variants = (args.variants ?? {}) as Record<string, unknown>;
      const ops: ImportOp[] = [
        { op: "setPrayerMeta", patch: args.meta as Partial<DraftPrayerMeta> },
        ...Object.entries(variants).map(
          ([key, patch]): ImportOp => ({
            op: "setVariantMeta",
            variant: key,
            patch: patch as Partial<Omit<DraftVariant, "key">>,
          }),
        ),
      ];
      const result = applyImportOps(draft, ops, AGENT);
      if (!result.ok) throw new ToolError(result.error);
      const prayer = importDraftToPrayer(result.draft);
      const checked = validate(prayer);
      if (!checked.ok) {
        throw new ToolError(`Not a valid prayer yet: ${checked.errors.map((e) => e.message).join(" · ")}`);
      }
      if (host.library()?.entries.some((e) => e.id === prayer.id)) {
        throw new ToolError(`"${prayer.id}" is already in the Library; choose another id`);
      }
      // The metadata is the agent's change either way; the file needs the user's yes.
      host.applyImportOps(ops);
      const first = result.draft.variants[0]!;
      const ok = await host.confirm({
        title: "Save to library?",
        message: `An agent wants to save “${first.title}” as ${prayer.id}.json (${prayer.structure.length} blocks).`,
        confirmLabel: "Save",
      });
      if (!ok) throw new ToolError("The user declined saving");
      const saved = await host.createPrayer(prayer, { lang: first.lang, variant: first.variant });
      if (!saved) throw new ToolError("The app refused to save (see the app for the reason)");
      host.closeImport();
      return { saved: `${prayer.id}.json` };
    },
  },
];

/** `GET /`: every Tool with purpose, parameter schema and example. */
export function describeTools(appVersion: string) {
  return {
    app: "Orthodox Prayer Toolkit",
    version: appVersion,
    call: "POST /tools/{name} with a JSON body of arguments (Content-Type: application/json). Answers are JSON: { ok: true, result } or { ok: false, error }.",
    tools: TOOLS.map(({ name, purpose, params, example }) => ({ name, purpose, params, example })),
  };
}

export type ToolAnswer = { ok: true; result: unknown } | { ok: false; error: string };

/** Call one Tool by name. Errors a caller can fix come back as `{ ok: false }`. */
export async function callTool(host: ToolHost, name: string, args: unknown): Promise<ToolAnswer> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `No tool "${name}". GET / lists the tools.` };
  const value = args ?? {};
  const problem = checkArgs(tool.params, value);
  if (problem) return { ok: false, error: problem };
  try {
    return { ok: true, result: await tool.run(host, value as Record<string, unknown>) };
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type AgentHttpRequest = { method: string; path: string; body: string };
export type AgentHttpResponse = { status: number; body: unknown };

/** HTTP routes over the Tool directory (the guard runs before, in the main process). */
export async function handleAgentRequest(
  host: ToolHost,
  request: AgentHttpRequest,
): Promise<AgentHttpResponse> {
  if (request.method === "GET" && (request.path === "/" || request.path === "")) {
    return { status: 200, body: describeTools(host.appVersion) };
  }
  const match = /^\/tools\/([\w.]+)$/.exec(request.path);
  if (request.method === "POST" && match) {
    let args: unknown;
    try {
      args = request.body.trim() === "" ? {} : JSON.parse(request.body);
    } catch {
      return { status: 400, body: { ok: false, error: "The body is not JSON" } };
    }
    const answer = await callTool(host, match[1]!, args);
    return { status: answer.ok ? 200 : 400, body: answer };
  }
  return { status: 404, body: { ok: false, error: "Not found. GET / lists the tools." } };
}
