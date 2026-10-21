import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { ask, cleanSpeech, dropInventedMember, MAX_ROUNDS, preferPlace, systemPrompt } from "../bridge/agent.js";
import type { ChatMessage, ChatModel, ChatReply, OpenAiTool } from "../bridge/llm.js";
import type { ToolResult, ToolRunner } from "../bridge/mcp.js";

const TOOL_NAMES = [
  "set_household", "get_household", "check_outside", "plan_outdoor_time", "set_alert_rule",
  "list_alert_rules", "clear_alert_rule", "watch_tick", "log_symptom", "recent_symptoms"
];

const HOUSEHOLD: ToolResult = {
  text: "Home is set to home in the Singapore city centre. Mei has asthma, Dev has a pollen allergy to grass and birch, Alex has no conditions.",
  data: { home: { latitude: 1.2838, longitude: 103.8591 }, members: [{ name: "Mei", conditions: ["asthma"] }, { name: "Dev", conditions: ["pollen_allergy"] }, { name: "Alex", conditions: ["none"] }] },
  isError: false
};

const OUTSIDE: ToolResult = {
  text: "Mei should stay in. The air is extremely poor right now, European AQI 171, with PM2.5 at 69 micrograms.",
  data: { readings: { european_aqi: 171, pm2_5: 68.5 }, members: [{ member: "Mei", verdict: "stay_in", reason: "air quality is extremely poor" }] },
  isError: false
};

type Canned = ToolResult | Error | ((args: Record<string, unknown>) => ToolResult | Error);

class FakeRunner implements ToolRunner {
  calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  constructor(private readonly results: Record<string, Canned> = {}) {}
  tools(): Tool[] {
    return TOOL_NAMES.map((name) => ({ name, description: `${name} tool`, inputSchema: { type: "object", properties: { member: { type: "string" } } } }));
  }
  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    if (name === "get_household") return HOUSEHOLD;
    const canned = this.results[name];
    const result = typeof canned === "function" ? canned(args) : canned;
    if (result instanceof Error) throw result;
    return result ?? { text: `${name} done`, data: { ok: true }, isError: false };
  }
}

class FakeModel implements ChatModel {
  readonly name = "fake-model";
  seen: Array<{ messages: ChatMessage[]; tools: OpenAiTool[] }> = [];
  constructor(private readonly replies: Array<ChatReply | Error>) {}
  async chat(messages: ChatMessage[], tools: OpenAiTool[]): Promise<ChatReply> {
    this.seen.push({ messages: structuredClone(messages), tools });
    const next = this.replies.shift() ?? { content: "", toolCalls: [] };
    if (next instanceof Error) throw next;
    return next;
  }
}

const toolCall = (name: string, args: Record<string, unknown> | null, id = "call_1") => ({ id, name, arguments: args });

