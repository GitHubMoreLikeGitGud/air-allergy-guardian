import { describe, expect, it } from "vitest";
import { findSeverity, routeIntent, type HouseholdSnapshot } from "../bridge/router.js";

const members = [
  { name: "Mei", conditions: ["asthma"] },
  { name: "Dev", conditions: ["pollen_allergy"], pollen: ["grass", "birch"] },
  { name: "Alex", conditions: ["none"] }
];
const household: HouseholdSnapshot = { names: ["Mei", "Dev", "Alex"], members };
const solo: HouseholdSnapshot = { names: ["Mei"], members: [members[0]] };

function call(text: string, h: HouseholdSnapshot = household) {
  const routed = routeIntent(text, h);
  if (!routed || routed.kind !== "call") throw new Error(`expected a tool call for "${text}", got ${JSON.stringify(routed)}`);
  return { tool: routed.tool, args: routed.args };
}

describe("intent router: check_outside", () => {
  it("routes the demo question with an unknown name as the member", () => {
    expect(call("Is it okay for Mira to go for a run this evening?")).toEqual({ tool: "check_outside", args: { member: "Mira" } });
  });
  it("uses the canonical spelling of a known member", () => {
    expect(call("is it okay for mei to go outside?")).toEqual({ tool: "check_outside", args: { member: "Mei" } });
    expect(call("Should Mei stay in today?")).toEqual({ tool: "check_outside", args: { member: "Mei" } });
  });
  it("asks for the whole household when no name is given", () => {
    expect(call("How's the air today?")).toEqual({ tool: "check_outside", args: {} });
    expect(call("Can everyone go outside?")).toEqual({ tool: "check_outside", args: {} });
    expect(call("Is it a good time for Mei to go outside?")).toEqual({ tool: "check_outside", args: { member: "Mei" } });
  });
});

describe("intent router: plan_outdoor_time", () => {
  it("extracts member and day", () => {
    expect(call("When is the best time for Dev to run tomorrow?")).toEqual({ tool: "plan_outdoor_time", args: { member: "Dev", day: "tomorrow" } });
    expect(call("What's the best time for alex to go for a walk?")).toEqual({ tool: "plan_outdoor_time", args: { member: "Alex", day: "today" } });
    expect(call("When can Mei cycle?")).toEqual({ tool: "plan_outdoor_time", args: { member: "Mei", day: "today" } });
  });
  it("asks who when the household has several members and none is named", () => {
    expect(routeIntent("When is the best time to go for a walk?", household)).toMatchObject({ kind: "clarify" });
    expect(call("When is the best time to go for a walk?", solo)).toEqual({ tool: "plan_outdoor_time", args: { member: "Mei", day: "today" } });
  });
});

describe("intent router: alert rules", () => {
  it("sets a rule with member, metric and threshold", () => {
    expect(call("Warn Mei when PM2.5 goes above 35")).toEqual({ tool: "set_alert_rule", args: { member: "Mei", metric: "pm2_5", above: 35 } });
    expect(call("Let me know if grass pollen for Dev goes over 50")).toEqual({ tool: "set_alert_rule", args: { member: "Dev", metric: "grass_pollen", above: 50 } });
    expect(call("Alert me when the air quality index exceeds 80", solo)).toEqual({ tool: "set_alert_rule", args: { member: "Mei", metric: "european_aqi", above: 80 } });
  });
  it("asks who the alert is for when it cannot tell", () => {
    expect(routeIntent("Alert me when the air quality index exceeds 80", household)).toMatchObject({ kind: "clarify" });
  });
  it("lists and clears rules", () => {
    expect(call("What alerts do I have?")).toEqual({ tool: "list_alert_rules", args: {} });
    expect(call("Show Dev's alert rules")).toEqual({ tool: "list_alert_rules", args: { member: "Dev" } });
    expect(call("Clear Mei's PM2.5 alert")).toEqual({ tool: "clear_alert_rule", args: { member: "Mei", metric: "pm2_5" } });
    expect(call("Remove all alerts for Alex")).toEqual({ tool: "clear_alert_rule", args: { member: "Alex" } });
  });
});

describe("intent router: symptom diary", () => {
  it("logs a symptom with severity words and numbers", () => {
    expect(call("Log a mild cough for Mei")).toEqual({ tool: "log_symptom", args: { member: "Mei", symptom: "cough", severity: 2 } });
    expect(call("Dev has a really bad headache")).toEqual({ tool: "log_symptom", args: { member: "Dev", symptom: "headache", severity: 5 } });
    expect(call("Mei is wheezing, severity 4")).toEqual({ tool: "log_symptom", args: { member: "Mei", symptom: "wheeze", severity: 4 } });
    expect(call("Alex can't breathe properly")).toEqual({ tool: "log_symptom", args: { member: "Alex", symptom: "shortness_of_breath", severity: 3 } });
    expect(call("Dev has been sneezing a lot today")).toEqual({ tool: "log_symptom", args: { member: "Dev", symptom: "sneezing", severity: 3 } });
  });
  it("reads the diary for history questions", () => {
    expect(call("What symptoms has Mei had this week?")).toEqual({ tool: "recent_symptoms", args: { member: "Mei" } });
    expect(call("Any symptoms logged recently?")).toEqual({ tool: "recent_symptoms", args: {} });
    expect(call("Has Dev had any cough lately?")).toEqual({ tool: "recent_symptoms", args: { member: "Dev" } });
  });
  it("grades severity", () => {
    expect(findSeverity("a slight sneeze")).toBe(2);
    expect(findSeverity("3 out of 5")).toBe(3);
    expect(findSeverity("a bad cough")).toBe(4);
    expect(findSeverity("terrible wheezing")).toBe(5);
  });
});

describe("intent router: household", () => {
  it("reads and relocates the household", () => {
    expect(call("Who lives at home?")).toEqual({ tool: "get_household", args: {} });
    expect(call("Set home to Singapore")).toEqual({ tool: "set_household", args: { members, place: "Singapore" } });
  });
  it("returns null for unrelated requests", () => {
    expect(routeIntent("Hello there", household)).toBeNull();
    expect(routeIntent("Tell me a joke", household)).toBeNull();
    expect(routeIntent("", household)).toBeNull();
  });
});
