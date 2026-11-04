import {
  applyImportOps,
  createImportDraft,
  draftCorrections,
  emptyMemory,
  learnCorrections,
  mergeCorrections,
  readText,
  type LibraryMemory,
  type MemoryCorrection,
  type ImportDraft,
  type ImportOp,
  type ImportOrigin,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import type { ConfirmRequest, ToolHost } from "../../src/agentTools/toolDirectory";
import { applyMemoryRules, runFirstDraft } from "../../src/builtInModel/firstDraft";
import { standInRuntime } from "../../src/builtInModel/standInModel";
import { applyBlockEdits } from "../../src/prayerEdit/blockEdits";
import { prayerFileText } from "../../src/session/persistPrayer";

export const EXISTING: Prayer = {
  id: "ostergebete",
  type: "prayer",
  variants: [{ lang: "de", variant: "standard", title: "Ostergebete", license: "CC0", source: "Test" }],
  structure: [
    { id: "b1", kind: "verse", translations: [{ lang: "de", variant: "standard", lines: ["Christus ist erstanden!"] }] },
  ],
};

/**
 * The session an Agent talks to: an in-memory Library plus the open Import
 * draft. Like the app, the user's corrections of model decisions are
 * learned into the Library memory when the draft is saved.
 */
export function memoryHost(
  options: { confirm?: boolean; prayers?: Prayer[]; selected?: string; memory?: LibraryMemory } = {},
) {
  const files: Record<string, string> = Object.fromEntries(
    (options.prayers ?? [EXISTING]).map((p) => [`${p.id}.json`, prayerFileText(p)]),
  );
  /** Unsaved edits by prayer id (the session's drafts). */
  const unsaved: Record<string, Prayer> = {};
  const confirms: ConfirmRequest[] = [];
  let draft: ImportDraft | null = null;
  let memory = options.memory ?? emptyMemory();
  let corrections: MemoryCorrection[] = [];
  const steps: ImportDraft[] = [];
  const asked: string[] = [];
  const host: ToolHost = {
    appVersion: "0.3.8",
    library: () => ({
      entries: Object.entries(files).map(([path, text]) => {
        const p = JSON.parse(text) as Prayer;
        return { id: p.id, title: p.variants[0]!.title, path, valid: true, kinds: ["verse"] };
      }),
      variants: [{ lang: "de", variant: "standard" }],
    }),
    readPrayer: async (id) => {
      if (unsaved[id]) return unsaved[id];
      const text = files[`${id}.json`];
      return text ? (JSON.parse(text) as Prayer) : null;
    },
    readSource: async (input, id) => ({ source: readText(input.text ?? "", { id }), originHint: null }),
    importDraft: () => draft,
    memory: () => memory,
    startImport: ({ source, origin, variant }) => {
      draft = createImportDraft({ sources: [source], variant: { ...variant, source: origin } });
      corrections = [];
    },
    applyImportOps: (ops: ImportOp[], origin: ImportOrigin = { by: "agent" }) => {
      const result = applyImportOps(draft!, ops, origin);
      if (!result.ok) return false;
      steps.push(draft!);
      if (origin.by === "human") corrections = mergeCorrections(corrections, draftCorrections(draft!, result.draft));
      draft = result.draft;
      return true;
    },
    confirm: async (request) => {
      asked.push(request.title);
      confirms.push(request);
      return options.confirm ?? true;
    },
    createPrayer: async (prayer) => {
      const path = `${prayer.id}.json`;
      if (path in files) return false;
      files[path] = prayerFileText(prayer);
      if (draft) memory = learnCorrections(memory, draft, corrections, "2026-11-02T10:00:00.000Z");
      return true;
    },
    closeImport: () => {
      draft = null;
    },
    runFirstDraft: () => {
      const apply = (ops: ImportOp[], origin: ImportOrigin) => {
        const result = applyImportOps(draft!, ops, origin);
        if (result.ok) draft = result.draft;
      };
      applyMemoryRules(draft!, memory, apply);
      return runFirstDraft({
        draft: draft!,
        runtime: standInRuntime(),
        current: () => draft,
        apply: (step) => apply(step.ops, step.origin),
        signal: new AbortController().signal,
        memory,
      });
    },
    selectedPrayer: () => {
      if (draft || !options.selected) return null;
      return unsaved[options.selected] ?? (JSON.parse(files[`${options.selected}.json`]!) as Prayer);
    },
    editPrayers: async (list) => {
      for (const { prayer, edits } of list) {
        const current = unsaved[prayer] ?? (JSON.parse(files[`${prayer}.json`]!) as Prayer);
        unsaved[prayer] = applyBlockEdits(current, edits);
      }
      return list.length;
    },
  };
  /** Undo the last applied step (like the app's Undo). */
  const undo = () => {
    const previous = steps.pop();
    if (!previous) return false;
    draft = previous;
    return true;
  };
  return { host, files, steps, asked, confirms, unsaved, undo, draft: () => draft, memory: () => memory };
}

