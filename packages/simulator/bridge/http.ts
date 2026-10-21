import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AskResponse, BridgeHealth, GlanceResponse, TickResponse } from "../shared/types.js";
import { ask, type AgentDeps } from "./agent.js";
import { cardFor } from "./cards.js";

export interface BridgeOptions {
  host: string;
  port: number;
  deps: AgentDeps;
  health: () => Promise<BridgeHealth>;
}

export interface RunningBridge {
  url: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 20_000;

export async function startBridge(opts: BridgeOptions): Promise<RunningBridge> {
  const log = opts.deps.log ?? (() => undefined);

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, await opts.health());
      return;
    }
    if (req.method === "POST" && path === "/ask") {
      const body = (await readJsonBody(req)) as { text?: unknown } | undefined;
      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (!text) {
        sendJson(res, 400, { error: "Body must be JSON like {\"text\": \"...\"}" });
        return;
      }
      log(`ask: ${text}`);
      const started = Date.now();
      const answer = await ask(text, opts.deps);
      log(`answer (${answer.source}, ${Date.now() - started} ms): ${answer.speech}`);
      sendJson(res, 200, answer satisfies AskResponse);
      return;
    }
    if (req.method === "GET" && path === "/tick") {
      const result = await opts.deps.runner.call("watch_tick", {});
      const alert = result.data?.["alert"] as TickResponse["alert"] | undefined;
      const response: TickResponse =
        alert && !result.isError ? { alert, card: cardFor("watch_tick", result, "alert") } : { alert: null, card: null };
      if (response.alert) log(`tick: alert for ${response.alert.member}`);
      sendJson(res, 200, response);
      return;
    }
    if (req.method === "GET" && path === "/glance") {
      const result = await opts.deps.runner.call("check_outside", {});
      const readings = (result.data?.["readings"] ?? {}) as Record<string, unknown>;
      const glance: GlanceResponse = {
        time: typeof readings["time"] === "string" ? readings["time"] : null,
        aqi: numberOrNull(readings["european_aqi"]),
        band: typeof result.data?.["aqiBand"] === "string" ? (result.data["aqiBand"] as string) : null,
        pm2_5: numberOrNull(readings["pm2_5"])
      };
      sendJson(res, 200, glance);
      return;
    }
    sendJson(res, 404, { error: "Not found. Routes: GET /health, POST /ask, GET /tick, GET /glance" });
  }

  const server = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Internal error";
      log(`error: ${message}`);
      if (res.headersSent) {
        res.end();
        return;
      }
      const speech = "I can't reach the household guardian right now. Please check that the MCP server is running.";
      sendJson(res, 502, { speech, cards: [], toolCalls: [], source: "none", model: null, error: message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port;
  return {
    url: `http://${opts.host}:${port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
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
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
