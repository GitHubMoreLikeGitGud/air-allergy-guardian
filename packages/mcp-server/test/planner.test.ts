import { describe, expect, it } from "vitest";
import { parseForecast } from "../src/openmeteo.js";
import { bestWindow } from "../src/planner.js";
import type { Member } from "../src/types.js";
import { loadAirFixture, withHourly } from "./helpers.js";

const nobody: Member = { name: "Alex", conditions: ["none"] };
const allergic: Member = { name: "Dev", conditions: ["pollen_allergy"], pollen: ["grass"] };

describe("plan_outdoor_time window picker", () => {
  it("finds the cleanest two hours tomorrow", () => {
    const fixture = withHourly(loadAirFixture(), (time) => ({
      european_aqi: time === "2026-10-18T10:00" || time === "2026-10-18T11:00" ? 15 : 90
    }));
    const pick = bestWindow(nobody, parseForecast(fixture), { day: "tomorrow" });
    expect(pick).toEqual({
      start: "2026-10-18T10:00",
      end: "2026-10-18T12:00",
      verdict: "good",
      reason: "air quality is good (European AQI 15)",
      europeanAqiMax: 15
    });
  });

  it("only considers hours still ahead today and inside the daytime bounds", () => {
    const aqiByHour: Record<string, number> = { "2026-10-17T18:00": 50, "2026-10-17T19:00": 40, "2026-10-17T20:00": 30 };
    const fixture = withHourly(loadAirFixture(), (time) => ({ european_aqi: aqiByHour[time] ?? 10 }));
    const pick = bestWindow(nobody, parseForecast(fixture), { day: "today" });
    expect(pick?.start).toBe("2026-10-17T19:00");
    expect(pick?.end).toBe("2026-10-17T21:00");
    expect(pick?.europeanAqiMax).toBe(40);
  });

  it("returns null when no daytime window is left today", () => {
    const fixture = loadAirFixture();
    fixture.current = { ...fixture.current, time: "2026-10-17T20:00" };
    expect(bestWindow(nobody, parseForecast(fixture), { day: "today" })).toBeNull();
  });

  it("avoids high pollen hours for an allergic member", () => {
    const fixture = withHourly(loadAirFixture(), (time) => ({
      european_aqi: 15,
      grass_pollen: time === "2026-10-18T08:00" || time === "2026-10-18T09:00" ? 2 : 30
    }));
    const forAllergic = bestWindow(allergic, parseForecast(fixture), { day: "tomorrow" });
    expect(forAllergic?.start).toBe("2026-10-18T08:00");
    expect(forAllergic?.verdict).toBe("good");
    const forNobody = bestWindow(nobody, parseForecast(fixture), { day: "tomorrow" });
    expect(forNobody?.start).toBe("2026-10-18T07:00");
  });

  it("picks the evening on the recorded Singapore fixture, stricter for asthma", () => {
    const forecast = parseForecast(loadAirFixture());
    const pick = bestWindow(nobody, forecast, { day: "tomorrow" });
    expect(pick).toMatchObject({ start: "2026-10-18T19:00", end: "2026-10-18T21:00", verdict: "caution", europeanAqiMax: 73 });
    expect(pick?.reason).toContain("poor");
    const asthma: Member = { name: "Mei", conditions: ["asthma"] };
    expect(bestWindow(asthma, forecast, { day: "tomorrow" })?.verdict).toBe("stay_in");
  });
});
