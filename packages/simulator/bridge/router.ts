// Deterministic fallback: maps an utterance to one MCP tool call with regexes and keyword extraction.
// Used when the LLM is unreachable, returns no tool call, or returns an invalid one.

export interface HouseholdSnapshot {
  names: string[];
  members: unknown[];
}

export type Routed =
  | { kind: "call"; tool: string; args: Record<string, unknown>; why: string }
  | { kind: "clarify"; speech: string };

export const HELP_SPEECH =
  "I can check the air and pollen outside, plan outdoor time, set alerts and keep a symptom diary. " +
  "Try: is it okay for Mei to go outside?";

const NOT_A_NAME = new Set([
  "i", "it", "the", "there", "everyone", "everybody", "anyone", "someone", "we", "you", "me", "us", "them", "they",
  "today", "tomorrow", "tonight", "now", "this", "that", "what", "when", "who", "how", "which", "where", "why",
  "air", "pollen", "outside", "home", "please", "okay", "ok", "alert", "alerts", "rule", "rules", "my", "our", "a", "an"
]);

const OUTDOOR =
  /\b(go(?:ing)? out(?:side)?|outside|outdoors?|run(?:ning)?|jog(?:ging)?|walk(?:ing)?|cycl(?:e|ing)|bik(?:e|ing)|hik(?:e|ing)|play(?:ing)?|exercise|training|football|soccer|picnic|park|stay (?:in|inside|home))\b/i;
const AIR_WORDS = /\b(air|aqi|pollen|pollution|smog|haze|quality|safe|okay|ok|fine|alright|mask|windows?)\b/i;
const PLAN =
  /\b(best|better|ideal|least bad|good)\b[^.?!]*\b(time|window|hour|slot)\b|\b(when|what time|which time)\b|\b(plan|schedule|find)\b[^.?!]*\b(time|window|slot)\b/i;
const NOW_QUESTION = /\bis (?:it|now|this)\b/i;
const HOUSEHOLD = /\b(household|family|members?|who lives|who'?s (?:at )?home|who is (?:at )?home|where'?s home|where is home|home location)\b/i;
const SET_HOME = /\b(?:set|change|move|update)\b[^.?!]*\bhome\b[^.?!]*\bto\b\s+(.+?)[.?!]*$/i;
const ALERT_WORDS = /\b(alert|alerts|rule|rules|warning|warnings|notification|notifications)\b/i;
const CLEAR_WORDS = /\b(clear|remove|delete|cancel|stop|turn off|disable|forget)\b/i;
const LIST_WORDS = /\b(what|which|list|show|any|do i have|are there|current|active|my)\b/i;
const SET_ALERT_WORDS = /\b(alert|warn|tell|notify|let me know|remind|ping|wake)\b/i;
const THRESHOLD = /\b(?:above|over|exceeds?|more than|higher than|past|beyond|hits|reaches|crosses)\s+(\d+(?:\.\d+)?)/i;
const RECENT_WORDS = /\b(any|recent|recently|lately|last|this week|history|how many|how often|show|list|what)\b/i;
const LOG_WORDS = /\b(log|record|note|add|had|has|have|having|got|feel|feels|feeling|is|are|am|was|woke)\b/i;
const SYMPTOM_WORDS = /\b(symptom|symptoms|diary|logged|log)\b/i;

const METRICS: Array<[RegExp, string]> = [
  [/\bpm\s?2[.,]?5\b/i, "pm2_5"],
  [/\bpm\s?10\b/i, "pm10"],
  [/\bozone\b|\bo3\b/i, "ozone"],
  [/\bnitrogen\b|\bno2\b/i, "nitrogen_dioxide"],
  [/\bgrass\b/i, "grass_pollen"],
  [/\bbirch\b/i, "birch_pollen"],
  [/\balder\b/i, "alder_pollen"],
  [/\bolive\b/i, "olive_pollen"],
  [/\bragweed\b/i, "ragweed_pollen"],
  [/\bmugwort\b/i, "mugwort_pollen"],
  [/\baqi\b|air quality|air index|pollution|smog|haze|\bair\b/i, "european_aqi"]
];

