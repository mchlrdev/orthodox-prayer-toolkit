import {
  DEFAULT_KIND_STYLES,
  FALLBACK_KIND_STYLE,
  applyTemplate,
  declareKinds,
  deleteKind,
  indexKinds,
  isKindPreset,
  removeStyleKey,
  setKindSpeaker,
  stampTemplate,
  unusedStyleKeys,
  type KindStyle,
  type KindTemplate,
  type LibraryKindSources,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import type { LibraryCatalog } from "../catalog";
import { kindAddIssue, patchKindStyle } from "../prayerEdit";
import { writeLibraryStylesFile } from "./libraryFiles";
import {
  editDraft,
  errorNotice,
  persistLibraryStyles,
  selectedDraft,
  type EditOptions,
} from "./operations";
import type {
  PrayerSessionState,
  SessionDraft,
  SessionOpResult,
} from "./types";

/**
 * Kind sources of the open library for the Core kind-index helpers: scanned
 * catalog entries (used or declared; also files that parse but do not
 * validate), except that an open draft replaces its file's entry (a kind
 * deleted in the draft is gone before the file is saved); the templates; and
 * the sanitized library style keys.
 */
export function libraryKindSources(
  catalog: LibraryCatalog | null,
  drafts: Record<string, SessionDraft>,
): LibraryKindSources {
  const prayerKinds: string[][] = [];
  for (const entry of catalog?.entries ?? []) {
    if (!(entry.path in drafts)) prayerKinds.push(entry.kinds);
  }
  for (const draft of Object.values(drafts)) {
    prayerKinds.push(indexKinds([draft.prayer]));
  }
  return {
    prayerKinds,
    templates: catalog?.templates ?? [],
    styles: catalog?.libraryStyles ?? {},
  };
}

/**
 * Custom style keys whose kind is in no prayer and no template (Core
 * `unusedStyleKeys`). Empty until the catalog scan is complete and while any
 * file is not JSON (those files could still use them). Offered for removal;
 * never deleted automatically.
 */
export function unusedLibraryStyles(state: PrayerSessionState): string[] {
  const catalog = state.catalog;
  if (!catalog?.scanComplete) return [];
  if (catalog.entries.some((e) => !e.readable)) return [];
  return unusedStyleKeys(libraryKindSources(catalog, state.drafts));
}

/**
 * Patch one kind's library style against the style map as it is now (run
 * it in the library op queue, so fast edits never build on a stale map).
 * The base is the resolved style: library entry over the built-in default.
 */
export async function patchLibraryKindStyle(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  kind: string,
  partial: Partial<KindStyle>,
): Promise<SessionOpResult> {
  const catalog = state.catalog;
  if (!catalog) return { state, notices: [] };
  const current: KindStyle = {
    ...(DEFAULT_KIND_STYLES[kind] ?? FALLBACK_KIND_STYLE),
    ...catalog.libraryStyles[kind],
  };
  return persistLibraryStyles(state, api, {
    ...catalog.libraryStyles,
    [kind]: patchKindStyle(current, partial),
  });
}

/** Remove a library style entry (e.g. an unused one). Legacy tokens stay. */
export async function removeLibraryStyle(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  kind: string,
): Promise<SessionOpResult> {
  const catalog = state.catalog;
  if (!catalog || !(kind in catalog.libraryStyles)) return { state, notices: [] };
  try {
    const written = await writeLibraryStylesFile(
      api,
      catalog,
      removeStyleKey(catalog.libraryStyles, kind),
      { remove: [kind] },
    );
    if (!written.ok) {
      return {
        state,
        notices: [
          {
            color: "accent",
            title: "Cannot remove style",
            message: written.errors.map((e) => e.message).join(" · "),
          },
        ],
      };
    }
    return { state: { ...state, catalog: written.catalog }, notices: [] };
  } catch (err) {
    return { state, notices: [errorNotice("Cannot remove style", err)] };
  }
}

/**
 * Declare a custom kind in the selected prayer (appended to its `kinds`;
 * session draft, one undo step). No style entry is written: the kind uses
 * the fallback style until its style is edited.
 */
export function addKindToPrayer(
  state: PrayerSessionState,
  id: string,
  options: { speaker?: boolean } & EditOptions = {},
): SessionOpResult {
  const draft = selectedDraft(state);
  if (!draft) return { state, notices: [] };
  const kind = id.trim();
  const issue = kindAddIssue(
    kind,
    (draft.prayer.kinds ?? []).map((k) => k.id),
  );
  if (issue) {
    return {
      state,
      notices: [{ color: "accent", title: "Cannot add kind", message: issue }],
    };
  }
  const def = options.speaker ? { id: kind, speaker: true as const } : { id: kind };
  return editDraft(state, declareKinds(draft.prayer, [def]), options);
}

/**
 * Delete a custom kind from the selected prayer only (Core `deleteKind`):
 * the entry goes and its blocks fall back to verse — one undo step.
 * Other prayers and the library style are untouched.
 */
export function deleteKindInPrayer(
  state: PrayerSessionState,
  kind: string,
): SessionOpResult {
  const draft = selectedDraft(state);
  if (!draft || isKindPreset(kind)) return { state, notices: [] };
  return editDraft(state, deleteKind(draft.prayer, kind));
}

/** Allow / disallow speakers for a declared custom kind of the selected prayer. */
export function setPrayerKindSpeaker(
  state: PrayerSessionState,
  kind: string,
  allowed: boolean,
): SessionOpResult {
  const draft = selectedDraft(state);
  if (!draft) return { state, notices: [] };
  return editDraft(state, setKindSpeaker(draft.prayer, kind, allowed));
}

function findTemplate(
  state: PrayerSessionState,
  templateId: string | null,
): KindTemplate | null {
  if (templateId === null) return null;
  return state.catalog?.templates.find((t) => t.id === templateId) ?? null;
}

/**
 * "Apply template" on the selected prayer: additive (missing kinds appended
 * in template order, existing entries unchanged), one undo step.
 */
export function applyTemplateToPrayer(
  state: PrayerSessionState,
  templateId: string,
): SessionOpResult {
  const draft = selectedDraft(state);
  const template = findTemplate(state, templateId);
  if (!draft || !template) return { state, notices: [] };
  return editDraft(state, applyTemplate(draft.prayer, template));
}

/**
 * New prayer modal: stamp a template's kinds into the create draft
 * (replaces the previous stamp; `null` = presets only).
 */
export function setCreateTemplate(
  state: PrayerSessionState,
  templateId: string | null,
): PrayerSessionState {
  if (!state.createDraft) {
    return state.createTemplateId === null ? state : { ...state, createTemplateId: null };
  }
  const template = findTemplate(state, templateId);
  return {
    ...state,
    createDraft: stampTemplate(state.createDraft, template),
    createTemplateId: template?.id ?? null,
  };
}
