import { randomUUID } from "node:crypto";
import type { Card, CardKind } from "../shared/types.js";
import type { ToolResult } from "./mcp.js";

const TITLES: Record<string, string> = {
  check_outside: "Outside right now",
  plan_outdoor_time: "Best time outside",
  set_alert_rule: "Alert set",
  list_alert_rules: "Alert rules",
  clear_alert_rule: "Alert rules",
  watch_tick: "Heads up",
  log_symptom: "Symptom logged",
  recent_symptoms: "Symptom diary",
  get_household: "Household",
  set_household: "Household updated"
};

export function cardFor(tool: string, result: ToolResult, kind: CardKind = "reply"): Card {
  return {
    id: randomUUID(),
    kind,
    tool,
    title: result.isError ? "Guardian" : (TITLES[tool] ?? tool.replace(/_/g, " ")),
    text: result.text,
    data: result.isError ? null : result.data,
    isError: result.isError
  };
}

export function plainCard(text: string, kind: CardKind = "reply"): Card {
  return { id: randomUUID(), kind, tool: null, title: "Guardian", text, data: null, isError: false };
}