const SYMPTOMS: Array<[RegExp, string]> = [
  [/short(?:ness)? of breath|breathless|can'?t breathe|tight chest|chest (?:is )?tight/i, "shortness_of_breath"],
  [/wheez/i, "wheeze"],
  [/cough/i, "cough"],
  [/sneez/i, "sneezing"],
  [/runny nose|stuffy|blocked nose|congest/i, "runny_nose"],
  [/itchy eyes|eyes (?:are |feel )?itch|watery eyes/i, "itchy_eyes"],
  [/headache|migraine/i, "headache"]
];

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findMember(text: string, names: readonly string[]): string | undefined {
  for (const name of names) {
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text)) return name;
  }
  const candidate = text.match(
    /\b(?:for|about|is|can|should|could|if|let|tell|warn|alert|remind|notify|log|record|does|did|has|had|when)\s+([A-Z][a-z]+)\b/
  );
  const word = candidate?.[1];
  if (word && !NOT_A_NAME.has(word.toLowerCase())) return word;
  return undefined;
}

export function findMetric(text: string): string | undefined {
  for (const [re, metric] of METRICS) if (re.test(text)) return metric;
  return undefined;
}

export function findSymptom(text: string): string | undefined {
  for (const [re, symptom] of SYMPTOMS) if (re.test(text)) return symptom;
  return undefined;
}

export function findSeverity(text: string): number {
  const explicit = text.match(/\bseverity\s*(?:of\s*)?([1-5])\b/i) ?? text.match(/\b([1-5])\s*(?:out )?of\s*5\b/i);
  if (explicit?.[1]) return Number(explicit[1]);
  if (/\b(severe|terrible|awful|really bad|very bad|worst)\b/i.test(text)) return 5;
  if (/\b(bad|heavy|strong|nasty)\b/i.test(text)) return 4;
  if (/\b(mild|slight|slightly|little|bit of)\b/i.test(text)) return 2;
  return 3;
}

function dayOf(text: string): "today" | "tomorrow" {
  return /\btomorrow\b/i.test(text) ? "tomorrow" : "today";
}

function onlyMember(household: HouseholdSnapshot): string | undefined {
  return household.names.length === 1 ? household.names[0] : undefined;
}

export function routeIntent(text: string, household: HouseholdSnapshot): Routed | null {
  const t = text.trim();
  if (!t) return null;
  const member = findMember(t, household.names);

  const home = t.match(SET_HOME);
  if (home?.[1]) {
    return { kind: "call", tool: "set_household", args: { members: household.members, place: home[1].trim() }, why: "set home" };
  }

  const symptom = findSymptom(t);
  if ((symptom || SYMPTOM_WORDS.test(t)) && RECENT_WORDS.test(t) && !/\b(log|record|note|add)\b/i.test(t)) {
    return { kind: "call", tool: "recent_symptoms", args: member ? { member } : {}, why: "symptom history" };
  }
  if (symptom && (LOG_WORDS.test(t) || member)) {
    const who = member ?? onlyMember(household);
    if (!who) return { kind: "clarify", speech: "Who is that for? Say the person's name and I'll log it." };
    return { kind: "call", tool: "log_symptom", args: { member: who, symptom, severity: findSeverity(t) }, why: "log symptom" };
  }

  if (ALERT_WORDS.test(t) && CLEAR_WORDS.test(t)) {
    const metric = findMetric(t);
    const args: Record<string, unknown> = {};
    if (member) args["member"] = member;
    if (metric && member) args["metric"] = metric;
    return { kind: "call", tool: "clear_alert_rule", args, why: "clear alert" };
  }
  const threshold = t.match(THRESHOLD);
  if (threshold?.[1] && SET_ALERT_WORDS.test(t)) {
    const who = member ?? onlyMember(household);
    if (!who) return { kind: "clarify", speech: "Who should I warn? For example: warn Mei when PM2.5 goes above 35." };
    const metric = findMetric(t) ?? "european_aqi";
    return { kind: "call", tool: "set_alert_rule", args: { member: who, metric, above: Number(threshold[1]) }, why: "set alert" };
  }
  if (ALERT_WORDS.test(t) && LIST_WORDS.test(t)) {
    return { kind: "call", tool: "list_alert_rules", args: member ? { member } : {}, why: "list alerts" };
  }

  if (HOUSEHOLD.test(t)) return { kind: "call", tool: "get_household", args: {}, why: "household" };

  if (PLAN.test(t) && !NOW_QUESTION.test(t) && (OUTDOOR.test(t) || /\b(time|window|slot)\b/i.test(t))) {
    const who = member ?? onlyMember(household);
    if (!who) return { kind: "clarify", speech: "Who is the outing for? Say the person's name and I'll find the best time." };
    return { kind: "call", tool: "plan_outdoor_time", args: { member: who, day: dayOf(t) }, why: "plan outdoor time" };
  }
  if (OUTDOOR.test(t) || AIR_WORDS.test(t)) {
    return { kind: "call", tool: "check_outside", args: member ? { member } : {}, why: "check outside" };
  }
  return null;
}
