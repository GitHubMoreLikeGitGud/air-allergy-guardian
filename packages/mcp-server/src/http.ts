import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AppContext } from "./context.js";
import { PROTOCOL_VERSION, SERVER_INFO, createMcpServer } from "./server.js";

export interface HttpOptions {
  host: string;
  port: number;
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;

// One MCP session per client: the transport is created on the initialize request and kept by session id.
export async function startHttpServer(ctx: AppContext, opts: HttpOptions): Promise<RunningServer> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  async function openSession(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
      }
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await createMcpServer(ctx).connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/health") {
      sendJson(res, 200, { ok: true, ...SERVER_INFO, protocolVersion: PROTOCOL_VERSION, sessions: sessions.size });
      return;
    }
    if (path !== "/mcp") {
      sendJson(res, 404, rpcError(-32004, "Not found: the MCP endpoint is /mcp"));
      return;
    }
    const sessionId = req.headers["mcp-session-id"];
    if (typeof sessionId === "string") {
      const transport = sessions.get(sessionId);
      if (!transport) {
        sendJson(res, 404, rpcError(-32001, "Session not found; initialize again"));
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 400, rpcError(-32000, "Missing Mcp-Session-Id header"));
      return;
    }
    const body = await readJsonBody(req);
    if (!isInitializeRequest(body)) {
      sendJson(res, 400, rpcError(-32000, "No session: send an initialize request first"));
      return;
    }
    await openSession(req, res, body);
  }

  const httpServer = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 500, rpcError(-32603, err instanceof Error ? err.message : "Internal error"));
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, opts.host, () => resolve());
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : opts.port;

  return {
    url: `http://${opts.host}:${port}/mcp`,
    port,
    close: async () => {
      await Promise.all([...sessions.values()].map((t) => t.close()));
      sessions.clear();
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
}

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function rpcError(code: number, message: string): unknown {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as unknown) : undefined;
}
