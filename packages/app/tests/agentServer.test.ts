import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentRequestRefusal,
  startAgentServer,
  type AgentServer,
} from "../electron/agentServer";

const OK = {
  method: "POST",
  host: "127.0.0.1:4100",
  origin: undefined,
  contentType: "application/json",
  remoteAddress: "127.0.0.1",
};

describe("Agent access guard", () => {
  it("lets a local Agent through", () => {
    expect(agentRequestRefusal(OK, 4100)).toBeNull();
    expect(agentRequestRefusal({ ...OK, contentType: "application/json; charset=utf-8" }, 4100)).toBeNull();
    expect(agentRequestRefusal({ ...OK, method: "GET", contentType: undefined }, 4100)).toBeNull();
    expect(agentRequestRefusal({ ...OK, remoteAddress: "::ffff:127.0.0.1" }, 4100)).toBeNull();
  });

  it("refuses other machines, other hosts, web pages and other content types", () => {
    expect(agentRequestRefusal({ ...OK, remoteAddress: "192.168.1.20" }, 4100)?.status).toBe(403);
    expect(agentRequestRefusal({ ...OK, host: "evil.example:4100" }, 4100)?.status).toBe(403);
    expect(agentRequestRefusal({ ...OK, host: "localhost:4100" }, 4100)?.status).toBe(403);
    expect(agentRequestRefusal({ ...OK, host: undefined }, 4100)?.status).toBe(403);
    expect(agentRequestRefusal({ ...OK, origin: "https://evil.example" }, 4100)?.status).toBe(403);
    expect(agentRequestRefusal({ ...OK, origin: "null" }, 4100)?.status).toBe(403);
    expect(agentRequestRefusal({ ...OK, contentType: "text/plain" }, 4100)?.status).toBe(415);
    expect(agentRequestRefusal({ ...OK, contentType: undefined }, 4100)?.status).toBe(415);
    expect(agentRequestRefusal({ ...OK, method: "PUT" }, 4100)?.status).toBe(405);
  });
});

describe("Agent access server", () => {
  let server: AgentServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
  });

  function send(
    port: number,
    options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; body: unknown; headers: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          method: options.method ?? "GET",
          path: options.path ?? "/",
          headers: options.headers,
        },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () =>
            resolve({ status: res.statusCode!, body: JSON.parse(text), headers: res.headers }),
          );
        },
      );
      req.on("error", reject);
      req.end(options.body);
    });
  }

  it("passes allowed requests to the Tool directory and refuses the rest", async () => {
    const seen: unknown[] = [];
    server = await startAgentServer(async (req) => {
      seen.push(req);
      return { status: 200, body: { ok: true, result: req.path } };
    });
    const { port } = server;

    const index = await send(port, {});
    expect(index).toMatchObject({ status: 200, body: { ok: true, result: "/" } });
    expect(index.headers["access-control-allow-origin"]).toBeUndefined();

    const call = await send(port, {
      method: "POST",
      path: "/tools/import.read?x=1",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(call.status).toBe(200);
    expect(seen.at(-1)).toEqual({ method: "POST", path: "/tools/import.read", body: "{}" });

    const count = seen.length;
    expect((await send(port, { headers: { Host: "evil.example" } })).status).toBe(403);
    expect((await send(port, { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect(
      (await send(port, { method: "POST", path: "/tools/x", headers: { "Content-Type": "text/plain" }, body: "{}" }))
        .status,
    ).toBe(415);
    expect(seen.length).toBe(count);
  });
});
