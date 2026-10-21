export interface BridgeConfig {
  host: string;
  port: number;
  mcpUrl: string;
  ollamaUrl: string;
  model: string;
  llmEnabled: boolean;
  llmTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return {
    host: env["AAG_BRIDGE_HOST"] ?? "127.0.0.1",
    port: Number(env["AAG_BRIDGE_PORT"] ?? 3334),
    mcpUrl: env["AAG_MCP_URL"] ?? "http://127.0.0.1:3333/mcp",
    ollamaUrl: (env["AAG_OLLAMA_URL"] ?? "http://localhost:11434/v1").replace(/\/$/, ""),
    model: env["AAG_MODEL"] ?? "qwen2.5:7b",
    llmEnabled: env["AAG_LLM"] !== "off",
    llmTimeoutMs: Number(env["AAG_LLM_TIMEOUT_MS"] ?? 90_000)
  };
}
