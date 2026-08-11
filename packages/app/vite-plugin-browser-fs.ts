import type { Plugin } from "vite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveUnderRoot, walkJsonFiles } from "./nodeFs";

const PREFIX = "/__ptk";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Dev-only filesystem bridge so the renderer can run in a normal browser
 * against the toolkit examples/ library (no Electron required).
 */
export function prayerToolkitBrowserFs(toolkitRoot: string): Plugin {
  const examplesRoot = resolve(toolkitRoot, "examples");
  const appStylesPath = resolve(toolkitRoot, ".dev-app-styles.json");

  return {
    name: "prayer-toolkit-browser-fs",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) {
          next();
          return;
        }

        try {
          const url = new URL(req.url, "http://localhost");
          const route = url.pathname.slice(PREFIX.length);

          if (route === "/startup" && req.method === "GET") {
            sendJson(res, 200, {
              root: existsSync(examplesRoot) ? examplesRoot : null,
            });
            return;
          }

          if (route === "/list" && req.method === "GET") {
            const root = url.searchParams.get("root") || examplesRoot;
            if (resolve(root) !== resolve(examplesRoot)) {
              sendJson(res, 403, { error: "Only examples library allowed in browser dev" });
              return;
            }
            const files: string[] = [];
            walkJsonFiles(root, root, files);
            sendJson(res, 200, { files: files.sort() });
            return;
          }

          if (route === "/read" && req.method === "GET") {
            const root = url.searchParams.get("root") || examplesRoot;
            const relativePath = url.searchParams.get("path");
            if (!relativePath) {
              sendJson(res, 400, { error: "path required" });
              return;
            }
            if (resolve(root) !== resolve(examplesRoot)) {
              sendJson(res, 403, { error: "Only examples library allowed in browser dev" });
              return;
            }
            const full = resolveUnderRoot(root, relativePath);
            sendJson(res, 200, { content: readFileSync(full, "utf8") });
            return;
          }

          if (route === "/write" && req.method === "POST") {
            const body = JSON.parse(await readBody(req)) as {
              root: string;
              path: string;
              content: string;
            };
            if (resolve(body.root) !== resolve(examplesRoot)) {
              sendJson(res, 403, { error: "Only examples library allowed in browser dev" });
              return;
            }
            const full = resolveUnderRoot(body.root, body.path);
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, body.content, "utf8");
            sendJson(res, 200, { ok: true });
            return;
          }

          if (route === "/delete" && req.method === "POST") {
            const body = JSON.parse(await readBody(req)) as {
              root: string;
              path: string;
            };
            if (resolve(body.root) !== resolve(examplesRoot)) {
              sendJson(res, 403, { error: "Only examples library allowed in browser dev" });
              return;
            }
            const full = resolveUnderRoot(body.root, body.path);
            rmSync(full, { force: true });
            sendJson(res, 200, { ok: true });
            return;
          }

          if (route === "/rename" && req.method === "POST") {
            const body = JSON.parse(await readBody(req)) as {
              root: string;
              from: string;
              to: string;
            };
            if (resolve(body.root) !== resolve(examplesRoot)) {
              sendJson(res, 403, { error: "Only examples library allowed in browser dev" });
              return;
            }
            const from = resolveUnderRoot(body.root, body.from);
            const to = resolveUnderRoot(body.root, body.to);
            if (existsSync(to)) {
              sendJson(res, 409, { error: `Target already exists: ${body.to}` });
              return;
            }
            mkdirSync(dirname(to), { recursive: true });
            renameSync(from, to);
            sendJson(res, 200, { ok: true });
            return;
          }

          if (route === "/exists" && req.method === "GET") {
            const root = url.searchParams.get("root") || examplesRoot;
            const relativePath = url.searchParams.get("path");
            if (!relativePath) {
              sendJson(res, 400, { error: "path required" });
              return;
            }
            if (resolve(root) !== resolve(examplesRoot)) {
              sendJson(res, 403, { error: "Only examples library allowed in browser dev" });
              return;
            }
            const full = resolveUnderRoot(root, relativePath);
            sendJson(res, 200, { exists: existsSync(full) });
            return;
          }

          if (route === "/styles/app" && req.method === "GET") {
            sendJson(res, 200, {
              content: existsSync(appStylesPath)
                ? readFileSync(appStylesPath, "utf8")
                : null,
            });
            return;
          }

          if (route === "/styles/app" && req.method === "POST") {
            const body = JSON.parse(await readBody(req)) as { content: string };
            writeFileSync(appStylesPath, body.content, "utf8");
            sendJson(res, 200, { ok: true });
            return;
          }

          if (route === "/styles/library" && req.method === "GET") {
            const root = url.searchParams.get("root") || examplesRoot;
            if (resolve(root) !== resolve(examplesRoot)) {
              sendJson(res, 403, { error: "Only examples library allowed in browser dev" });
              return;
            }
            const path = resolveUnderRoot(
              root,
              ".orthodox-prayer-toolkit/styles.json",
            );
            sendJson(res, 200, {
              content: existsSync(path) ? readFileSync(path, "utf8") : null,
            });
            return;
          }

          if (route === "/styles/library" && req.method === "POST") {
            const body = JSON.parse(await readBody(req)) as {
              root: string;
              content: string;
            };
            if (resolve(body.root) !== resolve(examplesRoot)) {
              sendJson(res, 403, { error: "Only examples library allowed in browser dev" });
              return;
            }
            const path = resolveUnderRoot(
              body.root,
              ".orthodox-prayer-toolkit/styles.json",
            );
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, body.content, "utf8");
            sendJson(res, 200, { ok: true });
            return;
          }

          if (route === "/export" && req.method === "POST") {
            // Browser: download via Content-Disposition
            const body = JSON.parse(await readBody(req)) as {
              defaultName: string;
              content: string;
            };
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${body.defaultName.replace(/"/g, "")}"`,
            );
            res.end(body.content);
            return;
          }

          sendJson(res, 404, { error: `Unknown route ${route}` });
        } catch (err) {
          sendJson(res, 500, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    },
  };
}
