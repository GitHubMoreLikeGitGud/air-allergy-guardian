import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { SYMPTOMS, SymptomEntrySchema, type SymptomEntry } from "../types.js";
import { findMember, speak, unknownMemberResult } from "./result.js";

const SYMPTOM_LABEL: Record<(typeof SYMPTOMS)[number], string> = {
  cough: "a cough",
  wheeze: "wheezing",
  shortness_of_breath: "shortness of breath",
  sneezing: "sneezing",
  runny_nose: "a runny nose",
  itchy_eyes: "itchy eyes",
  headache: "a headache",
  other: "a symptom"
};

function readingsPhrase(entry: SymptomEntry): string {
  const aqi = entry.readings?.european_aqi;
  return aqi === null || aqi === undefined ? "" : ` when the European AQI was ${Math.round(aqi)}`;
}

export function registerSymptomTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "log_symptom",
    {
      title: "Log symptom",
      description: "Record a symptom for a person, with the air and pollen readings at that moment attached.",
      inputSchema: {
        member: z.string(),
        symptom: z.enum(SYMPTOMS),
        severity: z.number().int().min(1).max(5).describe("1 mild to 5 severe"),
        note: z.string().max(200).optional()
      },
      outputSchema: { entry: SymptomEntrySchema, speech: z.string() }
    },
    async ({ member, symptom, severity, note }) => {
      const household = await ctx.store.load();
      const found = findMember(household, member);
      if (!found) return unknownMemberResult(member, household);
      const forecast = household.home ? await ctx.forecasts.tryGet(household.home) : null;
      const entry: SymptomEntry = {
        id: randomUUID(),
        member: found.name,
        symptom,
        severity,
        loggedAt: ctx.now().toISOString(),
        readings: forecast?.current ?? null,
        ...(note ? { note } : {})
      };
      await ctx.store.update((h) => ({ ...h, symptoms: [...h.symptoms, entry].slice(-500) }));
      const speech = `Logged ${SYMPTOM_LABEL[symptom]} for ${found.name} at severity ${severity}${readingsPhrase(entry)}.`;
      return speak(speech, { entry, speech });
    }
  );

  server.registerTool(
    "recent_symptoms",
    {
      title: "Recent symptoms",
      description: "Recent diary entries for one person or everyone, with the readings they were logged against.",
      inputSchema: {
        member: z.string().optional(),
        days: z.number().int().min(1).max(90).optional().describe("Look back this many days, default 7"),
        limit: z.number().int().min(1).max(50).optional().describe("Most recent entries to return, default 10")
      },
      outputSchema: {
        entries: z.array(SymptomEntrySchema),
        count: z.number(),
        averageEuropeanAqi: z.number().nullable(),
        speech: z.string()
      }
    },
    async ({ member, days, limit }) => {
      const household = await ctx.store.load();
      const wanted = member ? findMember(household, member) : undefined;
      if (member && !wanted) return unknownMemberResult(member, household);
      const since = ctx.now().getTime() - (days ?? 7) * 24 * 60 * 60 * 1000;
      const all = household.symptoms.filter(
        (s) => Date.parse(s.loggedAt) >= since && (!wanted || s.member === wanted.name)
      );
      const entries = all.slice(-(limit ?? 10)).reverse();
      const aqis = all.map((s) => s.readings?.european_aqi).filter((x): x is number => typeof x === "number");
      const averageEuropeanAqi = aqis.length ? Math.round(aqis.reduce((a, b) => a + b, 0) / aqis.length) : null;
      const who = wanted ? wanted.name : "The household";
      const span = `in the last ${days ?? 7} days`;
      let speech: string;
      if (all.length === 0) {
        speech = `${who} ${wanted ? "has" : "has"} no symptoms logged ${span}.`;
      } else {
        const latest = entries[0]!;
        const avg = averageEuropeanAqi === null ? "" : ` On average the European AQI was ${averageEuropeanAqi} at those times.`;
        speech = `${who} logged ${all.length === 1 ? "one symptom" : `${all.length} symptoms`} ${span}, most recently ${SYMPTOM_LABEL[latest.symptom]} for ${latest.member} at severity ${latest.severity}${readingsPhrase(latest)}.${avg}`;
      }
      return speak(speech, { entries, count: all.length, averageEuropeanAqi, speech });
    }
  );
}
