import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { bestWindow, hourOf, type WindowPick } from "../planner.js";
import { joinNames, spokenHour } from "../speech.js";
import { ReadingsSchema, VERDICTS, type Member, type Readings } from "../types.js";
import { AQI_BAND_LABEL, POLLEN_LEVEL_LABEL, aqiBand, verdictForMember, type MemberVerdict } from "../verdict.js";
import { findMember, noHomeResult, speak, unknownMemberResult } from "./result.js";

export function airSentence(readings: Readings): string {
  if (readings.european_aqi === null) return "I don't have an air quality reading right now.";
  const band = AQI_BAND_LABEL[aqiBand(readings.european_aqi)];
  const pm = readings.pm2_5 === null ? "" : `, with PM2.5 at ${Math.round(readings.pm2_5)} micrograms`;
  return `The air is ${band} right now, European AQI ${Math.round(readings.european_aqi)}${pm}.`;
}

export function membersSentence(verdicts: readonly MemberVerdict[]): string {
  if (verdicts.length === 0) return "Nobody is in the household yet, so I can't give personal advice.";
  const stayIn = verdicts.filter((v) => v.verdict === "stay_in").map((v) => v.member);
  const caution = verdicts.filter((v) => v.verdict === "caution").map((v) => v.member);
  const good = verdicts.filter((v) => v.verdict === "good").map((v) => v.member);
  if (verdicts.length > 1) {
    if (stayIn.length === verdicts.length) return "Everyone should stay in.";
    if (caution.length === verdicts.length) return "Everyone should take care outside.";
    if (good.length === verdicts.length) return "Everyone is fine to go outside.";
  }
  const parts: string[] = [];
  if (stayIn.length) parts.push(`${joinNames(stayIn)} should stay in`);
  if (caution.length) parts.push(`${joinNames(caution)} should take care outside`);
  if (good.length) parts.push(`${joinNames(good)} ${good.length > 1 ? "are" : "is"} fine to go out`);
  return `${joinNames(parts)}.`;
}

function pollenSentence(verdicts: readonly MemberVerdict[]): string {
  const drivers = verdicts.map((v) => v.pollen).filter((p) => p !== null && p.level !== "none" && p.level !== "low");
  const worst = drivers.sort((a, b) => b!.grainsPerM3 - a!.grainsPerM3)[0];
  if (worst) return ` ${worst.type[0]!.toUpperCase()}${worst.type.slice(1)} pollen is ${POLLEN_LEVEL_LABEL[worst.level]}.`;
  return verdicts.some((v) => v.pollenNotForecast) ? " Pollen is not forecast for this location." : "";
}

export function checkOutsideSpeech(verdicts: readonly MemberVerdict[], readings: Readings): string {
  return `${membersSentence(verdicts)} ${airSentence(readings)}${pollenSentence(verdicts)}`;
}

function windowSpeech(member: Member, day: "today" | "tomorrow", pick: WindowPick | null): string {
  if (!pick) {
    return day === "today"
      ? `There's no two-hour daytime window left today for ${member.name}; ask me about tomorrow.`
      : `I don't have a forecast far enough ahead to plan tomorrow for ${member.name}.`;
  }
  const span = `${spokenHour(hourOf(pick.start))} to ${spokenHour(hourOf(pick.end))}`;
  if (pick.verdict === "good") return `The best time for ${member.name} ${day} is ${span}, when ${pick.reason}.`;
  if (pick.verdict === "caution") return `The least bad time for ${member.name} ${day} is ${span}, but take care: ${pick.reason}.`;
  return `There's no safe window for ${member.name} ${day}. The cleanest stretch is ${span}, but ${pick.reason}, so better to stay in.`;
}

export function registerAirTools(server: McpServer, ctx: AppContext): void {
  server.registerTool(
    "check_outside",
    {
      title: "Check outside",
      description:
        "Current air quality and pollen at home with a verdict per person: good, caution or stay_in. Ask for one member or everyone.",
      inputSchema: {
        member: z.string().optional().describe("One person's name; omit for the whole household")
      },
      outputSchema: {
        time: z.string(),
        timezone: z.string(),
        readings: ReadingsSchema,
        aqiBand: z.string().nullable(),
        members: z.array(z.object({ member: z.string(), verdict: z.enum(VERDICTS), reason: z.string() })),
        speech: z.string()
      }
    },
    async ({ member }) => {
      const household = await ctx.store.load();
      if (!household.home) return noHomeResult();
      let members = household.members;
      if (member) {
        const found = findMember(household, member);
        if (!found) return unknownMemberResult(member, household);
        members = [found];
      }
      const forecast = await ctx.forecasts.get(household.home);
      const readings = forecast.current;
      const verdicts = members.map((m) => verdictForMember(m, readings));
      const speech = checkOutsideSpeech(verdicts, readings);
      return speak(speech, {
        time: readings.time,
        timezone: forecast.timezone,
        readings,
        aqiBand: readings.european_aqi === null ? null : aqiBand(readings.european_aqi),
        members: verdicts.map((v) => ({ member: v.member, verdict: v.verdict, reason: v.reason })),
        speech
      });
    }
  );

  server.registerTool(
    "plan_outdoor_time",
    {
      title: "Plan outdoor time",
      description: "Best two-hour daytime window today or tomorrow for one person, from the hourly air and pollen forecast.",
      inputSchema: {
        member: z.string().describe("Person's name"),
        day: z.enum(["today", "tomorrow"]).optional().describe("Defaults to today")
      },
      outputSchema: {
        member: z.string(),
        day: z.enum(["today", "tomorrow"]),
        window: z
          .object({
            start: z.string(),
            end: z.string(),
            verdict: z.enum(VERDICTS),
            reason: z.string(),
            europeanAqiMax: z.number().nullable()
          })
          .nullable(),
        speech: z.string()
      }
    },
    async ({ member, day }) => {
      const household = await ctx.store.load();
      if (!household.home) return noHomeResult();
      const found = findMember(household, member);
      if (!found) return unknownMemberResult(member, household);
      const chosenDay = day ?? "today";
      const forecast = await ctx.forecasts.get(household.home);
      const pick = bestWindow(found, forecast, { day: chosenDay });
      const speech = windowSpeech(found, chosenDay, pick);
      return speak(speech, { member: found.name, day: chosenDay, window: pick, speech });
    }
  );
}
