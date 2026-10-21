import { z } from "zod";
import { POLLEN_TYPES, type Home, type PollenReadings, type PollenType, type Readings } from "./types.js";

export const AIR_QUALITY_ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

const HOURLY_VARS = [
  "pm10",
  "pm2_5",
  "ozone",
  "nitrogen_dioxide",
  "european_aqi",
  "alder_pollen",
  "birch_pollen",
  "grass_pollen",
  "mugwort_pollen",
  "olive_pollen",
  "ragweed_pollen"
];
const CURRENT_VARS = ["pm10", "pm2_5", "ozone", "nitrogen_dioxide", "european_aqi"];

export type FetchLike = (input: string) => Promise<Response>;

const numberSeries = z.array(z.number().nullable());

const ResponseSchema = z.object({
  timezone: z.string(),
  utc_offset_seconds: z.number(),
  current: z.object({
    time: z.string(),
    pm10: z.number().nullable(),
    pm2_5: z.number().nullable(),
    ozone: z.number().nullable(),
    nitrogen_dioxide: z.number().nullable(),
    european_aqi: z.number().nullable()
  }),
  hourly: z.object({
    time: z.array(z.string()),
    pm10: numberSeries,
    pm2_5: numberSeries,
    ozone: numberSeries,
    nitrogen_dioxide: numberSeries,
    european_aqi: numberSeries,
    alder_pollen: numberSeries,
    birch_pollen: numberSeries,
    grass_pollen: numberSeries,
    mugwort_pollen: numberSeries,
    olive_pollen: numberSeries,
    ragweed_pollen: numberSeries
  })
});

export interface Forecast {
  timezone: string;
  utcOffsetSeconds: number;
  current: Readings;
  hourly: Readings[];
}

export function airQualityUrl(home: Home): string {
  const params = new URLSearchParams({
    latitude: home.latitude.toString(),
    longitude: home.longitude.toString(),
    hourly: HOURLY_VARS.join(","),
    current: CURRENT_VARS.join(","),
    timezone: "auto",
    forecast_days: "2"
  });
  return `${AIR_QUALITY_ENDPOINT}?${params.toString()}`;
}

export function parseForecast(json: unknown): Forecast {
  const data = ResponseSchema.parse(json);
  const hourly: Readings[] = data.hourly.time.map((time, i) => ({
    time,
    european_aqi: data.hourly.european_aqi[i] ?? null,
    pm2_5: data.hourly.pm2_5[i] ?? null,
    pm10: data.hourly.pm10[i] ?? null,
    ozone: data.hourly.ozone[i] ?? null,
    nitrogen_dioxide: data.hourly.nitrogen_dioxide[i] ?? null,
    pollen: pollenAt(data.hourly, i)
  }));
  const currentHour = hourly.find((h) => h.time === data.current.time);
  const current: Readings = {
    time: data.current.time,
    european_aqi: data.current.european_aqi,
    pm2_5: data.current.pm2_5,
    pm10: data.current.pm10,
    ozone: data.current.ozone,
    nitrogen_dioxide: data.current.nitrogen_dioxide,
    pollen: currentHour?.pollen ?? emptyPollen()
  };
  return { timezone: data.timezone, utcOffsetSeconds: data.utc_offset_seconds, current, hourly };
}

function pollenAt(hourly: z.infer<typeof ResponseSchema>["hourly"], i: number): PollenReadings {
  const out = emptyPollen();
  for (const type of POLLEN_TYPES) {
    out[type] = hourly[`${type}_pollen`][i] ?? null;
  }
  return out;
}

export function emptyPollen(): PollenReadings {
  return { alder: null, birch: null, grass: null, mugwort: null, olive: null, ragweed: null };
}

export function pollenKey(type: PollenType): `${PollenType}_pollen` {
  return `${type}_pollen`;
}

export class ForecastSource {
  private readonly cache = new Map<string, { at: number; forecast: Forecast }>();

  constructor(
    private readonly fetchImpl: FetchLike = (url) => fetch(url),
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 10 * 60 * 1000
  ) {}

  async get(home: Home): Promise<Forecast> {
    const key = `${home.latitude},${home.longitude}`;
    const hit = this.cache.get(key);
    const nowMs = this.now().getTime();
    if (hit && nowMs - hit.at < this.ttlMs) return hit.forecast;
    const res = await this.fetchImpl(airQualityUrl(home));
    if (!res.ok) throw new Error(`Open-Meteo air quality request failed: HTTP ${res.status}`);
    const forecast = parseForecast(await res.json());
    this.cache.set(key, { at: nowMs, forecast });
    return forecast;
  }

  async tryGet(home: Home): Promise<Forecast | null> {
    try {
      return await this.get(home);
    } catch {
      return null;
    }
  }
}

const GeocodeSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country: z.string().optional()
      })
    )
    .optional()
});

export async function geocodePlace(place: string, fetchImpl: FetchLike = (url) => fetch(url)): Promise<Home | null> {
  const params = new URLSearchParams({ name: place, count: "1", language: "en", format: "json" });
  const res = await fetchImpl(`${GEOCODING_ENDPOINT}?${params.toString()}`);
  if (!res.ok) throw new Error(`Open-Meteo geocoding request failed: HTTP ${res.status}`);
  const first = GeocodeSchema.parse(await res.json()).results?.[0];
  if (!first) return null;
  const label = first.country && first.country !== first.name ? `${first.name}, ${first.country}` : first.name;
  return { latitude: first.latitude, longitude: first.longitude, label };
}
