import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { normaliseReply, OllamaChat, parseArguments, toOpenAiTools } from "../bridge/llm.js";

describe("OpenAI-compatible plumbing", () => {
  it("maps MCP tools to function tools, keeping the JSON schema", () => {
    const tools: Tool[] = [
      { name: "check_outside", description: "Verdict per person", inputSchema: { type: "object", properties: { member: { type: "string" } } } },
      { name: "get_household", inputSchema: { type: "object", properties: {} } }
    ];
    expect(toOpenAiTools(tools)).toEqual([
      { type: "function", function: { name: "check_outside", description: "Verdict per person", parameters: tools[0]!.inputSchema } },
      { type: "function", function: { name: "get_household", parameters: tools[1]!.inputSchema } }
    ]);
  });

  it("parses arguments given as a JSON string or an object, and rejects junk", () => {
    expect(parseArguments('{"member":"Mei"}')).toEqual({ member: "Mei" });
    expect(parseArguments({ member: "Mei" })).toEqual({ member: "Mei" });
    expect(parseArguments("")).toEqual({});
    expect(parseArguments(undefined)).toEqual({});
    expect(parseArguments("{member: Mei}")).toBeNull();
    expect(parseArguments("[1,2]")).toBeNull();
    expect(parseArguments(42)).toBeNull();
  });

  it("normalises a chat.completion reply with tool calls", () => {
    const reply = normaliseReply({
      choices: [
        {
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call_a2", type: "function", function: { name: "plan_outdoor_time", arguments: '{"day":"tomorrow","member":"Mei"}' } }]
          },
          finish_reason: "tool_calls"
        }
      ]
    });
    expect(reply).toEqual({ content: "", toolCalls: [{ id: "call_a2", name: "plan_outdoor_time", arguments: { day: "tomorrow", member: "Mei" } }] });
    expect(() => normaliseReply({ choices: [] })).toThrow(/no choices/);
  });

  it("posts messages and tools to /chat/completions and honours a failing status", async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ choices: [{ message: { role: "assistant", content: "Ready." } }] });
    };
    const model = new OllamaChat("http://llm.test/v1", "qwen2.5:7b", 5000, fetchImpl);
    const reply = await model.chat([{ role: "user", content: "Say ready." }], []);
    expect(reply).toEqual({ content: "Ready.", toolCalls: [] });
    expect(seen[0]!.url).toBe("http://llm.test/v1/chat/completions");
    expect(seen[0]!.body).toMatchObject({ model: "qwen2.5:7b", stream: false, messages: [{ role: "user", content: "Say ready." }] });
    expect((seen[0]!.body as Record<string, unknown>)["tools"]).toBeUndefined();

    const failing = new OllamaChat("http://llm.test/v1", "qwen2.5:7b", 5000, async () => new Response("model not found", { status: 404 }));
    await expect(failing.chat([{ role: "user", content: "hi" }], [])).rejects.toThrow(/HTTP 404/);
  });
});
