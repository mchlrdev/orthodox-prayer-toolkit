# Built-in model

The app can download one local model that runs offline. It is optional: import, editing and Agent access work without it.

## First draft

When the model is installed, loading a Source (Import text…) starts it at once. It answers Decisions (see [core-api.md](core-api.md#decisions-first-draft)) block by block and the preview changes as it goes; a banner shows progress and **Stop**. You can edit meanwhile: blocks you change keep your decision. The whole run is one undo step.

Each model decision keeps its confidence. Below 70 % the block shows **Kind uncertain · n %** (click it to keep the kind) and the status bar counts **open decisions**; clicking that jumps to the next one. Adding a language checks the pairs the same way. Agents can start the same run with the `import.firstDraft` tool.

The model runs in its own process (Electron utility process, node-llama-cpp with Metal on Apple silicon), so the window stays responsive. It loads on the first run (a few seconds) and is unloaded after three idle minutes. About 0.2 s per block on an M-series Mac.

## Library memory

Corrections you make to the model's decisions in an import are learned when you save it, and decide the same way next time for the same site and look; hints you write (or accept) are read before every decision. See [library.md](library.md#library-memory-memoryjson).

## Chat pane

The sidebar's **Assistant** mode takes instructions in plain words: "Abschnitt 7 gehört nicht dazu", "Gib Abschnitt 3 den Speaker Priester", "Was ist ein Kontakion?". The block last clicked in the editor comes along as a chip (Section n in an import, Block n in a prayer); × drops it.

An instruction is a few Decisions, not free text: what to do (kind, speaker, exclude, include, change wording, answer), then which kind or speaker, then which blocks: chips first, then section numbers, then a quoted text, else one yes/no Decision per block. Plain wording skips the model ("Speaker"/"Sprecher" with a known speaker, "in allen Gebeten"). Only answers and an explicitly asked wording change generate text.

Changes run through the Tool directory like an agent's: `import.apply` (origin model, one undo step) or `prayers.edit`. In an import the answer shows a change card with Undo, and the draft marks the changed sections with "Answer n · …" plus a banner (Undo, Hide). Changes to prayers stay unsaved; a change beyond the open prayer needs a quoted text and asks with a card first. Wording changes work only in an import.

## The model

**Qwen3.5 4B** (Apache-2.0) in 4-bit GGUF: 2.7 GB, fine on a computer with 8 GB of memory. It reads no images; scans are read by Tesseract (see [core-api.md](core-api.md#import-drafts)). An install from an earlier app that still holds the vision projector frees that file on start. The entry lives in `packages/app/electron/modelCatalog.ts`: name, version and per file a fixed address (pinned to a repository commit), sha256 and size. It is kept as data so a list or a user's own file can replace it later.

## Download, cancel, delete

App settings → **Built-in model**:

- **Download** shows progress and the time left. **Cancel** keeps what has arrived; **Resume** continues from there, also after quitting the app (HTTP Range requests). **Discard the partial download** starts over.
- A dropped connection is retried by itself; it gives up after three failures in a row without progress and says so.
- Before starting, the app checks the free disk space.
- Each file is checked against its sha256. A damaged file is deleted and the app asks to download again.
- **Delete** removes the model and frees the space.

Files go to the app's data folder, `models/<id>/<version>/` (macOS: `~/Library/Application Support/Orthodox Prayer Toolkit/models/`). A file downloads as `<name>.part` and is renamed once checked; `installed.json` marks a complete version.

## Model updates

An app update that bumps the entry's `version` shows "A new version is available" with a Download button. The old version is deleted once the new one is installed.

## Browser dev

`pnpm dev` (no Electron) shows a stand-in model instead of a download; first drafts there use fixed rules (`standInModel.ts`), as do the tests.

## Measuring

`pnpm --filter @orthodox-prayer-toolkit/app measure:model [library-dir] [model.gguf]` treats each prayer JSON in the folder as the expected result, imports `<id>.txt` next to it (or plain text made from the prayer), lets the model decide and prints per prayer: blocks found with the exact text, kind and speaker hits, time.
