import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface OpenAiTool {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
}

export interface FunctionCall {
  id: string;
  name: string;
  arguments: Record<string, unknown> | null;
}

export interface ChatReply {
  content: string;
  toolCalls: FunctionCall[];
}

export interface ChatModel {
  readonly name: string;
  chat(messages: ChatMessage[], tools: OpenAiTool[]): Promise<ChatReply>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Talks to Ollama's OpenAI-compatible endpoint with native tool calling.
export class OllamaChat implements ChatModel {
  constructor(
    private readonly baseUrl: string,
    readonly name: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init)
  ) {}

  async chat(messages: ChatMessage[], tools: OpenAiTool[]): Promise<ChatReply> {
    const body: Record<string, unknown> = { model: this.name, messages, temperature: 0.1, stream: false };
    if (tools.length > 0) body["tools"] = tools;
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!res.ok) throw new Error(`LLM endpoint returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return normaliseReply(await res.json());
  }

  async reachable(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export function toOpenAiTools(tools: readonly Tool[]): OpenAiTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.inputSchema ?? { type: "object", properties: {} }
    }
  }));
}

// Tool arguments arrive as a JSON string per the OpenAI format, but some servers send an object; both are accepted.
export function parseArguments(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null || raw === "") return {};
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normaliseReply(body: unknown): ChatReply {
  const message = (body as { choices?: Array<{ message?: Record<string, unknown> }> })?.choices?.[0]?.message;
  if (!message) throw new Error("LLM reply had no choices");
  const content = typeof message["content"] === "string" ? message["content"] : "";
  const rawCalls = Array.isArray(message["tool_calls"]) ? (message["tool_calls"] as unknown[]) : [];
  const toolCalls: FunctionCall[] = rawCalls.map((call, i) => {
    const c = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    return {
      id: typeof c.id === "string" && c.id ? c.id : `call_${i}`,
      name: typeof c.function?.name === "string" ? c.function.name : "",
      arguments: parseArguments(c.function?.arguments)
    };
  });
  return { content, toolCalls };
}

export function toWireToolCall(call: FunctionCall): WireToolCall {
  return { id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) } };
}
