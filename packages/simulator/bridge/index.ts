import { loadConfig } from "./config.js";
import { startBridge } from "./http.js";
import { OllamaChat } from "./llm.js";
import { McpLink } from "./mcp.js";

const config = loadConfig();
const log = (line: string) => console.log(`[bridge ${new Date().toISOString().slice(11, 19)}] ${line}`);

const mcp = new McpLink(new URL(config.mcpUrl));
const tools = await connectWithRetry();
log(`connected to ${config.mcpUrl}; tools: ${tools.join(", ")}`);

const model = config.llmEnabled ? new OllamaChat(config.ollamaUrl, config.model, config.llmTimeoutMs) : null;
if (model) {
  const up = await model.reachable();
  log(up ? `LLM ${config.model} at ${config.ollamaUrl}` : `LLM endpoint ${config.ollamaUrl} not reachable; the intent router will answer`);
  if (up) void model.chat([{ role: "user", content: "Say ready." }], []).then(() => log("model warm"), () => undefined);
} else {
  log("LLM disabled (AAG_LLM=off); the intent router answers");
}

const running = await startBridge({
  host: config.host,
  port: config.port,
  deps: { runner: mcp, model, log },
  health: async () => ({
    ok: true,
    mcp: { url: config.mcpUrl, tools: mcp.tools().map((t) => t.name) },
    llm: { enabled: model !== null, model: config.model, url: config.ollamaUrl, reachable: model ? await model.reachable() : null }
  })
});
log(`listening at ${running.url} (POST /ask, GET /tick, GET /glance, GET /health)`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void Promise.all([running.close(), mcp.disconnect()]).then(() => process.exit(0));
  });
}

async function connectWithRetry(): Promise<string[]> {
  let lastError = "";
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      return (await mcp.connect()).map((t) => t.name);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt === 1) log(`waiting for the MCP server at ${config.mcpUrl} (${lastError})`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.error(`Could not connect to the MCP server at ${config.mcpUrl}: ${lastError}`);
  console.error("Start it first: npm start -w @aag/mcp-server");
  process.exit(1);
}