describe("agent: LLM with native tool calls", () => {
  it("executes the model's tool call through MCP, feeds the result back and speaks the model's final sentence", async () => {
    const runner = new FakeRunner({ check_outside: OUTSIDE });
    const model = new FakeModel([
      { content: "", toolCalls: [toolCall("check_outside", { member: "Mei" })] },
      { content: "Mei should stay in today; the air is extremely poor with a European AQI of 171.", toolCalls: [] }
    ]);
    const answer = await ask("Is it okay for Mei to go outside?", { runner, model });

    expect(answer.source).toBe("llm");
    expect(answer.model).toBe("fake-model");
    expect(answer.speech).toBe("Mei should stay in today; the air is extremely poor with a European AQI of 171.");
    expect(answer.toolCalls).toEqual([expect.objectContaining({ tool: "check_outside", args: { member: "Mei" }, ok: true })]);
    expect(answer.cards).toHaveLength(1);
    expect(answer.cards[0]).toMatchObject({ tool: "check_outside", kind: "reply", text: OUTSIDE.text, data: OUTSIDE.data, isError: false });
    expect(runner.calls.map((c) => c.name)).toEqual(["get_household", "check_outside"]);

    const first = model.seen[0]!;
    expect(first.tools.map((t) => t.function.name)).not.toContain("watch_tick");
    expect(first.tools).toHaveLength(TOOL_NAMES.length - 1);
    expect(first.messages[0]!.content).toContain("Mei has asthma");

    const second = model.seen[1]!;
    const toolMessage = second.messages.find((m) => m.role === "tool")!;
    expect(toolMessage.tool_call_id).toBe("call_1");
    expect(toolMessage.content).toContain(OUTSIDE.text);
    expect(toolMessage.content).toContain('"european_aqi":171');
    expect(second.messages.find((m) => m.role === "assistant")!.tool_calls![0]!.function.arguments).toBe('{"member":"Mei"}');
  });

  it("speaks the tool text when the model's final reply is empty", async () => {
    const runner = new FakeRunner({ check_outside: OUTSIDE });
    const model = new FakeModel([{ content: "", toolCalls: [toolCall("check_outside", {})] }, { content: "   ", toolCalls: [] }]);
    const answer = await ask("How is the air?", { runner, model });
    expect(answer.speech).toBe(OUTSIDE.text);
    expect(answer.source).toBe("llm");
  });

  it("stops after the round cap and does not execute the extra tool calls", async () => {
    const runner = new FakeRunner({ check_outside: OUTSIDE });
    const endless = { content: "", toolCalls: [toolCall("check_outside", { member: "Mei" })] };
    const model = new FakeModel([endless, endless, endless, endless]);
    const answer = await ask("Is it okay for Mei to go outside?", { runner, model });
    expect(model.seen).toHaveLength(MAX_ROUNDS);
    expect(runner.calls.filter((c) => c.name === "check_outside")).toHaveLength(MAX_ROUNDS - 1);
    expect(answer.cards).toHaveLength(MAX_ROUNDS - 1);
    expect(answer.speech).toBe(`${OUTSIDE.text} ${OUTSIDE.text}`);
  });

  it("speaks the tool's words when the model promises a check it did not make", async () => {
    const unknown: ToolResult = { text: "I don't have anyone called Mira in the household. I know Mei, Dev, Alex.", data: null, isError: true };
    const runner = new FakeRunner({ check_outside: unknown });
    const model = new FakeModel([
      { content: "", toolCalls: [toolCall("check_outside", { member: "Mira" })] },
      { content: "Mira is not in the household. Let me check on Mei instead. Checking now.", toolCalls: [] }
    ]);
    const answer = await ask("Is it okay for Mira to go for a run?", { runner, model });
    expect(answer.speech).toBe(unknown.text);
    expect(answer.source).toBe("llm");
  });

  it("speaks the tool's words when the model reads a tool name aloud", async () => {
    const noHome: ToolResult = { text: "I don't know where home is yet. Tell me where home is first, for example: we live in Munich.", data: null, isError: true };
    const runner = new FakeRunner({ check_outside: noHome });
    const model = new FakeModel([
      { content: "", toolCalls: [toolCall("check_outside", {})] },
      { content: "I need to know where home is first. Could you set the home location using the sethousehold tool?", toolCalls: [] }
    ]);
    const answer = await ask("Is it okay to go outside?", { runner, model });
    expect(answer.speech).toBe(noHome.text);
  });

  it("speaks the server's confirmation as it is when a change-making tool ran", async () => {
    const cleared: ToolResult = { text: "Cleared one alert rule. There are no alert rules set.", data: { removed: 1, rules: [] }, isError: false };
    const runner = new FakeRunner({ clear_alert_rule: cleared });
    const model = new FakeModel([
      { content: "", toolCalls: [toolCall("clear_alert_rule", { member: "Alex" })] },
      { content: "There were no alert rules set for Alex to clear.", toolCalls: [] }
    ]);
    const answer = await ask("Clear the alert for Alex", { runner, model });
    expect(answer.speech).toBe(cleared.text);
    expect(answer.source).toBe("llm");
    expect(answer.cards[0]).toMatchObject({ tool: "clear_alert_rule", text: cleared.text });
  });

  it("speaks the server's words when a change-making tool ran alongside a question", async () => {
    const set: ToolResult = { text: "Okay, I'll warn Alex when the European air quality index goes above 1.", data: { rules: [] }, isError: false };
    const list: ToolResult = { text: "One alert rule: Alex when the European air quality index goes above 1.", data: { rules: [] }, isError: false };
    const runner = new FakeRunner({ set_alert_rule: set, list_alert_rules: list });
    const model = new FakeModel([
      { content: "", toolCalls: [toolCall("set_alert_rule", { member: "Alex", metric: "european_aqi", above: 1 }), toolCall("list_alert_rules", {}, "call_2")] },
      { content: "There are no alert rules for Alex.", toolCalls: [] }
    ]);
    const answer = await ask("Warn Alex when the air quality index goes above 1 and list the alerts", { runner, model });
    expect(answer.speech).toBe(`${set.text} ${list.text}`);
    expect(answer.source).toBe("llm");
  });

  it("speaks the tool's words when a tool answered with an error, whatever the model says", async () => {
    const unknown: ToolResult = { text: "I don't have anyone called Mira in the household. I know Mei, Dev, Alex.", data: null, isError: true };
    const runner = new FakeRunner({ check_outside: unknown });
    const model = new FakeModel([
      { content: "", toolCalls: [toolCall("check_outside", { member: "Mira" })] },
      { content: "It's okay for Mei, Dev, or Alex to go for a run based on current conditions.", toolCalls: [] }
    ]);
    const answer = await ask("Is it okay for Mira to go for a run?", { runner, model });
    expect(answer.speech).toBe(unknown.text);
    expect(answer.source).toBe("llm");
  });

  it("keeps an error result as a spoken card", async () => {
    const unknown: ToolResult = { text: "I don't have anyone called Mira in the household. I know Mei, Dev, Alex.", data: null, isError: true };
    const runner = new FakeRunner({ check_outside: unknown });
    const model = new FakeModel([{ content: "", toolCalls: [toolCall("check_outside", { member: "Mira" })] }, { content: "", toolCalls: [] }]);
    const answer = await ask("Is it okay for Mira to go for a run?", { runner, model });
    expect(answer.speech).toBe(unknown.text);
    expect(answer.cards[0]).toMatchObject({ isError: true, tool: "check_outside" });
    expect(answer.toolCalls[0]!.ok).toBe(false);
  });
});

