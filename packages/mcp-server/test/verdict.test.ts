import { describe, expect, it } from "vitest";
import { parseForecast } from "../src/openmeteo.js";
import type { Member } from "../src/types.js";
import { aqiBand, pollenLevel, verdictForMember } from "../src/verdict.js";
import { loadAirFixture, readings } from "./helpers.js";

const asthma: Member = { name: "Mei", conditions: ["asthma"] };
const nobody: Member = { name: "Alex", conditions: ["none"] };
const allergic: Member = { name: "Dev", conditions: ["pollen_allergy"] };
const birchOnly: Member = { name: "Sam", conditions: ["pollen_allergy"], pollen: ["birch"] };

describe("European AQI bands", () => {
  it.each([
    [0, "good"],
    [20, "good"],
    [21, "fair"],
    [40, "fair"],
    [41, "moderate"],
    [60, "moderate"],
    [61, "poor"],
    [80, "poor"],
    [81, "very_poor"],
    [100, "very_poor"],
    [101, "extremely_poor"],
    [171, "extremely_poor"]
  ])("AQI %i is %s", (aqi, band) => {
    expect(aqiBand(aqi)).toBe(band);
  });
});

describe("pollen levels", () => {
  it("uses the grass scale", () => {
    expect(pollenLevel("grass", 0)).toBe("none");
    expect(pollenLevel("grass", 1)).toBe("low");
    expect(pollenLevel("grass", 5)).toBe("moderate");
    expect(pollenLevel("grass", 20)).toBe("high");
    expect(pollenLevel("grass", 200)).toBe("very_high");
  });
  it("uses the tree and weed scales", () => {
    expect(pollenLevel("birch", 15)).toBe("moderate");
    expect(pollenLevel("birch", 90)).toBe("high");
    expect(pollenLevel("ragweed", 10)).toBe("moderate");
    expect(pollenLevel("ragweed", 50)).toBe("high");
  });
});

describe("verdict per member", () => {
  it("is stricter for asthma in the moderate and poor bands", () => {
    expect(verdictForMember(asthma, readings({ european_aqi: 50 })).verdict).toBe("caution");
    expect(verdictForMember(nobody, readings({ european_aqi: 50 })).verdict).toBe("good");
    expect(verdictForMember(asthma, readings({ european_aqi: 70 })).verdict).toBe("stay_in");
    expect(verdictForMember(nobody, readings({ european_aqi: 70 })).verdict).toBe("caution");
  });

  it("keeps everyone in when the air is extremely poor", () => {
    const v = verdictForMember(nobody, readings({ european_aqi: 171 }));
    expect(v.verdict).toBe("stay_in");
    expect(v.reason).toContain("extremely poor");
    expect(v.reason).toContain("European AQI 171");
  });

  it("adds pollen for allergic members only", () => {
    const clean = readings({ pollen: { grass: 30 } });
    expect(verdictForMember(allergic, clean).verdict).toBe("stay_in");
    expect(verdictForMember(allergic, clean).reason).toContain("grass pollen is high");
    expect(verdictForMember(nobody, clean).verdict).toBe("good");
    expect(verdictForMember(nobody, clean).reason).not.toContain("pollen");
  });

  it("treats moderate pollen as caution", () => {
    expect(verdictForMember(allergic, readings({ pollen: { grass: 10 } })).verdict).toBe("caution");
  });

  it("only counts the pollen types a member reacts to", () => {
    const v = verdictForMember(birchOnly, readings({ pollen: { grass: 30, birch: 5 } }));
    expect(v.verdict).toBe("good");
    expect(v.reason).not.toContain("grass");
  });

  it("says when pollen is not forecast", () => {
    const v = verdictForMember(allergic, readings({ pollen: {} }));
    expect(v.verdict).toBe("good");
    expect(v.pollenDataAvailable).toBe(false);
    expect(v.pollenNotForecast).toBe(true);
    expect(v.reason).toContain("pollen is not forecast");
    expect(verdictForMember(nobody, readings({ pollen: {} })).pollenNotForecast).toBe(false);
  });

  it("reads the recorded Singapore fixture as stay in for everyone", () => {
    const forecast = parseForecast(loadAirFixture());
    expect(forecast.current.european_aqi).toBe(171);
    expect(forecast.current.pollen.grass).toBeNull();
    expect(verdictForMember(asthma, forecast.current).verdict).toBe("stay_in");
    expect(verdictForMember(nobody, forecast.current).verdict).toBe("stay_in");
    expect(verdictForMember(allergic, forecast.current).aqiBand).toBe("extremely_poor");
  });
});
