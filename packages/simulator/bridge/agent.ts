import type { AskResponse, Card, ToolCallRecord } from "../shared/types.js";
import { cardFor, plainCard } from "./cards.js";
import { toOpenAiTools, toWireToolCall, type ChatMessage, type ChatModel, type FunctionCall } from "./llm.js";
import type { ToolResult, ToolRunner } from "./mcp.js";
import { escapeRegExp, HELP_SPEECH, routeIntent, type HouseholdSnapshot } from "./router.js";

export const MAX_ROUNDS = 3;
const TOOL_MESSAGE_LIMIT = 2000;
const SPEECH_LIMIT = 500;

export interface AgentDeps {
  runner: ToolRunner;
  model: ChatModel | null;
  now?: () => Date;
  log?: (line: string) => void;
}

interface Snapshot extends HouseholdSnapshot {
  speech: string;
}

interface Turn {
  cards: Card[];
  toolCalls: ToolCallRecord[];
}

export async function ask(text: string, deps: AgentDeps): Promise<AskResponse> {
  const log = deps.log ?? (() => undefined);
  const household = await snapshotHousehold(deps.runner);
  if (deps.model) {
    try {
      return await askModel(text, household, deps, log);
    } catch (err) {
      log(`llm failed, using the intent router: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return askRouter(text, household, deps.runner, null);
}

async function snapshotHousehold(runner: ToolRunner): Promise<Snapshot> {
  const result = await runner.call("get_household", {});
  const members = Array.isArray(result.data?.["members"]) ? (result.data!["members"] as unknown[]) : [];
  const names = members
    .map((m) => (m as { name?: unknown }).name)
    .filter((n): n is string => typeof n === "string");
  return { names, members, speech: result.text };
}

async function askModel(text: string, household: Snapshot, deps: AgentDeps, log: (line: string) => void): Promise<AskResponse> {
  const model = deps.model!;
  const runner = deps.runner;
  const known = new Set(runner.tools().map((t) => t.name));
  const tools = toOpenAiTools(runner.tools().filter((t) => t.name !== "watch_tick"));
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(household, (deps.now ?? (() => new Date()))()) },
    { role: "user", content: text }
  ];
  const turn: Turn = { cards: [], toolCalls: [] };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const reply = await model.chat(messages, tools);
    log(`round ${round}: ${reply.toolCalls.length} tool call(s)${reply.content ? `, text "${reply.content.slice(0, 80)}"` : ""}`);

    if (reply.toolCalls.length === 0) {
      if (round === 1) return askRouter(text, household, runner, reply.content, model.name);
      return finish(reply.content, turn, model.name, known);
    }
    if (round === MAX_ROUNDS) break;

    const invalid = reply.toolCalls.find((c) => !known.has(c.name) || c.name === "watch_tick" || c.arguments === null);
    if (invalid) {
      log(`invalid tool call ${invalid.name || "(unnamed)"}`);
      if (round === 1) return askRouter(text, household, runner, reply.content, model.name);
      break;
    }

    const calls = reply.toolCalls.map((call) => guardCall(call, text, household.names, log));
    messages.push({ role: "assistant", content: reply.content, tool_calls: calls.map(toWireToolCall) });
    for (const call of calls) {
      const result = await runTool(call, runner, log);
      if (result === null) {
        if (round === 1 && turn.cards.length === 0) return askRouter(text, household, runner, reply.content, model.name);
        messages.push({ role: "tool", tool_call_id: call.id, content: "The tool rejected those arguments." });
        continue;
      }
      turn.toolCalls.push(result.record);
      turn.cards.push(cardFor(call.name, result.result));
      messages.push({ role: "tool", tool_call_id: call.id, content: toolMessage(result.result) });
    }
  }
  return finish("", turn, model.name, known);
}

// A pronoun can point at a member, so a request that has one keeps the member the model chose.
const PRONOUN = /\b(?:he|she|him|her|his|hers|himself|herself|they|them|their|theirs|i|me|my|mine|myself)\b/i;

// The model sometimes fills `member` with a name the request never said ("Any symptoms logged recently?" called with
// member "Mei"). When the request names nobody in the household, does not say the member, and has no pronoun, the
// member is dropped so the answer covers everyone (or, for a tool that needs a member, the router asks who).
export function dropInventedMember(text: string, names: readonly string[], args: Record<string, unknown>): Record<string, unknown> {
  if (!("member" in args)) return args;
  const member = args["member"];
  if (typeof member === "string" && member.trim() && says(text, member.trim())) return args;
  if (names.some((name) => says(text, name)) || PRONOUN.test(text)) return args;
  const rest = { ...args };
  delete rest["member"];
  return rest;
}

const COORDINATES = /-?\d{1,3}\.\d+/;
const PLACE_SAID = /(?:\b(?:live|living|based|staying)\s+(?:in|at|near)|\bhome\s+(?:is\s+)?(?:in|at|to))\s+([A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)*)/u;

// The model tends to fill set_household's home with coordinates from memory and no label, so the household is stored
// without a spoken place name. When the request gave no coordinates, the place it named is sent instead, and the
// server geocodes it and keeps the label.
export function preferPlace(text: string, args: Record<string, unknown>): Record<string, unknown> {
  const home = args["home"];
  if (typeof home !== "object" || home === null || typeof args["place"] === "string" || COORDINATES.test(text)) return args;
  const label = (home as { label?: unknown }).label;
  const place = typeof label === "string" && label.trim() && says(text, label.trim()) ? label.trim() : text.match(PLACE_SAID)?.[1];
  if (!place) return args;
  const rest: Record<string, unknown> = { ...args, place };
  delete rest["home"];
  return rest;
}

function says(text: string, words: string): boolean {
  return new RegExp(`\\b${escapeRegExp(words)}\\b`, "i").test(text);
}

function guardCall(call: FunctionCall, text: string, names: readonly string[], log: (line: string) => void): FunctionCall {
  if (!call.arguments) return call;
  let args = dropInventedMember(text, names, call.arguments);
  if (args !== call.arguments) log(`dropped member ${JSON.stringify(call.arguments["member"])} from ${call.name}: the request names nobody`);
  if (call.name === "set_household") {
    const placed = preferPlace(text, args);
    if (placed !== args) log(`set_household: sending place ${JSON.stringify(placed["place"])} instead of coordinates the request did not give`);
    args = placed;
  }
  return args === call.arguments ? call : { ...call, arguments: args };
}

// The SDK answers bad arguments with an error result rather than an exception; both count as a rejected call.
const INVALID_ARGUMENTS = /^MCP error -32602\b|input validation error/i;

async function runTool(
  call: FunctionCall,
  runner: ToolRunner,
  log: (line: string) => void
): Promise<{ result: ToolResult; record: ToolCallRecord } | null> {
  const args = call.arguments ?? {};
  const started = Date.now();
  try {
    const result = await runner.call(call.name, args);
    if (result.isError && INVALID_ARGUMENTS.test(result.text)) {
      log(`tool ${call.name} ${JSON.stringify(args)} rejected: ${result.text.slice(0, 160)}`);
      return null;
    }
    log(`tool ${call.name} ${JSON.stringify(args)} -> ${result.isError ? "error: " : ""}${result.text.slice(0, 100)}`);
    return { result, record: { tool: call.name, args, ok: !result.isError, ms: Date.now() - started, text: result.text } };
  } catch (err) {
    log(`tool ${call.name} ${JSON.stringify(args)} rejected: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function askRouter(
  text: string,
  household: Snapshot,
  runner: ToolRunner,
  modelText: string | null,
  modelName: string | null = null
): Promise<AskResponse> {
  const routed = routeIntent(text, household);
  if (!routed) {
    const spoken = cleanSpeech(modelText ?? "");
    const speech = spoken || HELP_SPEECH;
    return { speech, cards: [plainCard(speech)], toolCalls: [], source: spoken ? "llm" : "none", model: spoken ? modelName : null };
  }
  if (routed.kind === "clarify") {
    return { speech: routed.speech, cards: [plainCard(routed.speech)], toolCalls: [], source: "router", model: null };
  }
  const started = Date.now();
  const result = await runner.call(routed.tool, routed.args);
  const speech = result.text || HELP_SPEECH;
  return {
    speech,
    cards: [cardFor(routed.tool, result)],
    toolCalls: [{ tool: routed.tool, args: routed.args, ok: !result.isError, ms: Date.now() - started, text: result.text }],
    source: "router",
    model: null
  };
}

// A final sentence that promises an action the model did not take ("let me check...") is replaced by the tool's own words.
const UNKEPT_PROMISE = /\b(let me|checking|looking (?:up|into)|one moment|hold on|i(?:'ll| will) (?:check|look|find|get))\b/i;

// Tools that confirm a change: the server's sentence is spoken as it is, so a paraphrase cannot invert it.
// The same holds for any tool that answered with an error ("I don't have anyone called Mira ...").
const CONFIRMATION_TOOLS = new Set(["set_household", "set_alert_rule", "clear_alert_rule", "log_symptom"]);

function mentionsToolName(text: string, toolNames: Iterable<string>): boolean {
  for (const name of toolNames) {
    if (new RegExp(`\\b${name.replace(/_/g, "[_ ]?")}\\b`, "i").test(text)) return true;
  }
  return false;
}

function finish(modelText: string, turn: Turn, modelName: string, toolNames: Iterable<string>): AskResponse {
  const fromTools = turn.cards.map((c) => c.text).join(" ").trim();
  const fromModel = cleanSpeech(modelText);
  const verbatim =
    turn.toolCalls.length > 0 &&
    turn.toolCalls.some((c) => CONFIRMATION_TOOLS.has(c.tool) || !c.ok);
  const unsafe = UNKEPT_PROMISE.test(fromModel) || mentionsToolName(fromModel, toolNames);
  const spoken = (fromTools && (verbatim || unsafe) ? fromTools : fromModel) || fromTools || HELP_SPEECH;
  const cards = turn.cards.length > 0 ? turn.cards : [plainCard(spoken)];
  return { speech: spoken, cards, toolCalls: turn.toolCalls, source: "llm", model: modelName };
}

function toolMessage(result: ToolResult): string {
  const data = result.data ? `\nDATA ${JSON.stringify(result.data)}` : "";
  return `${result.isError ? "ERROR: " : ""}${result.text}${data}`.slice(0, TOOL_MESSAGE_LIMIT);
}

export function cleanSpeech(text: string): string {
  const flat = text
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= SPEECH_LIMIT) return flat;
  const cut = flat.slice(0, SPEECH_LIMIT);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 100 ? cut.slice(0, end + 1) : cut;
}

export function systemPrompt(household: HouseholdSnapshot & { speech: string }, now: Date): string {
  const when = now.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return [
    "You are the voice of a household air-quality and allergy guardian, speaking on a small smart display.",
    `It is ${when} at home.`,
    `Household: ${household.speech}`,
    "Always use a tool to answer questions about air, pollen, outdoor plans, alerts or symptoms; never guess readings.",
    "Use a person's name exactly as it appears in the household. If someone is not in the household, say who is.",
    "Only pass a member when the request names a person; otherwise leave the member field out so the answer covers everyone.",
    "For 'is it okay now' questions use check_outside. For 'when' or 'best time' questions use plan_outdoor_time.",
    "To set where home is, call set_household with the place name the user said as place (for example place: \"Munich\") and leave home out. Never supply coordinates yourself unless the user gave them.",
    "After a tool answers, reply in one or two short spoken sentences, keeping the tool's wording and numbers. No lists, no markdown.",
    "Never say that you will check or look something up: either call the tool now, or give the answer you already have.",
    "Never mention tool names when you speak."
  ].join("\n");
}