describe("agent: deterministic fallback", () => {
  it("routes with regexes when the model returns no tool call", async () => {
    const runner = new FakeRunner({ check_outside: OUTSIDE });
    const model = new FakeModel([{ content: "Let me think about that.", toolCalls: [] }]);
    const answer = await ask("Is it okay for Mei to go outside?", { runner, model });
    expect(answer.source).toBe("router");
    expect(answer.speech).toBe(OUTSIDE.text);
    expect(runner.calls.at(-1)).toEqual({ name: "check_outside", args: { member: "Mei" } });
    expect(model.seen).toHaveLength(1);
  });

  it("falls back when the model names a tool that does not exist", async () => {
    const runner = new FakeRunner({ plan_outdoor_time: { text: "The best time for Dev tomorrow is 7 a.m. to 9 a.m.", data: null, isError: false } });
    const model = new FakeModel([{ content: "", toolCalls: [toolCall("weather_lookup", { city: "Singapore" })] }]);
    const answer = await ask("When is the best time for Dev to run tomorrow?", { runner, model });
    expect(answer.source).toBe("router");
    expect(runner.calls.at(-1)).toEqual({ name: "plan_outdoor_time", args: { member: "Dev", day: "tomorrow" } });
  });

  it("falls back when the arguments are not valid JSON", async () => {
    const runner = new FakeRunner({ check_outside: OUTSIDE });
    const model = new FakeModel([{ content: "", toolCalls: [toolCall("check_outside", null)] }]);
    const answer = await ask("How is the air outside?", { runner, model });
    expect(answer.source).toBe("router");
    expect(runner.calls.at(-1)).toEqual({ name: "check_outside", args: {} });
  });

  it("falls back when the server rejects the model's arguments", async () => {
    const runner = new FakeRunner({
      set_alert_rule: (args) =>
        args["metric"] === "dust"
          ? new Error("MCP error -32602: Input validation error")
          : { text: "Okay, I'll warn Mei when PM2.5 goes above 35.", data: { rules: [] }, isError: false }
    });
    const model = new FakeModel([{ content: "", toolCalls: [toolCall("set_alert_rule", { member: "Mei", metric: "dust", above: 35 })] }]);
    const answer = await ask("Warn Mei when PM2.5 goes above 35", { runner, model });
    expect(answer.source).toBe("router");
    expect(answer.speech).toBe("Okay, I'll warn Mei when PM2.5 goes above 35.");
    expect(runner.calls.filter((c) => c.name === "set_alert_rule")).toEqual([
      { name: "set_alert_rule", args: { member: "Mei", metric: "dust", above: 35 } },
      { name: "set_alert_rule", args: { member: "Mei", metric: "pm2_5", above: 35 } }
    ]);
  });

  it("falls back when the server answers with an input validation error result", async () => {
    const rejected: ToolResult = {
      text: "MCP error -32602: Input validation error: Invalid arguments for tool recent_symptoms: Invalid input: expected number, received string at days",
      data: null,
      isError: true
    };
    const ok: ToolResult = { text: "The household logged one symptom in the last 7 days.", data: { count: 1 }, isError: false };
    const runner = new FakeRunner({ recent_symptoms: (args) => (typeof args["days"] === "string" ? rejected : ok) });
    const model = new FakeModel([{ content: "", toolCalls: [toolCall("recent_symptoms", { days: "this week" })] }]);
    const answer = await ask("Has anyone logged symptoms this week?", { runner, model });
    expect(answer.source).toBe("router");
    expect(answer.speech).toBe(ok.text);
    expect(answer.cards.map((c) => c.text)).toEqual([ok.text]);
    expect(runner.calls.filter((c) => c.name === "recent_symptoms").map((c) => c.args)).toEqual([{ days: "this week" }, {}]);
  });

  it("falls back when the model endpoint is unreachable", async () => {
    const runner = new FakeRunner({ check_outside: OUTSIDE });
    const model = new FakeModel([new Error("fetch failed")]);
    const log: string[] = [];
    const answer = await ask("Is it okay for Mei to go outside?", { runner, model, log: (l) => log.push(l) });
    expect(answer.source).toBe("router");
    expect(answer.speech).toBe(OUTSIDE.text);
    expect(log.some((l) => l.includes("fetch failed"))).toBe(true);
  });

  it("works with no model at all", async () => {
    const runner = new FakeRunner({ list_alert_rules: { text: "There are no alert rules set.", data: { rules: [] }, isError: false } });
    const answer = await ask("What alerts do I have?", { runner, model: null });
    expect(answer).toMatchObject({ source: "router", speech: "There are no alert rules set.", model: null });
    expect(answer.cards[0]).toMatchObject({ tool: "list_alert_rules", data: { rules: [] } });
  });

  it("uses the model's own words when nothing routes", async () => {
    const runner = new FakeRunner();
    const model = new FakeModel([{ content: "Hello! I look after the air at home.", toolCalls: [] }]);
    const answer = await ask("Hello there", { runner, model });
    expect(answer.speech).toBe("Hello! I look after the air at home.");
    expect(answer).toMatchObject({ source: "llm", model: "fake-model" });
    expect(answer.toolCalls).toEqual([]);
    expect(answer.cards).toHaveLength(1);
  });

  it("gives help when nothing routes and there is no model", async () => {
    const answer = await ask("Tell me a joke", { runner: new FakeRunner(), model: null });
    expect(answer.source).toBe("none");
    expect(answer.speech).toContain("Try: is it okay for Mei to go outside?");
  });
});

