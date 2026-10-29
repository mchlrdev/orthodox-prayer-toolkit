import {
  applyImportOps,
  createImportDraft,
  readText,
  type ImportDraft,
  type ImportOp,
  type ImportOrigin,
  type Prayer,
} from "@orthodox-prayer-toolkit/core";
import type { ConfirmRequest, ToolHost } from "../../src/agentTools/toolDirectory";
import { runFirstDraft } from "../../src/builtInModel/firstDraft";
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

/** The session an Agent talks to: an in-memory Library plus the open Import draft. */
export function memoryHost(options: { confirm?: boolean; prayers?: Prayer[]; selected?: string } = {}) {
  const files: Record<string, string> = Object.fromEntries(
    (options.prayers ?? [EXISTING]).map((p) => [`${p.id}.json`, prayerFileText(p)]),
  );
  /** Unsaved edits by prayer id (the session's drafts). */
  const unsaved: Record<string, Prayer> = {};
  const confirms: ConfirmRequest[] = [];
  let draft: ImportDraft | null = null;
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
    startImport: ({ source, origin, variant }) => {
      draft = createImportDraft({ sources: [source], variant: { ...variant, source: origin } });
    },
    applyImportOps: (ops: ImportOp[], origin: ImportOrigin = { by: "agent" }) => {
      const result = applyImportOps(draft!, ops, origin);
      if (!result.ok) return false;
      steps.push(draft!);
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
      return true;
    },
    closeImport: () => {
      draft = null;
    },
    runFirstDraft: () =>
      runFirstDraft({
        draft: draft!,
        runtime: standInRuntime(),
        current: () => draft,
        apply: (step) => {
          const result = applyImportOps(draft!, step.ops, step.origin);
          if (result.ok) draft = result.draft;
        },
        signal: new AbortController().signal,
      }),
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
  return { host, files, steps, asked, confirms, unsaved, draft: () => draft };
}

