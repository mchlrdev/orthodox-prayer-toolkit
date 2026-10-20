import {
  isValidTemplateId,
  templateIdFromLabel,
  type KindDef,
  type KindTemplate,
} from "@orthodox-prayer-toolkit/core";
import type { PrayerToolkitApi } from "../../electron/preload";
import { writeLibraryTemplatesFile } from "./libraryFiles";
import { setCreateTemplate } from "./kindOps";
import { errorNotice } from "./operations";
import type { PrayerSessionState, SessionOpResult } from "./types";

/** Write the full template list to `templates.json` and put it into state. */
export async function saveKindTemplates(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  templates: readonly KindTemplate[],
): Promise<SessionOpResult> {
  if (!state.catalog) return { state, notices: [] };
  try {
    const written = await writeLibraryTemplatesFile(api, state.catalog, templates);
    if (!written.ok) {
      return {
        state,
        notices: [
          { color: "accent", title: "Cannot save templates", message: written.message },
        ],
      };
    }
    return { state: { ...state, catalog: written.catalog }, notices: [] };
  } catch (err) {
    return { state, notices: [errorNotice("Cannot save templates", err)] };
  }
}

/**
 * Create a kind template. The id is derived from the label unless given.
 * Returns the new id (null when nothing was written).
 */
export async function createKindTemplate(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  input: { label: string; id?: string; kinds?: KindDef[] },
): Promise<SessionOpResult & { templateId: string | null }> {
  const templates = state.catalog?.templates ?? [];
  const label = input.label.trim();
  const id =
    input.id ?? templateIdFromLabel(label, templates.map((t) => t.id));
  if (!label || !isValidTemplateId(id) || templates.some((t) => t.id === id)) {
    return {
      state,
      notices: [
        {
          color: "accent",
          title: "Cannot create template",
          message: !label ? "Label is required" : `Invalid or duplicate id “${id}”`,
        },
      ],
      templateId: null,
    };
  }
  const result = await saveKindTemplates(state, api, [
    ...templates,
    { id, label, kinds: input.kinds ?? [] },
  ]);
  const ok = result.state !== state;
  return { ...result, templateId: ok ? id : null };
}

export type TemplateEdit =
  | { label?: string; kinds?: KindDef[] }
  | ((template: KindTemplate) => KindTemplate);

/**
 * Change one template (label and/or kind list incl. speaker flags). Pass a
 * function to edit the template as it is when the write runs (queued edits
 * never build on a stale copy). Never touches existing prayers.
 */
export async function updateKindTemplate(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  id: string,
  edit: TemplateEdit,
): Promise<SessionOpResult> {
  const templates = state.catalog?.templates ?? [];
  const current = templates.find((t) => t.id === id);
  if (!current) return { state, notices: [] };
  const next =
    typeof edit === "function"
      ? edit(current)
      : {
          ...current,
          ...(edit.label !== undefined ? { label: edit.label.trim() } : {}),
          ...(edit.kinds !== undefined ? { kinds: edit.kinds } : {}),
        };
  if (next === current) return { state, notices: [] };
  return saveKindTemplates(
    state,
    api,
    templates.map((t) => (t.id === id ? next : t)),
  );
}

/**
 * Delete a template. When it is the one stamped into the New prayer draft,
 * the stamp goes too (the draft falls back to presets only).
 */
export async function deleteKindTemplate(
  state: PrayerSessionState,
  api: PrayerToolkitApi,
  id: string,
): Promise<SessionOpResult> {
  const templates = state.catalog?.templates ?? [];
  if (!templates.some((t) => t.id === id)) return { state, notices: [] };
  const result = await saveKindTemplates(
    state,
    api,
    templates.filter((t) => t.id !== id),
  );
  return result.state !== state && result.state.createTemplateId === id
    ? { ...result, state: setCreateTemplate(result.state, null) }
    : result;
}