const SNAPSHOT_NAMES = ["Mei", "Dev", "Alex"];

describe("agent: member guard", () => {
  it("drops a member the request never named, so the answer covers everyone", async () => {
    const diary: ToolResult = { text: "Dev logged sneezing at severity 3 when the European AQI was 27.", data: { count: 1 }, isError: false };
    const runner = new FakeRunner({ recent_symptoms: diary });
    const model = new FakeModel([
      { content: "", toolCalls: [toolCall("recent_symptoms", { member: "Mei" })] },
      { content: "Dev logged sneezing at severity 3.", toolCalls: [] }
    ]);
    const log: string[] = [];
    const answer = await ask("Any symptoms logged recently?", { runner, model, log: (l) => log.push(l) });
    expect(runner.calls.filter((c) => c.name === "recent_symptoms").map((c) => c.args)).toEqual([{}]);
    expect(answer.toolCalls[0]).toMatchObject({ tool: "recent_symptoms", args: {} });
    expect(answer.source).toBe("llm");
    expect(model.seen[1]!.messages.find((m) => m.role === "assistant")!.tool_calls![0]!.function.arguments).toBe("{}");
    expect(log.some((l) => l.includes('dropped member "Mei" from recent_symptoms'))).toBe(true);
  });

  it("keeps the member when the request uses a pronoun", async () => {
    const runner = new FakeRunner({ check_outside: OUTSIDE });
    const model = new FakeModel([{ content: "", toolCalls: [toolCall("check_outside", { member: "Mei" })] }, { content: "", toolCalls: [] }]);
    await ask("Is it okay for her to go outside?", { runner, model });
    expect(runner.calls.at(-1)).toEqual({ name: "check_outside", args: { member: "Mei" } });
  });

  it("asks who when a tool that needs a member loses an invented one", async () => {
    const rejected: ToolResult = {
      text: "MCP error -32602: Input validation error: Invalid arguments for tool plan_outdoor_time: Invalid input: expected string, received undefined at member",
      data: null,
      isError: true
    };
    const runner = new FakeRunner({ plan_outdoor_time: (args) => ("member" in args ? { text: "planned", data: null, isError: false } : rejected) });
    const model = new FakeModel([{ content: "", toolCalls: [toolCall("plan_outdoor_time", { member: "Dev", day: "today" })] }]);
    const answer = await ask("When is the best time to go for a walk?", { runner, model });
    expect(runner.calls.filter((c) => c.name === "plan_outdoor_time").map((c) => c.args)).toEqual([{ day: "today" }]);
    expect(answer.source).toBe("router");
    expect(answer.speech).toContain("Who is the outing for?");
  });

  it("decides from the words of the request", () => {
    const args = { member: "Mei", days: 7 };
    expect(dropInventedMember("Any symptoms logged recently?", SNAPSHOT_NAMES, args)).toEqual({ days: 7 });
    expect(dropInventedMember("Can everyone go outside?", SNAPSHOT_NAMES, args)).toEqual({ days: 7 });
    expect(dropInventedMember("Has anyone logged symptoms?", SNAPSHOT_NAMES, { member: null })).toEqual({});
    expect(dropInventedMember("Any symptoms for mei?", SNAPSHOT_NAMES, args)).toBe(args);
    expect(dropInventedMember("Is it okay for Dev to go outside?", SNAPSHOT_NAMES, args)).toBe(args);
    expect(dropInventedMember("Is it okay for Mira to go for a run?", SNAPSHOT_NAMES, { member: "Mira" })).toEqual({ member: "Mira" });
    expect(dropInventedMember("Has he been coughing?", SNAPSHOT_NAMES, args)).toBe(args);
    expect(dropInventedMember("Can I go for a run?", SNAPSHOT_NAMES, args)).toBe(args);
    expect(dropInventedMember("How is the air?", SNAPSHOT_NAMES, { day: "today" })).toEqual({ day: "today" });
  });
});

