import type { Forecast } from "./openmeteo.js";
import type { Member, Readings, Verdict } from "./types.js";
import { verdictForMember, type PollenLevel } from "./verdict.js";

export type PlanDay = "today" | "tomorrow";

export interface WindowPick {
  start: string;
  end: string;
  verdict: Verdict;
  reason: string;
  europeanAqiMax: number | null;
}

export interface PlanOptions {
  day: PlanDay;
  earliestHour?: number;
  latestEndHour?: number;
}

const POLLEN_PENALTY: Record<PollenLevel, number> = { none: 0, low: 5, moderate: 30, high: 60, very_high: 100 };
const VERDICT_RANK: Record<Verdict, number> = { good: 0, caution: 1, stay_in: 2 };

export function localDate(localTime: string): string {
  return localTime.slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function hourOf(localTime: string): number {
  return Number(localTime.slice(11, 13));
}

function hourScore(member: Member, hour: Readings): { score: number; verdict: Verdict; reason: string } {
  const v = verdictForMember(member, hour);
  const pollenPenalty = v.pollen ? POLLEN_PENALTY[v.pollen.level] : 0;
  return { score: (hour.european_aqi ?? 0) + pollenPenalty, verdict: v.verdict, reason: v.reason };
}

// Picks the two-hour window with the cleanest worst hour for this member; ties go to the lower total.
export function bestWindow(member: Member, forecast: Forecast, opts: PlanOptions): WindowPick | null {
  const earliest = opts.earliestHour ?? 7;
  const latestEnd = opts.latestEndHour ?? 21;
  const today = localDate(forecast.current.time);
  const target = opts.day === "today" ? today : addDays(today, 1);
  const hours = forecast.hourly.filter((h) => localDate(h.time) === target);

  let best: { pick: WindowPick; worst: number; total: number } | null = null;
  for (let i = 0; i + 1 < hours.length; i++) {
    const first = hours[i]!;
    const second = hours[i + 1]!;
    const startHour = hourOf(first.time);
    if (startHour < earliest || startHour + 2 > latestEnd) continue;
    if (opts.day === "today" && first.time <= forecast.current.time) continue;
    const a = hourScore(member, first);
    const b = hourScore(member, second);
    const worst = Math.max(a.score, b.score);
    const total = a.score + b.score;
    if (best && (worst > best.worst || (worst === best.worst && total >= best.total))) continue;
    const worseHour = VERDICT_RANK[a.verdict] >= VERDICT_RANK[b.verdict] ? a : b;
    const aqis = [first.european_aqi, second.european_aqi].filter((x): x is number => x !== null);
    best = {
      worst,
      total,
      pick: {
        start: first.time,
        end: `${target}T${String(startHour + 2).padStart(2, "0")}:00`,
        verdict: worseHour.verdict,
        reason: worseHour.reason,
        europeanAqiMax: aqis.length ? Math.max(...aqis) : null
      }
    };
  }
  return best?.pick ?? null;
}
