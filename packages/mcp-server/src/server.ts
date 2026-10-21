import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import type { AppContext } from "./context.js";
import { registerAirTools } from "./tools/air.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerHouseholdTools } from "./tools/household.js";
import { registerSymptomTools } from "./tools/symptoms.js";

export const SERVER_INFO = { name: "air-allergy-guardian", version: "0.1.0" } as const;
export const PROTOCOL_VERSION = LATEST_PROTOCOL_VERSION;

const INSTRUCTIONS =
  "Household air-quality and pollen guardian. Call get_household to learn who lives at home. " +
  "check_outside gives a verdict per person right now; plan_outdoor_time finds the best two-hour window; " +
  "set_alert_rule and watch_tick drive proactive warnings; log_symptom and recent_symptoms keep a small diary. " +
  "Every result's text content is a ready-to-speak sentence: say it as it is.";

export function createMcpServer(ctx: AppContext): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerHouseholdTools(server, ctx);
  registerAirTools(server, ctx);
  registerAlertTools(server, ctx);
  registerSymptomTools(server, ctx);
  return server;
}
