import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeRule, evaluateRules, ruleId } from "../alerts.js";
import type { AppContext } from "../context.js";
import { joinNames } from "../speech.js";
import { ALERT_METRICS, AlertRuleSchema, type AlertRule } from "../types.js";
import { fail, findMember, noHomeResult, speak, unknownMemberResult } from "./result.js";

function rulesSpeech(rules: readonly AlertRule[]): string {
  if (rules.length === 0) return "There are no alert rules set.";
  const count = rules.length === 1 ? "One alert rule" : `${rules.length} alert rules`;
  return `${count}: ${joinNames(rules.map(describeRule))}.`;
}

export function registerAlertTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "set_alert_rule",
    {
      title: "Set alert rule",
      description:
        "Alert a person when a reading goes above a threshold. One rule per person and metric; setting it again replaces it.",
      inputSchema: {
        member: z.string().describe("Person's name"),
        metric: z.enum(ALERT_METRICS).describe("european_aqi, pm2_5, pm10, ozone, nitrogen_dioxide or a *_pollen type"),
        above: z.number().min(0).describe("Fire when the reading is above this value")
      },
      outputSchema: { rule: AlertRuleSchema, rules: z.array(AlertRuleSchema), speech: z.string() }
    },
    async ({ member, metric, above }) => {
      const household = await ctx.store.load();
      const found = findMember(household, member);
      if (!found) return unknownMemberResult(member, household);
      const rule: AlertRule = { id: ruleId(found.name, metric), member: found.name, metric, above };
      const next = await ctx.store.update((h) => {
        const { [rule.id]: _dropped, ...lastFired } = h.lastFired;
        return { ...h, alertRules: [...h.alertRules.filter((r) => r.id !== rule.id), rule], lastFired };
      });
      const speech = `Okay, I'll warn ${describeRule(rule)}.`;
      return speak(speech, { rule, rules: next.alertRules, speech });
    }
  );

  server.registerTool(
    "list_alert_rules",
    {
      title: "List alert rules",
      description: "All alert rules, optionally for one person.",
      inputSchema: { member: z.string().optional() },
      outputSchema: { rules: z.array(AlertRuleSchema), speech: z.string() }
    },
    async ({ member }) => {
      const household = await ctx.store.load();
      const rules = member
        ? household.alertRules.filter((r) => r.member.toLowerCase() === member.trim().toLowerCase())
        : household.alertRules;
      const speech = rulesSpeech(rules);
      return speak(speech, { rules, speech });
    }
  );

  server.registerTool(
    "clear_alert_rule",
    {
      title: "Clear alert rule",
      description: "Remove alert rules by id, by person and metric, or every rule for a person.",
      inputSchema: {
        id: z.string().optional(),
        member: z.string().optional(),
        metric: z.enum(ALERT_METRICS).optional()
      },
      outputSchema: { removed: z.number(), rules: z.array(AlertRuleSchema), speech: z.string() }
    },
    async ({ id, member, metric }) => {
      if (!id && !member) return fail("Tell me whose alert to clear, or give the rule id.");
      const wanted = member?.trim().toLowerCase();
      const matches = (r: AlertRule) =>
        id ? r.id === id : r.member.toLowerCase() === wanted && (metric === undefined || r.metric === metric);
      let removed = 0;
      const next = await ctx.store.update((h) => {
        const keep = h.alertRules.filter((r) => !matches(r));
        removed = h.alertRules.length - keep.length;
        return { ...h, alertRules: keep };
      });
      const speech =
        removed === 0
          ? "I didn't find a matching alert rule."
          : `Cleared ${removed === 1 ? "one alert rule" : `${removed} alert rules`}. ${rulesSpeech(next.alertRules)}`;
      return speak(speech, { removed, rules: next.alertRules, speech });
    }
  );

  server.registerTool(
    "watch_tick",
    {
      title: "Watch tick",
      description:
        "For a timer, not for conversation: checks every alert rule against the latest readings and returns a spoken alert or nothing. The same rule will not fire again within six hours.",
      inputSchema: {},
      outputSchema: {
        alert: z.object({ speech: z.string(), member: z.string(), reason: z.string() }).nullable()
      }
    },
    async () => {
      const household = await ctx.store.load();
      if (!household.home) return noHomeResult();
      if (household.alertRules.length === 0) return speak("Nothing to report.", { alert: null });
      const forecast = await ctx.forecasts.get(household.home);
      const { hit, lastFired } = evaluateRules(household.alertRules, forecast.current, household.lastFired, ctx.now());
      if (!hit) return speak("Nothing to report.", { alert: null });
      await ctx.store.update((h) => ({ ...h, lastFired: { ...h.lastFired, ...lastFired } }));
      return speak(hit.speech, { alert: { speech: hit.speech, member: hit.member, reason: hit.reason } });
    }
  );
}
