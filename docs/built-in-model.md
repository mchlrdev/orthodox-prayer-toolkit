# Built-in model

The app can download one local model that runs offline. It is optional: import, editing and Agent access work without it.

## First draft

When the model is installed, loading a Source (Import…) starts it at once. It answers Decisions (see [core-api.md](core-api.md#decisions-first-draft)) block by block and the preview changes as it goes; a banner shows progress and **Stop**. You can edit meanwhile: blocks you change keep your decision. The whole run is one undo step.

Each model decision keeps its confidence. Below 70 % the block shows its guess as a question, e.g. **Verse?** (click it to pick the kind; picking the same one confirms it), a PDF frame is dotted, and the status bar shows **n to check →**; clicking that (or ⌘J) jumps to the next one. Adding a language checks the pairs the same way. Agents can start the same run with the `import.firstDraft` tool.

The model runs in its own process (Electron utility process, node-llama-cpp with Metal on Apple silicon), so the window stays responsive. It loads on the first run (a few seconds) and is unloaded after three idle minutes. About 0.2 s per block on an M-series Mac.

**Where it runs.** As many layers as leave room for the context go on the GPU (`fitContext`); when the GPU still fails (too little memory, a driver that refuses), the model loads on the CPU. A failed load is not kept, so the next job tries again. App settings → **Built-in model** names the place (`Runs on the GPU · NVIDIA Quadro P620`, `Runs on the CPU, slower · too little memory on …`) and, as `Not used: …`, any GPU the model leaves out; the import banner shows the short form during a run. Before the first run the app asks the model process without loading the weights (only the vocabulary, so llama.cpp names its pick: `Will run on …`). The names come from llama.cpp's log, the one place that tells the GPUs actually used: it prefers dedicated GPUs and takes an integrated one only when it finds none. Windows also lists graphics cards the runtime cannot see (`systemGpus.ts`). The GPU cannot be chosen in the app yet.

## Library memory

Corrections you make to the model's decisions in an import are learned when you save it, and decide the same way next time for the same site and look; hints you write (or accept) are read before every decision. See [library.md](library.md#library-memory-memoryjson).

## Chat pane

The sidebar's **Assistant** mode takes instructions in plain words: "Abschnitt 7 gehört nicht dazu", "Gib Abschnitt 3 den Speaker Priester", "Was ist ein Kontakion?". The block last clicked in the editor comes along as a chip (`#n`, the number in the import's source column or PDF frame; the start of its text in a prayer); × drops it. Without the model (desktop), the input is replaced by one Download button with progress.

An instruction becomes a **chat plan** (`chatPlan.ts` in Core): action (kind, speaker, remove speaker, exclude, include, inline annotation, remove words, change wording, title, merge, split, undo, answer), kind or speaker, quoted words, and blocks. Fixed rules (`ruleChatPlan`) read what the wording settles first:
- **Speaker** named anywhere, also in quotes ("Speaker „reader“", "hat den Speaker Priest", "Das spricht der Chor", "amen sagt alle", "das sagen wir" → people); "nicht der Priester" is not the priest; "den Priester-Sprecher weg, Leser bleibt" removes only the priest.
- **Kind**: the last one named counts, "kein Titel" turns around (→ verse), "kleinere Überschrift" is a subheading, "steht komisch als Vers" describes how it is now, "… im Vers" says where; a self-correction inside the message wins ("Überschrift, ne doch Vers"); "…, ne doch nicht" takes the request back.
- **Inline annotation**: "„(dreimal)“ ist eine Anmerkung", "(ἐκ γ΄) ist eine Anweisung" (a bracket in the message counts as a quote), "die Zeile mit dreimal ist eine Anweisung" (the bracket inside the verse, not the verse); the whole block → kind Annotation.
- **Leave out**: "weg", "raus", "lass … weg", "gehört nicht dazu", "not part"; "am Ende"/"footer" means the trailing sections that are not verse, never the prayer's last words; "Samstag und alles danach" runs to the end.
- **Title** ("das oben ist der Titel", "der Titel ist Das Vaterunser", "Titel, also X nicht Y"), **merge** ("5 und 6 gehören zusammen", "and 8 too" after a merge), **undo** ("rückgängig", "undo that", "oops … wieder"), **again** ("nochmal", "do it again" — the last change), **correction** ("nein, …", "ich meinte nur Abschnitt 2": the last change is undone, then done right), **why** ("warum hast du das gemacht?" — the editor's own account, not the model's), **read back** ("was steht in Zeile 2?"), typos ("Himel ist falsch, … also Himmel", "steht Muttter, soll Mutter heißen", "0 Christ should be O Christ", "Ersetze „X“ durch „Y“").

Blocks (`ruleTargets`): numbers first ("Abschnitt 3", "Zeile 2", "#4", "2 und 10 …", "und 15 auch", "18 19 20 21", "die letzte Zeile"; "Ode 1", "Psalm 50", "Ton 4" and "40 mal" are not section numbers; any language's number of a paired block), then chips; "das hier" without a selection asks to click the section; "bei allem"; the blocks of a named speaker; quoted words; the text before "ist"/"sagt" or after "mach … zur" ("Troparion, 4. Ton ist Überschrift", "der letzte Amen ist das Volk", "remove the speaker from the amen"); a distinctive word ("die Kommentare weg"); "oben"/"am Ende"; "auch"/"too" repeats the last change on what it names ("Kondakion auch"); else the previous answer's blocks for a follow-up. Only what is still open goes to the model: one answer held to a JSON schema by a grammar (`chatPlanSchema`; never "undo"), with the sections (kind, speaker), the selection, the last four exchanges and what the rules settled; rules win, and a quote the model made up is dropped. When the model gives no usable plan, the older one-question Decisions fill the gap. Only answers and an asked-for rewording generate free text; answers see each section's kind ("left out" too) and are told what the chat cannot do (add a language, fonts, audio, tones, files).

Setting a speaker always cuts a printed speaker label ("Leser:", "Priester:") at the block's start in every language, also when it names another speaker; a label that names the chosen speaker becomes its name in that Variant, other Variants get the usual name in their language (`presetSpeakerName`: "Leser", "Reader", "Чтец" …). Every answer says what it understood ("Speaker Leser in sections 2–4") and, for blocks left as they were, why, grouped ("sections 161–198 are already left out"); nothing is reported as done when nothing changed.

**Before the model** (also without it), the reader settles what needs no guess (`readerRuleOps`, origin reader with confidence 1, so a correction of it is learned by Library memory):
- a paragraph holding several blocks is split before a known speaker label, an instruction line, or a label after a sentence end ("… Ewigkeit. L: Amen."), and around a genre label on a line of its own ("Troparion, 4. Ton" above the hymn);
- a paragraph a page break cut apart is joined: the next block starts the next page in the same column and print, with no sentence end above and a small letter below (`pageBreakJoinOps`);
- a known speaker label at a block's start becomes the speaker (label cut); short forms "P:", "D:", "L:", "Ch:" count; a block that is only a label ("Priester:", "DEACON", "ΙΕΡΕΥΣ (χαμηλοφώνως)") gives its speaker to the next block and is left out; a rubric naming the speaker ("Der Priester tritt vor den Thron: Gesegnet …") gives the speaker and stays as an inline annotation;
- bracketed instructions inside the text ("(dreimal)", "(ἐκ γ')", "(12 раз)", "(3)", "(oder …)", "[Verneigung]") become inline annotations;
- genre labels ("2. Kondakion", "Troparion, 4. Ton", "Psalm 50", "Тропарь, глас 4", "Ἀπολυτίκιον. Ἦχος πλ. δ´") are headings, descriptions of what clergy or choir do ("Der Priester betet leise das Gebet zur 1. Antiphon:") and catechism questions are annotations (`readerKindOf`).
The first draft does not ask the model about those blocks.

**Why cutting is not a Decision.** On the PDFs of the test set (Nov 2026) a "does the first line stand alone?" question was not worth keeping. In a list of 40 the model carried on its own answers: the same line scored 0.98, 0.01 or 0.97 depending only on the lines around it. Asked one at a time, the answers were steady but only two lines passed the confidence for a cut, both on title pages and one of them wrong. Paragraphs stay as read unless a fixed rule cuts them; the chat can split them.

**Decisions in a list depend on their neighbours.** The same holds for the roles, which are still asked in lists of 40. Asked one at a time on those PDFs, kind rose from 88 to 93% and the confidence was far better calibrated, but 8 blocks went missing, 7 of them headings, and about twice as many decisions needed checking. Roles stay in lists until that loss is understood.

**Why joining is not a Decision.** Measured on the PDFs of the test set (Nov 2026), a "do these belong together?" question joined nearly every pair that looked unfinished, at 90% confidence, also across the columns of a two-language book. It gave one clearly right join of 14. Joining stays a fixed rule for page breaks and an instruction in the chat. Line cuts by the reader, genre labels, speaker labels and instruction lines stay rules as well: they are certain and free, and the model adds value only on what they leave open.

**Safety in the chat.** Leaving out is never guessed: when only the model could pick the sections, the chat asks which ones. Spoken text described but not named ("der Kram oben") is not left out; numbers, a selection, quoted words, "bei allem" or "und alles danach" name it. A heading is not merged into the hymn it names unless the user gives the numbers. Undo comes only from "rückgängig". Requests the chat cannot carry out (a second language, fonts, audio, saving or sending, tones, adding text) get an honest answer with where to do it (`cannotDo`); answers have a short glossary of liturgical terms ("ἐκ γ΄" = three times, Irmos, Ektenie …).

Changes run through the Tool directory like an agent's: `import.apply` (origin model, one undo step) or `prayers.edit`. In an import the answer shows a change card (one line per block, Undo, and — when the change suggests a rule — "Remember for next time" with the rule's sentence), and the draft marks the changed blocks with a short line ("Left out", "→ Annotation") plus a one-line banner ("2 left out · Text unchanged · Undo"). The marks last until the next edit; after it, the card says "⌘Z to undo". A new or discarded import clears the conversation. Changes to prayers stay unsaved; a change beyond the open prayer needs a quoted text and asks with a card first. Wording changes work only in an import.

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

The model process keeps what its context already holds of a prompt (rules, options and examples shared by every prompt of a batch) and evaluates only the rest (`reuse` in `electron/modelRuntime.ts`): same tokens, same answers, about 6% faster on long pages. `pnpm --filter @orthodox-prayer-toolkit/app measure:import` / `measure:chat` run the whole import and Assistant conversations on the real model against a local test set (`TESTSET`, default `.scratch/ai-import/testset`: sources as downloaded, reviewed expected prayers, conversations); one model at a time, waiting for memory; `STANDIN=1` uses the stand-in. The import report separates exact blocks, merged ones (an expected block inside a larger one) and ones cut too often, and counts how many of the model's cuts and joins gave an expected block. It includes a calibration table (how often model kind decisions are right per confidence), the basis for `UNCERTAIN_BELOW`. `export:training` writes the first-draft questions with their right answers as chat-format JSONL for a LoRA adapter. The older ``pnpm --filter @orthodox-prayer-toolkit/app measure:model [library-dir] [model.gguf]` treats each prayer JSON in the folder as the expected result, imports `<id>.txt` next to it (or plain text made from the prayer), lets the model decide and prints per prayer: blocks found with the exact text, kind and speaker hits, time.
