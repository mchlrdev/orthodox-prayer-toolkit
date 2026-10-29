# Agent access

Agents such as Claude Code or Cursor on the same computer can work in the running app through the **Tool directory**: read the Library, load a Source into an Import draft, apply Import operations and save. Their changes show live in the open import view and are undone like the user's own.

## Turning it on

App settings → **Agent access** (off by default). While on, the app listens on `127.0.0.1` on a free port and shows a prompt to copy into the agent:

> Orthodox Prayer Toolkit is running locally. Read the tools at http://127.0.0.1:PORT/ and work only through these tools.

It also writes `agent-access.json` (`url`, `port`, `pid`) to the app's data folder (macOS: `~/Library/Application Support/Orthodox Prayer Toolkit/`). Turning it off or quitting stops the server and removes the file.

## Calling tools

- `GET /` lists every tool: `name`, `purpose`, `params` (JSON Schema) and an `example`.
- `POST /tools/{name}` with a JSON body of arguments and `Content-Type: application/json`.
- Answers are JSON: `{ "ok": true, "result": … }`, or `{ "ok": false, "error": "…" }` with status 400 for calls the agent can fix.

| Tool | Does |
|------|------|
| `library.list` | Prayers in the open Library (id, title, kinds) and its Variants |
| `prayer.read` | One prayer as Prayer JSON |
| `prayer.validate` | Schema and rule check of Prayer JSON |
| `import.start` | Read text, HTML or a web page into a new Import draft (asks before replacing an open one) |
| `import.read` | The draft: Variant keys, Source segments (id, text, look, style group), blocks (id, kind, speaker, text per Variant, segments, who decided) and validity |
| `import.apply` | Import operations ([core-api.md](core-api.md#import)) as one undo step |
| `import.addLanguage` | A second language from another text or from a column of the Source, paired in order |
| `import.firstDraft` | Let the Built-in model sort the draft (roles, "Label:" starts, speakers, pairs); `import.read` then shows each decision's `confidence` |
| `import.save` | Save the draft as `{id}.json` after the user confirms in the app; never overwrites |

Every change an agent makes is an Import operation with origin `agent`, one undo step per call. Saving asks in the app first; the agent gets `"The user declined saving"` when the user says no.

## Protection

There is no key. Instead the server refuses:

- connections from other machines (it listens on loopback only),
- a `Host` other than `127.0.0.1:PORT` (DNS rebinding),
- any request with an `Origin` header (web pages in a browser),
- `POST` without `Content-Type: application/json`,

and it sends no CORS headers. Code: `packages/app/electron/agentServer.ts` (server and guard), `packages/app/src/agentTools/toolDirectory.ts` (Tool directory); the main process passes each allowed request to the app window, which answers from the live session. The browser dev build has no Agent access.
