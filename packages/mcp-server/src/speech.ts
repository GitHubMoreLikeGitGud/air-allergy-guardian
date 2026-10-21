import type { AlertMetric, Condition, Member, PollenType } from "./types.js";

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function spokenHour(hour: number): string {
  if (hour === 0 || hour === 24) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} a.m.` : `${hour - 12} p.m.`;
}

const METRIC_LABEL: Record<AlertMetric, string> = {
  european_aqi: "the European air quality index",
  pm2_5: "PM2.5",
  pm10: "PM10",
  ozone: "ozone",
  nitrogen_dioxide: "nitrogen dioxide",
  alder_pollen: "alder pollen",
  birch_pollen: "birch pollen",
  grass_pollen: "grass pollen",
  mugwort_pollen: "mugwort pollen",
  olive_pollen: "olive pollen",
  ragweed_pollen: "ragweed pollen"
};

export function metricLabel(metric: AlertMetric): string {
  return METRIC_LABEL[metric];
}

export function metricSpokenValue(metric: AlertMetric, value: number): string {
  const rounded = Math.round(value);
  if (metric === "european_aqi") return `${rounded}`;
  if (metric.endsWith("_pollen")) return `${rounded} grains per cubic metre`;
  return `${rounded} micrograms per cubic metre`;
}

const CONDITION_LABEL: Record<Condition, string> = {
  asthma: "asthma",
  pollen_allergy: "a pollen allergy",
  none: "no conditions"
};

export function describeMember(member: Member): string {
  const parts = member.conditions.map((c) => CONDITION_LABEL[c]);
  let text = `${member.name} has ${joinNames(parts)}`;
  if (member.conditions.includes("pollen_allergy") && member.pollen && member.pollen.length > 0) {
    text += ` to ${joinNames(member.pollen as readonly PollenType[])}`;
  }
  return text;
}

export function describeHousehold(members: readonly Member[], homeLabel: string | null): string {
  const home = homeLabel ? `Home is set to ${homeLabel}.` : "Home is set.";
  if (members.length === 0) return `${home} Nobody is in the household yet.`;
  return `${home} ${members.map(describeMember).join(", ")}.`;
}
