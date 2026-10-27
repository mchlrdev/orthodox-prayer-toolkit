import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * Agent access: a local HTTP server on 127.0.0.1 that passes requests to the
 * Tool directory in the app window. No key; the guard below keeps web pages
 * (browsers send Origin, and reach it only via another Host) and other
 * machines out.
 */

export type AgentRequestFacts = {
  method: string;
  host: string | undefined;
  origin: string | undefined;
  contentType: string | undefined;
  remoteAddress: string | undefined;
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MAX_BODY = 8 * 1024 * 1024;

/** Why a request is refused (status + message), or null when it may pass. */
export function agentRequestRefusal(
  req: AgentRequestFacts,
  port: number,
): { status: number; message: string } | null {
  if (!req.remoteAddress || !LOOPBACK.has(req.remoteAddress)) {
    return { status: 403, message: "Only this computer may connect" };
  }
  // DNS rebinding: a page on evil.example resolving to 127.0.0.1 sends its own Host.
  if (req.host !== `127.0.0.1:${port}`) {
    return { status: 403, message: `Host must be 127.0.0.1:${port}` };
  }
  // Browsers add Origin to cross-site requests; Agents do not.
  if (req.origin !== undefined) {
    return { status: 403, message: "Requests from web pages are not allowed" };
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return { status: 405, message: "Use GET / or POST /tools/{name}" };
  }
  if (req.method === "POST") {
    const type = (req.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") {
      return { status: 415, message: "Content-Type must be application/json" };
    }
  }
  return null;
}

export type AgentHandler = (request: {
  method: string;
  path: string;
  body: string;
}) => Promise<{ status: number; body: unknown }>;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export type AgentServer = { port: number; close: () => Promise<void> };

/** Listen on 127.0.0.1 on a free port (or `port`). */
export function startAgentServer(handle: AgentHandler, port = 0): Promise<AgentServer> {
  let actualPort = 0;
  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      // No CORS headers: browsers may not read the answers.
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(body, null, 2)}\n`);
    };
    const refusal = agentRequestRefusal(
      {
        method: req.method ?? "",
        host: req.headers.host,
        origin: req.headers.origin,
        contentType: req.headers["content-type"],
        remoteAddress: req.socket.remoteAddress,
      },
      actualPort,
    );
    if (refusal) {
      send(refusal.status, { ok: false, error: refusal.message });
      req.resume();
      return;
    }
    void (async () => {
      try {
        const body = req.method === "POST" ? await readBody(req) : "";
        const path = new URL(req.url ?? "/", `http://127.0.0.1:${actualPort}`).pathname;
        const answer = await handle({ method: req.method!, path, body });
        send(answer.status, answer.body);
      } catch (error) {
        send(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actualPort,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
