import { describe, expect, it } from "vitest";
import { ALERT_COOLDOWN_MS, evaluateRules, ruleId } from "../src/alerts.js";
import { parseForecast } from "../src/openmeteo.js";
import type { AlertRule } from "../src/types.js";
import { loadAirFixture } from "./helpers.js";

const pm25: AlertRule = { id: ruleId("Mei", "pm2_5"), member: "Mei", metric: "pm2_5", above: 35 };
const aqi: AlertRule = { id: ruleId("Alex", "european_aqi"), member: "Alex", metric: "european_aqi", above: 100 };
const grass: AlertRule = { id: ruleId("Dev", "grass_pollen"), member: "Dev", metric: "grass_pollen", above: 20 };
const current = parseForecast(loadAirFixture()).current;
const t0 = new Date("2026-10-17T09:00:00Z");

describe("alert rules", () => {
  it("fires when a reading is above the threshold and records the time", () => {
    const { hit, lastFired } = evaluateRules([pm25], current, {}, t0);
    expect(hit?.member).toBe("Mei");
    expect(hit?.speech).toContain("Heads up for Mei");
    expect(hit?.speech).toContain("above the alert level of 35");
    expect(lastFired[pm25.id]).toBe(t0.toISOString());
  });

  it("does not repeat the same alert within six hours", () => {
    const first = evaluateRules([pm25], current, {}, t0);
    const fiveHours = new Date(t0.getTime() + 5 * 60 * 60 * 1000);
    expect(evaluateRules([pm25], current, first.lastFired, fiveHours).hit).toBeNull();
    const later = new Date(t0.getTime() + ALERT_COOLDOWN_MS + 60_000);
    expect(evaluateRules([pm25], current, first.lastFired, later).hit?.member).toBe("Mei");
  });

  it("picks the most exceeded rule when several fire", () => {
    const { hit, lastFired } = evaluateRules([aqi, pm25], current, {}, t0);
    expect(hit?.rule.id).toBe(pm25.id);
    expect(Object.keys(lastFired)).toEqual([pm25.id]);
  });

  it("ignores rules whose reading is missing or not exceeded", () => {
    expect(evaluateRules([grass], current, {}, t0).hit).toBeNull();
    const high: AlertRule = { ...pm25, above: 100 };
    expect(evaluateRules([high], current, {}, t0).hit).toBeNull();
  });
});
