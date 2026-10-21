import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FetchLike } from "../src/openmeteo.js";
import { emptyPollen } from "../src/openmeteo.js";
import type { PollenType, Readings } from "../src/types.js";

export const PACKAGE_ROOT = new URL("../", import.meta.url);
export const SEED_FILE = new URL("data/household.example.json", PACKAGE_ROOT);

type AirFixture = {
  current: { time: string; european_aqi: number | null; pm2_5: number | null };
  hourly: { time: string[] } & Record<string, (number | null)[] | string[]>;
};

export function loadAirFixture(): AirFixture {
  const url = new URL("./fixtures/open-meteo-air-quality-singapore-2026-10-17.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as AirFixture;
}

export function loadGeoFixture(): unknown {
  return JSON.parse(readFileSync(new URL("./fixtures/open-meteo-geocoding-singapore.json", import.meta.url), "utf8"));
}

// Routes Open-Meteo URLs to recorded fixtures so no test touches the network.
export function fixtureFetch(air: unknown = loadAirFixture()): FetchLike {
  return async (url: string) => {
    if (url.startsWith("https://air-quality-api.open-meteo.com/")) return Response.json(air);
    if (url.startsWith("https://geocoding-api.open-meteo.com/")) return Response.json(loadGeoFixture());
    return new Response("not found", { status: 404 });
  };
}

// Synthetic variant of the recorded fixture: fills the (null) pollen series and/or overrides AQI per hour.
export function withHourly(
  fixture: AirFixture,
  edit: (time: string, i: number) => Partial<Record<string, number | null>>
): AirFixture {
  const hourly: AirFixture["hourly"] = { ...fixture.hourly };
  for (const key of Object.keys(hourly)) {
    if (key !== "time") hourly[key] = [...(hourly[key] as (number | null)[])];
  }
  fixture.hourly.time.forEach((time, i) => {
    for (const [key, value] of Object.entries(edit(time, i))) {
      (hourly[key] as (number | null)[])[i] = value ?? null;
    }
  });
  return { ...fixture, hourly };
}

export function readings(partial: Partial<Readings> & { pollen?: Partial<Record<PollenType, number | null>> }): Readings {
  return {
    time: "2026-10-17T17:00",
    european_aqi: 15,
    pm2_5: 5,
    pm10: 8,
    ozone: 40,
    nitrogen_dioxide: 10,
    ...partial,
    pollen: { ...emptyPollen(), ...(partial.pollen ?? {}) }
  };
}

export async function tempDataFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aag-test-"));
  return join(dir, "household.json");
}
