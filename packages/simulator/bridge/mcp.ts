import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpError, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";

export interface ToolResult {
  text: string;
  data: Record<string, unknown> | null;
  isError: boolean;
}

// What the agent needs from the MCP side; tests substitute a fake.
export interface ToolRunner {
  tools(): readonly Tool[];
  call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export function toToolResult(raw: unknown): ToolResult {
  const result = raw as Partial<CallToolResult>;
  const content = (Array.isArray(result.content) ? result.content : []) as Array<{ type: string; text?: string }>;
  const text = content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join(" ")
    .trim();
  const data = result.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent : null;
  return { text, data: data as Record<string, unknown> | null, isError: result.isError === true };
}

// A real MCP client over Streamable HTTP. One session; reconnects once if the server was restarted.
export class McpLink implements ToolRunner {
  private client: Client | null = null;
  private toolList: Tool[] = [];
  private connecting: Promise<Tool[]> | null = null;

  constructor(readonly url: URL) {}

  async connect(): Promise<Tool[]> {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      await this.disconnect();
      const client = new Client({ name: "aag-simulator-bridge", version: "0.1.0" });
      await client.connect(new StreamableHTTPClientTransport(this.url));
      const { tools } = await client.listTools();
      this.client = client;
      this.toolList = tools;
      return tools;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.close().catch(() => undefined);
  }

  tools(): readonly Tool[] {
    return this.toolList;
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.client) await this.connect();
    try {
      return toToolResult(await this.client!.callTool({ name, arguments: args }));
    } catch (err) {
      if (err instanceof McpError) throw err;
      await this.connect();
      return toToolResult(await this.client!.callTool({ name, arguments: args }));
    }
  }
}
