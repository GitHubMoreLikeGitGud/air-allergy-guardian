// Connects to a running server over Streamable HTTP and asks check_outside against the live Open-Meteo API.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env["AAG_MCP_URL"] ?? "http://localhost:3333/mcp");
const client = new Client({ name: "aag-smoke", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(url);

try {
  await client.connect(transport);
} catch (err) {
  console.error(`Could not connect to ${url.href}. Start the server first with: npm start`);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const info = client.getServerVersion();
console.log(`connected to ${info?.name} ${info?.version}, protocol ${transport.protocolVersion}`);
const { tools } = await client.listTools();
console.log(`tools: ${tools.map((t) => t.name).join(", ")}`);

const result = await client.callTool({ name: "check_outside", arguments: {} });
const content = result.content as Array<{ type: string; text?: string }>;
console.log(`spoken: ${content.find((c) => c.type === "text")?.text ?? "(no text)"}`);
console.log(`structured: ${JSON.stringify(result.structuredContent)}`);

await client.close();
