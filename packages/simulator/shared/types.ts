// Wire types shared by the bridge (Node) and the web UI (browser).

export type CardKind = "reply" | "alert";

export interface Card {
  id: string;
  kind: CardKind;
  tool: string | null;
  title: string;
  text: string;
  data: Record<string, unknown> | null;
  isError: boolean;
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  text: string;
}

export type DecisionSource = "llm" | "router" | "none";

export interface AskRequest {
  text: string;
}

export interface AskResponse {
  speech: string;
  cards: Card[];
  toolCalls: ToolCallRecord[];
  source: DecisionSource;
  model: string | null;
}

export interface TickAlert {
  speech: string;
  member: string;
  reason: string;
}

export interface TickResponse {
  alert: TickAlert | null;
  card: Card | null;
}

export interface GlanceResponse {
  time: string | null;
  aqi: number | null;
  band: string | null;
  pm2_5: number | null;
}

export interface BridgeHealth {
  ok: boolean;
  mcp: { url: string; tools: string[] };
  llm: { enabled: boolean; model: string; url: string; reachable: boolean | null };
}