describe("agent: set_household prefers a place name", () => {
  const members = [{ name: "Mei", conditions: ["asthma"] }];

  it("sends the place the request named instead of coordinates the model filled in", async () => {
    const runner = new FakeRunner({ set_household: { text: "Home is set to Singapore. Mei has asthma.", data: null, isError: false } });
    const model = new FakeModel([
      { content: "", toolCalls: [toolCall("set_household", { members, home: { latitude: 1.3521, longitude: 103.8198 } })] },
      { content: "", toolCalls: [] }
    ]);
    const log: string[] = [];
    const answer = await ask("We live in Singapore. Mei has asthma.", { runner, model, log: (l) => log.push(l) });
    expect(runner.calls.at(-1)).toEqual({ name: "set_household", args: { members, place: "Singapore" } });
    expect(answer.speech).toBe("Home is set to Singapore. Mei has asthma.");
    expect(log.some((l) => l.includes('sending place "Singapore"'))).toBe(true);
  });

  it("uses the model's label when the request said it, or the place after 'live in' / 'home is in' / 'home to'", () => {
    const args = { members, home: { latitude: 48.1373, longitude: 11.5757, label: "Munich" } };
    expect(preferPlace("we live in munich and Mei has asthma", args)).toEqual({ members, place: "Munich" });
    expect(preferPlace("Our home is in Berlin and Mei has asthma.", { members, home: { latitude: 52.52, longitude: 13.405 } })).toEqual({
      members,
      place: "Berlin"
    });
    expect(preferPlace("Move home to New York", { members, home: { latitude: 40.7, longitude: -74 } })).toEqual({ members, place: "New York" });
  });

  it("keeps coordinates the user gave, an explicit place, or a request with no place in it", () => {
    const home = { latitude: 1.2838, longitude: 103.8591 };
    const withCoords = { members, home };
    expect(preferPlace("Home is at 1.2838, 103.8591. Mei has asthma.", withCoords)).toBe(withCoords);
    const both = { members, home, place: "Singapore" };
    expect(preferPlace("We live in Singapore.", both)).toBe(both);
    expect(preferPlace("Mei has asthma.", withCoords)).toBe(withCoords);
    const noHome = { members };
    expect(preferPlace("We live in Singapore.", noHome)).toBe(noHome);
  });

  it("tells the model to pass place, not coordinates", () => {
    const prompt = systemPrompt({ names: [], members: [], speech: "No home location is set yet." }, new Date("2026-10-21T08:00:00Z"));
    expect(prompt).toMatch(/set_household with the place name the user said as place/);
    expect(prompt).toMatch(/Never supply coordinates yourself/);
  });
});

describe("cleanSpeech", () => {
  it("strips markdown and trims long answers at a sentence", () => {
    expect(cleanSpeech("**Mei** should _stay in_.\n\n- item")).toBe("Mei should stay in. - item");
    const long = `${"Alpha beta gamma. ".repeat(40)}`;
    const cleaned = cleanSpeech(long);
    expect(cleaned.length).toBeLessThanOrEqual(500);
    expect(cleaned.endsWith(".")).toBe(true);
  });
});
