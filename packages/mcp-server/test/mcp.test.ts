import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../src/context.js";
import { startHttpServer, type RunningServer } from "../src/http.js";
import { fixtureFetch, SEED_FILE, tempDataFile } from "./helpers.js";

const EXPECTED_TOOLS = [
  "check_outside",
  "clear_alert_rule",
  "get_household",
  "list_alert_rules",
  "log_symptom",
  "plan_outdoor_time",
  "recent_symptoms",
  "set_alert_rule",
  "set_household",
  "watch_tick"
];

type Structured = Record<string, any>;

describe("MCP round trip over Streamable HTTP", () => {
  let running: RunningServer;
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  let clock = new Date("2026-10-17T09:05:00Z");

  beforeAll(async () => {
    const ctx = createContext({
      dataFile: await tempDataFile(),
      seedFile: fileURLToPath(SEED_FILE),
      fetchImpl: fixtureFetch(),
      now: () => clock
    });
    running = await startHttpServer(ctx, { host: "127.0.0.1", port: 0 });
    transport = new StreamableHTTPClientTransport(new URL(running.url));
    client = new Client({ name: "aag-test", version: "0.1.0" });
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
    await running.close();
  });

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    return { text: content[0]?.text ?? "", structured: result.structuredContent as Structured, isError: result.isError };
  }

  it("negotiates protocol 2025-11-25 and lists every tool", async () => {
    expect(transport.protocolVersion).toBe("2025-11-25");
    expect(client.getServerVersion()?.name).toBe("air-allergy-guardian");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(EXPECTED_TOOLS);
    expect(tools.every((t) => t.outputSchema)).toBe(true);
  });

  it("serves a health check and CORS preflight", async () => {
    const base = running.url.replace(/\/mcp$/, "");
    const health = (await (await fetch(`${base}/health`)).json()) as Structured;
    expect(health.protocolVersion).toBe("2025-11-25");
    const preflight = await fetch(running.url, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("check_outside speaks a verdict for the seeded household", async () => {
    const { text, structured } = await call("check_outside");
    expect(text).toBe(
      "Everyone should stay in. The air is extremely poor right now, European AQI 171, with PM2.5 at 69 micrograms. Pollen is not forecast for this location."
    );
    expect(structured.members).toHaveLength(3);
    expect(structured.members[0]).toMatchObject({ member: "Mei", verdict: "stay_in" });
    expect(structured.readings.european_aqi).toBe(171);
    expect(structured.timezone).toBe("Asia/Singapore");
    expect(structured.speech).toBe(text);
  });

  it("check_outside can answer for one member and rejects unknown names", async () => {
    const one = await call("check_outside", { member: "mei" });
    expect(one.structured.members).toHaveLength(1);
    expect(one.text.startsWith("Mei should stay in.")).toBe(true);
    expect(one.text).not.toContain("Pollen");
    const dev = await call("check_outside", { member: "Dev" });
    expect(dev.text.endsWith("Pollen is not forecast for this location.")).toBe(true);
    const unknown = await call("check_outside", { member: "Nobody" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("Nobody");
  });

  it("plan_outdoor_time picks a window from the hourly forecast", async () => {
    const { text, structured } = await call("plan_outdoor_time", { member: "Alex", day: "tomorrow" });
    expect(structured.window).toMatchObject({ start: "2026-10-18T19:00", end: "2026-10-18T21:00", verdict: "caution" });
    expect(text).toBe("The least bad time for Alex tomorrow is 7 p.m. to 9 p.m., but take care: air quality is poor (European AQI 73).");
    const mei = await call("plan_outdoor_time", { member: "Mei", day: "tomorrow" });
    expect(mei.text).toContain("There's no safe window for Mei tomorrow.");
  });

  it("set_household geocodes a place and get_household reads it back", async () => {
    const set = await call("set_household", {
      place: "Singapore",
      members: [{ name: "Mei", conditions: ["asthma"] }, { name: "Dev", conditions: ["pollen_allergy"], pollen: ["grass"] }]
    });
    expect(set.structured.home).toMatchObject({ latitude: 1.28967, longitude: 103.85007, label: "Singapore" });
    const got = await call("get_household");
    expect(got.structured.members.map((m: { name: string }) => m.name)).toEqual(["Mei", "Dev"]);
    expect(got.text).toBe("Home is set to Singapore. Mei has asthma, Dev has a pollen allergy to grass.");
  });

  it("watch_tick fires an alert once and then stays quiet for six hours", async () => {
    const rule = await call("set_alert_rule", { member: "Mei", metric: "pm2_5", above: 35 });
    expect(rule.text).toBe("Okay, I'll warn Mei when PM2.5 goes above 35.");
    const first = await call("watch_tick");
    expect(first.structured.alert).toMatchObject({ member: "Mei" });
    expect(first.structured.alert.speech).toContain("PM2.5 is 69 micrograms per cubic metre");
    expect(first.text).toBe(first.structured.alert.speech);

    clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
    const second = await call("watch_tick");
    expect(second.structured).toEqual({ alert: null });

    clock = new Date(clock.getTime() + 5 * 60 * 60 * 1000);
    const third = await call("watch_tick");
    expect(third.structured.alert.member).toBe("Mei");

    const list = await call("list_alert_rules");
    expect(list.structured.rules).toHaveLength(1);
    const cleared = await call("clear_alert_rule", { member: "Mei", metric: "pm2_5" });
    expect(cleared.structured.removed).toBe(1);
    expect((await call("watch_tick")).structured).toEqual({ alert: null });
  });

  it("log_symptom attaches readings and recent_symptoms summarises them", async () => {
    const logged = await call("log_symptom", { member: "Mei", symptom: "wheeze", severity: 3 });
    expect(logged.text).toBe("Logged wheezing for Mei at severity 3 when the European AQI was 171.");
    expect(logged.structured.entry.readings.pm2_5).toBe(68.5);
    const recent = await call("recent_symptoms", { member: "Mei" });
    expect(recent.structured.count).toBe(1);
    expect(recent.structured.averageEuropeanAqi).toBe(171);
    expect(recent.text).toContain("Mei logged one symptom in the last 7 days");
  });
});
