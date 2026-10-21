import { metricLabel, metricSpokenValue } from "./speech.js";
import type { AlertMetric, AlertRule, Readings } from "./types.js";

export const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface AlertHit {
  rule: AlertRule;
  value: number;
  member: string;
  reason: string;
  speech: string;
}

export function metricValue(metric: AlertMetric, readings: Readings): number | null {
  if (metric.endsWith("_pollen")) {
    const type = metric.slice(0, -"_pollen".length) as keyof Readings["pollen"];
    return readings.pollen[type];
  }
  return readings[metric as Exclude<AlertMetric, `${string}_pollen`>];
}

export function ruleId(member: string, metric: AlertMetric): string {
  return `${member.trim().toLowerCase().replace(/\s+/g, "-")}:${metric}`;
}

export function describeRule(rule: AlertRule): string {
  return `${rule.member} when ${metricLabel(rule.metric)} goes above ${rule.above}`;
}

function alertSpeech(rule: AlertRule, value: number): string {
  const advice = rule.metric.endsWith("_pollen")
    ? "Keep the windows closed and plan indoor time."
    : "Keep the windows closed and skip outdoor exercise for now.";
  return `Heads up for ${rule.member}: ${metricLabel(rule.metric)} is ${metricSpokenValue(rule.metric, value)}, above the alert level of ${rule.above}. ${advice}`;
}

// Returns the single most-exceeded rule that is not in its 6-hour cooldown, and the lastFired map to persist.
export function evaluateRules(
  rules: readonly AlertRule[],
  readings: Readings,
  lastFired: Readonly<Record<string, string>>,
  now: Date,
  cooldownMs = ALERT_COOLDOWN_MS
): { hit: AlertHit | null; lastFired: Record<string, string> } {
  let best: { hit: AlertHit; ratio: number } | null = null;
  for (const rule of rules) {
    const value = metricValue(rule.metric, readings);
    if (value === null || value <= rule.above) continue;
    const previous = lastFired[rule.id];
    if (previous && now.getTime() - Date.parse(previous) < cooldownMs) continue;
    const ratio = rule.above > 0 ? value / rule.above : Number.POSITIVE_INFINITY;
    if (best && ratio <= best.ratio) continue;
    best = {
      ratio,
      hit: {
        rule,
        value,
        member: rule.member,
        reason: `${metricLabel(rule.metric)} is ${metricSpokenValue(rule.metric, value)}, above ${rule.above}`,
        speech: alertSpeech(rule, value)
      }
    };
  }
  if (!best) return { hit: null, lastFired: { ...lastFired } };
  return { hit: best.hit, lastFired: { ...lastFired, [best.hit.rule.id]: now.toISOString() } };
}
