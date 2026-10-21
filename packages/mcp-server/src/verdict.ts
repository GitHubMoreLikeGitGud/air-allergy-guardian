// European AQI bands follow the European Environment Agency index that Open-Meteo reports
// (0-20 good, 20-40 fair, 40-60 moderate, 60-80 poor, 80-100 very poor, above 100 extremely poor).
// Pollen levels follow the National Allergy Bureau scale, which groups pollen into trees, grass and weeds.
import { POLLEN_TYPES, type Member, type PollenType, type Readings, type Verdict } from "./types.js";

export type AqiBand = "good" | "fair" | "moderate" | "poor" | "very_poor" | "extremely_poor";
export type PollenLevel = "none" | "low" | "moderate" | "high" | "very_high";

export const AQI_BAND_LABEL: Record<AqiBand, string> = {
  good: "good",
  fair: "fair",
  moderate: "moderate",
  poor: "poor",
  very_poor: "very poor",
  extremely_poor: "extremely poor"
};

export const POLLEN_LEVEL_LABEL: Record<PollenLevel, string> = {
  none: "absent",
  low: "low",
  moderate: "moderate",
  high: "high",
  very_high: "very high"
};

const VERDICT_RANK: Record<Verdict, number> = { good: 0, caution: 1, stay_in: 2 };

export function aqiBand(aqi: number): AqiBand {
  if (aqi <= 20) return "good";
  if (aqi <= 40) return "fair";
  if (aqi <= 60) return "moderate";
  if (aqi <= 80) return "poor";
  if (aqi <= 100) return "very_poor";
  return "extremely_poor";
}

type PollenGroup = "tree" | "grass" | "weed";
const POLLEN_GROUP: Record<PollenType, PollenGroup> = {
  alder: "tree",
  birch: "tree",
  olive: "tree",
  grass: "grass",
  mugwort: "weed",
  ragweed: "weed"
};
// [low from, moderate from, high from, very high from], grains per cubic metre
const POLLEN_THRESHOLDS: Record<PollenGroup, [number, number, number, number]> = {
  tree: [1, 15, 90, 1500],
  grass: [1, 5, 20, 200],
  weed: [1, 10, 50, 500]
};

export function pollenLevel(type: PollenType, grainsPerM3: number): PollenLevel {
  const [low, moderate, high, veryHigh] = POLLEN_THRESHOLDS[POLLEN_GROUP[type]];
  if (grainsPerM3 >= veryHigh) return "very_high";
  if (grainsPerM3 >= high) return "high";
  if (grainsPerM3 >= moderate) return "moderate";
  if (grainsPerM3 >= low) return "low";
  return "none";
}

export function worstVerdict(a: Verdict, b: Verdict): Verdict {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

export function aqiVerdict(band: AqiBand, hasAsthma: boolean): Verdict {
  switch (band) {
    case "good":
    case "fair":
      return "good";
    case "moderate":
      return hasAsthma ? "caution" : "good";
    case "poor":
    case "very_poor":
      return hasAsthma ? "stay_in" : "caution";
    case "extremely_poor":
      return "stay_in";
  }
}

export function pollenVerdict(level: PollenLevel): Verdict {
  if (level === "high" || level === "very_high") return "stay_in";
  if (level === "moderate") return "caution";
  return "good";
}

export function relevantPollen(member: Member): readonly PollenType[] {
  if (!member.conditions.includes("pollen_allergy")) return [];
  return member.pollen && member.pollen.length > 0 ? member.pollen : POLLEN_TYPES;
}

export interface PollenDriver {
  type: PollenType;
  grainsPerM3: number;
  level: PollenLevel;
}

export interface MemberVerdict {
  member: string;
  verdict: Verdict;
  reason: string;
  aqiBand: AqiBand | null;
  pollen: PollenDriver | null;
  pollenDataAvailable: boolean;
  pollenNotForecast: boolean;
}

export function worstPollen(member: Member, readings: Pick<Readings, "pollen">): PollenDriver | null {
  let worst: PollenDriver | null = null;
  for (const type of relevantPollen(member)) {
    const value = readings.pollen[type];
    if (value === null) continue;
    const level = pollenLevel(type, value);
    if (!worst || VERDICT_RANK[pollenVerdict(level)] > VERDICT_RANK[pollenVerdict(worst.level)] || value > worst.grainsPerM3) {
      worst = { type, grainsPerM3: value, level };
    }
  }
  return worst;
}

export function verdictForMember(member: Member, readings: Readings): MemberVerdict {
  const hasAsthma = member.conditions.includes("asthma");
  const band = readings.european_aqi === null ? null : aqiBand(readings.european_aqi);
  let verdict: Verdict = band ? aqiVerdict(band, hasAsthma) : "good";
  const reasons: string[] = [];
  if (band && readings.european_aqi !== null) {
    reasons.push(`air quality is ${AQI_BAND_LABEL[band]} (European AQI ${Math.round(readings.european_aqi)})`);
  } else {
    reasons.push("no air quality reading right now");
  }

  const wantsPollen = relevantPollen(member).length > 0;
  const pollen = wantsPollen ? worstPollen(member, readings) : null;
  const pollenDataAvailable = wantsPollen && relevantPollen(member).some((t) => readings.pollen[t] !== null);
  if (pollen) {
    verdict = worstVerdict(verdict, pollenVerdict(pollen.level));
    reasons.push(`${pollen.type} pollen is ${POLLEN_LEVEL_LABEL[pollen.level]} (${Math.round(pollen.grainsPerM3)} grains per cubic metre)`);
  } else if (wantsPollen) {
    reasons.push("pollen is not forecast for this location");
  }

  const pollenNotForecast = wantsPollen && !pollen;
  return { member: member.name, verdict, reason: reasons.join("; "), aqiBand: band, pollen, pollenDataAvailable, pollenNotForecast };
}
