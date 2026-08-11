# Orthodox Prayer Toolkit

Local-first editor and domain library for liturgical prayer JSON.

## Language

**Library**:
A folder of prayer JSON files plus optional `manifest.json` and `.orthodox-prayer-toolkit/styles.json`. Identity of each prayer is its `id` / `{id}.json` filename.
_Avoid_: corpus, vault, workspace, project folder

**Library root**:
The absolute path of an opened Library. Electron only accepts filesystem operations against Library roots opened this session (folder dialog or startup examples).
_Avoid_: working directory, cwd

**Session draft**:
The unsaved in-memory Prayer for an open file path, including validation errors and visible variant columns. Multiple drafts may exist when switching prayers without saving.
_Avoid_: buffer, dirty state, editor state

**Block**:
One unit in a Prayer `structure` (kind + per-variant translations). Editor commits and reorder ops mutate Blocks, not free-form HTML.
_Avoid_: paragraph, section, row

**Kind style**:
Visual tokens for a block kind (`fontSize`, `color`, `fontWeight`, `fontStyle`, optional `initialCap`). Loaded from app defaults and library `styles.json` only after allowlisted validation.
_Avoid_: CSS theme, stylesheet

**Kind rename**:
Renaming a block kind updates every prayer in the open Library that uses it (and both style maps). A confirm appears when more than one prayer is affected.
_Avoid_: refactor kind, retag
